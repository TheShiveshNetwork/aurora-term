import { create } from "zustand";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  isError?: boolean;
  durationMs?: number;
  chainNodes?: ChainNode[];
  agentLogs?: AgentLog[];
  subagent?: string | null;
}

export interface AgentCommand {
  command: string;
  explanation: string;
  status: "pending" | "running" | "success" | "error" | "cancelled" | "requires_action";
  subagent?: "coder" | "researcher" | "validator" | "none";
  durationMs?: number;
  startedAt?: number;
}

export interface AgentLog {
  timestamp: number;
  type: "plan" | "execute" | "subagent" | "complete" | "error" | "info";
  content: string;
  subagent?: string;
}

export interface ChainNode {
  id: string;
  type: "planning" | "subagent" | "command" | "complete" | "error";
  label: string;
  subLabel?: string;
  status: "pending" | "active" | "done" | "failed";
  command?: string;
  subagent?: string;
  durationMs?: number;
}

export interface SessionAgentState {
  taskId: string | null;
  originalGoal: string;
  status: "idle" | "planning" | "executing" | "paused" | "completed" | "error";
  queue: AgentCommand[];
  currentCommandIndex: number;
  stepCount: number;
  maxSteps: number;
  logs: string[];
  agentLogs: AgentLog[];
  chainNodes: ChainNode[];
  lastMessage: string | null;
  activeSubagent: string | null;
  chatHistory: ChatMessage[];
}

export const CONST_DEFAULT_SESSION_STATE: SessionAgentState = {
  taskId: null,
  originalGoal: "",
  status: "idle",
  queue: [],
  currentCommandIndex: -1,
  stepCount: 0,
  maxSteps: 10,
  logs: [],
  agentLogs: [],
  chainNodes: [],
  lastMessage: null,
  activeSubagent: null,
  chatHistory: [],
};

export const defaultSessionState = (): SessionAgentState => ({
  ...CONST_DEFAULT_SESSION_STATE,
  queue: [],
  logs: [],
  agentLogs: [],
  chainNodes: [],
});

interface AgentStore {
  sessions: Record<string, SessionAgentState>;

  startTask: (sessionId: string, taskId: string, goal: string) => void;
  pauseTask: (sessionId: string) => void;
  resumeTask: (sessionId: string) => void;
  completeTask: (sessionId: string, message: string) => void;
  failTask: (sessionId: string, error: unknown) => void;
  clearTask: (sessionId: string) => void;

  setQueue: (sessionId: string, commands: { command: string; explanation: string }[]) => void;
  addCommandToQueue: (sessionId: string, command: string, explanation: string, status?: AgentCommand["status"], subagent?: AgentCommand["subagent"]) => void;
  updateCommandStatus: (sessionId: string, index: number, status: AgentCommand["status"], durationMs?: number) => void;
  setCurrentCommandIndex: (sessionId: string, index: number) => void;

  addLog: (sessionId: string, log: string) => void;
  addAgentLog: (sessionId: string, type: AgentLog["type"], content: string, subagent?: string) => void;

  addChainNode: (sessionId: string, node: Omit<ChainNode, "id">) => string;
  updateChainNode: (sessionId: string, id: string, updates: Partial<ChainNode>) => void;

  addChatMessage: (sessionId: string, msg: Omit<ChatMessage, "id" | "timestamp">) => void;

  setActiveSubagent: (sessionId: string, subagent: string | null) => void;
  incrementStep: (sessionId: string) => void;
}

// ── sanitizeMessage ───────────────────────────────────────────────────────
// When working memory is active the LLM occasionally wraps its completion
// text in a JSON object (e.g. {"status":"completed","message":"..."}).
// This strips the outer envelope so only the human-readable text is stored.
function sanitizeMessage(raw: unknown): string {
  const str = typeof raw === "string" ? raw : String(raw);
  // Fast-path: not JSON-ish
  const trimmed = str.trim();
  if (!trimmed.startsWith("{")) return str;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") {
      // Prefer the `message` field; fall back to whole object stringified
      if (typeof parsed.message === "string" && parsed.message.trim()) {
        return sanitizeMessage(parsed.message); // recurse — handle double-wrapping
      }
    }
  } catch {
    // Not valid JSON — return as-is
  }
  return str;
}

function genId() {
  return Math.random().toString(36).substring(2, 10);
}

const updateSession = (
  set: any,
  sessionId: string,
  updates: Partial<SessionAgentState> | ((prev: SessionAgentState) => Partial<SessionAgentState>)
) => {
  set((state: any) => {
    const prev = state.sessions[sessionId] || defaultSessionState();
    const nextFields = typeof updates === "function" ? updates(prev) : updates;
    return {
      sessions: {
        ...state.sessions,
        [sessionId]: { ...prev, ...nextFields },
      },
    };
  });
};

export const useAgentStore = create<AgentStore>((set) => ({
  sessions: {},

  startTask: (sessionId, taskId, goal) =>
    updateSession(set, sessionId, {
      taskId,
      originalGoal: goal,
      status: "planning",
      queue: [],
      currentCommandIndex: -1,
      stepCount: 0,
      logs: [],
      agentLogs: [{ timestamp: Date.now(), type: "plan", content: `Starting task: ${goal}` }],
      chainNodes: [
        {
          id: genId(),
          type: "planning",
          label: "Planning",
          subLabel: goal.length > 40 ? goal.slice(0, 40) + "…" : goal,
          status: "active",
        },
      ],
      lastMessage: null,
      activeSubagent: null,
    }),

  pauseTask: (sessionId) => updateSession(set, sessionId, { status: "paused" }),

  resumeTask: (sessionId) => updateSession(set, sessionId, { status: "executing" }),

  completeTask: (sessionId, message) =>
    updateSession(set, sessionId, (prev) => {
      // Guard: if the LLM leaked a raw JSON object as the message string,
      // extract just the human-readable `message` field from it.
      const cleanMsg = sanitizeMessage(message);
      return {
        status: "completed",
        lastMessage: cleanMsg,
        activeSubagent: null,
        chainNodes: [
          ...prev.chainNodes.map((n) =>
            n.status === "active" ? { ...n, status: "done" as const } : n
          ),
          {
            id: genId(),
            type: "complete" as const,
            label: "Completed",
            subLabel: cleanMsg.length > 50 ? cleanMsg.slice(0, 50) + "\u2026" : cleanMsg,
            status: "done" as const,
          },
        ],
        agentLogs: [
          ...prev.agentLogs,
          { timestamp: Date.now(), type: "complete" as const, content: cleanMsg },
        ],
      };
    }),

  failTask: (sessionId, error) =>
    updateSession(set, sessionId, (prev) => {
      const raw =
        typeof error === "string"
          ? error
          : error && typeof error === "object" && "message" in error
            ? typeof (error as any).message === "string"
              ? (error as any).message
              : String((error as any).message)
            : String(error);
      const msg = sanitizeMessage(raw);
      return {
        status: "error",
        lastMessage: msg,
        activeSubagent: null,
        chainNodes: [
          ...prev.chainNodes.map((n) =>
            n.status === "active" ? { ...n, status: "failed" as const } : n
          ),
          {
            id: genId(),
            type: "error" as const,
            label: "Error",
            subLabel: msg.length > 50 ? msg.slice(0, 50) + "\u2026" : msg,
            status: "failed" as const,
          },
        ],
        agentLogs: [
          ...prev.agentLogs,
          { timestamp: Date.now(), type: "error" as const, content: msg },
        ],
      };
    }),

  clearTask: (sessionId) => updateSession(set, sessionId, defaultSessionState()),

  setQueue: (sessionId, commands) =>
    updateSession(set, sessionId, {
      queue: commands.map((c) => ({
        command: c.command,
        explanation: c.explanation,
        status: "pending",
      })),
      currentCommandIndex: 0,
    }),

  addCommandToQueue: (sessionId, command, explanation, status = "pending", subagent) =>
    updateSession(set, sessionId, (prev) => ({
      queue: [...prev.queue, { command, explanation, status, subagent, startedAt: Date.now() }],
      currentCommandIndex: prev.currentCommandIndex === -1 ? 0 : prev.currentCommandIndex,
    })),

  updateCommandStatus: (sessionId, index, status, durationMs) =>
    updateSession(set, sessionId, (prev) => {
      const updated = prev.queue.map((cmd, i) =>
        i === index ? { ...cmd, status, durationMs: durationMs ?? cmd.durationMs } : cmd
      );
      return { queue: updated };
    }),

  setCurrentCommandIndex: (sessionId, index) =>
    updateSession(set, sessionId, { currentCommandIndex: index }),

  addLog: (sessionId, log) =>
    updateSession(set, sessionId, (prev) => ({ logs: [...prev.logs, log] })),

  addAgentLog: (sessionId, type, content, subagent) =>
    updateSession(set, sessionId, (prev) => ({
      agentLogs: [
        ...prev.agentLogs,
        { timestamp: Date.now(), type, content, subagent },
      ],
    })),

  addChainNode: (sessionId, node) => {
    const id = genId();
    updateSession(set, sessionId, (prev) => ({
      chainNodes: [...prev.chainNodes, { ...node, id }],
    }));
    return id;
  },

  updateChainNode: (sessionId, id, updates) =>
    updateSession(set, sessionId, (prev) => ({
      chainNodes: prev.chainNodes.map((n) =>
        n.id === id ? { ...n, ...updates } : n
      ),
    })),

  addChatMessage: (sessionId, msg) =>
    updateSession(set, sessionId, (prev) => ({
      chatHistory: [
        ...prev.chatHistory,
        { ...msg, id: genId(), timestamp: Date.now() },
      ],
    })),

  setActiveSubagent: (sessionId, subagent) =>
    updateSession(set, sessionId, { activeSubagent: subagent }),

  incrementStep: (sessionId) =>
    updateSession(set, sessionId, (prev) => {
      const nodes = prev.stepCount === 0
        ? prev.chainNodes.map((n) =>
            n.type === "planning" && n.status === "active" ? { ...n, status: "done" as const } : n
          )
        : prev.chainNodes;
      return { stepCount: prev.stepCount + 1, chainNodes: nodes };
    }),
}));
