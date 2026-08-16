import { create } from "zustand";
import { formatTauriError } from "../lib/utils";
import { notifyError, notifyInfo } from "../lib/notify";


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
  agentType?: "terminal" | "developer";
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
  content?: string;
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
  thinking: string;
  planningThinking: string;
  conclusionThinking: string;
  lastMessage: string | null;
  activeSubagent: string | null;
  chatHistory: ChatMessage[];
  agentType: "terminal" | "developer";
  agentMode: "plan" | "build";
  activeDrawerTab: "files" | "terminals" | "artifacts" | "browsers" | "questions" | null;
  filesChanged: Array<{
    path: string;
    oldContent?: string;
    newContent: string;
    status: "pending" | "approved" | "rejected";
    type?: "write" | "patch";
    search?: string;
    replace?: string;
  }>;
  activeTerminals: Array<{
    id: string;
    command: string;
    explanation: string;
    status: "pending" | "running" | "success" | "error" | "cancelled" | "requires_action";
  }>;
  artifactsCreated: Array<{
    id: string;
    title: string;
    type: "document" | "image";
    path: string;
  }>;
  browserSessions: Array<{
    id: string;
    url: string;
    status: "active" | "closed";
  }>;
  pendingToolCall: {
    runId: string;
    toolCallId: string;
    name: string;
    args: any;
  } | null;
  model?: string;
  isAgentViewSession?: boolean;
  title?: string;
  startedAt?: number;
}

export const CONST_DEFAULT_SESSION_STATE: SessionAgentState = {
  taskId: null,
  originalGoal: "",
  status: "idle",
  queue: [],
  currentCommandIndex: -1,
  stepCount: 0,
  maxSteps: 15,
  logs: [],
  agentLogs: [],
  chainNodes: [],
  thinking: "",
  planningThinking: "",
  conclusionThinking: "",
  lastMessage: null,
  activeSubagent: null,
  chatHistory: [],
  agentType: "terminal",
  agentMode: "build",
  activeDrawerTab: null,
  filesChanged: [],
  activeTerminals: [],
  artifactsCreated: [],
  browserSessions: [],
  pendingToolCall: null,
  startedAt: undefined,
};

export const defaultSessionState = (): SessionAgentState => ({
  ...CONST_DEFAULT_SESSION_STATE,
  queue: [],
  logs: [],
  agentLogs: [],
  chainNodes: [],
  filesChanged: [],
  activeTerminals: [],
  artifactsCreated: [],
  browserSessions: [],
});

interface AgentStore {
  sessions: Record<string, SessionAgentState>;

  startTask: (sessionId: string, taskId: string, goal: string) => void;
  pauseTask: (sessionId: string) => void;
  resumeTask: (sessionId: string) => void;
  completeTask: (sessionId: string, message: string) => void;
  failTask: (sessionId: string, error: unknown, type?: "error" | "info") => void;
  clearTask: (sessionId: string) => void;

  setQueue: (sessionId: string, commands: { command: string; explanation: string }[]) => void;
  addCommandToQueue: (sessionId: string, command: string, explanation: string, status?: AgentCommand["status"], subagent?: AgentCommand["subagent"]) => void;
  updateCommandStatus: (sessionId: string, index: number, status: AgentCommand["status"], durationMs?: number) => void;
  setCurrentCommandIndex: (sessionId: string, index: number) => void;

  addLog: (sessionId: string, log: string) => void;
  addAgentLog: (sessionId: string, type: AgentLog["type"], content: string, subagent?: string) => void;
  setAgentLogs: (sessionId: string, logs: AgentLog[]) => void;
  setThinking: (sessionId: string, thinking: string) => void;
  setPlanningThinking: (sessionId: string, thinking: string) => void;
  streamConclusion: (sessionId: string, text: string) => void;

  addChainNode: (sessionId: string, node: Omit<ChainNode, "id">) => string;
  updateChainNode: (sessionId: string, id: string, updates: Partial<ChainNode>) => void;

  addChatMessage: (sessionId: string, msg: Omit<ChatMessage, "id" | "timestamp">) => void;

  setActiveSubagent: (sessionId: string, subagent: string | null) => void;
  incrementStep: (sessionId: string) => void;

  setAgentType: (sessionId: string, type: "terminal" | "developer") => void;
  setAgentMode: (sessionId: string, mode: "plan" | "build") => void;
  setActiveDrawerTab: (sessionId: string, tab: "files" | "terminals" | "artifacts" | "browsers" | "questions" | null) => void;
  addFileChange: (sessionId: string, change: Omit<SessionAgentState["filesChanged"][0], "status">) => void;
  updateFileChangeStatus: (sessionId: string, path: string, status: "pending" | "approved" | "rejected") => void;
  setPendingToolCall: (sessionId: string, toolCall: SessionAgentState["pendingToolCall"]) => void;
  clearFileChanges: (sessionId: string) => void;
  setAgentModel: (sessionId: string, model: string | undefined) => void;
  // Finalizes an interrupted run so no in-flight tool-call spinners/loaders
  // persist on the frontend after the user hits stop. Converts any chain node
  // still in `active`/`pending` and any queue command still in
  // `running`/`requires_action`/`pending` to a terminal state.
  finalizeInterruptedRun: (sessionId: string) => void;
  activeAgentSessionId: string | null;
  setActiveAgentSessionId: (id: string | null) => void;
  createAgentSession: (title?: string) => string;
  renameAgentSession: (sessionId: string, title: string) => void;
  deleteAgentSession: (sessionId: string) => void;
}

// ── sanitizeMessage ───────────────────────────────────────────────────────
// The agent is expected to emit a validated envelope:
//   {"status":"...","planning":"...","conclusion":"...","message":"..."}
// This guarantees only the human-readable `message` (rich Markdown) is stored/
// rendered, even when the model emits a malformed, truncated, fenced, or
// double-wrapped envelope. The raw envelope must NEVER reach the Markdown view.
export function sanitizeMessage(raw: unknown): string {
  const str = typeof raw === "string" ? raw : String(raw);
  const trimmed = str.trim();
  if (!trimmed.startsWith("{")) return str;

  // 1) Strict JSON parse — a well-formed envelope renders ONLY its `message`.
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      if (typeof parsed.message === "string" && parsed.message.trim()) {
        return sanitizeMessage(parsed.message); // recurse — handles double-wrapping
      }
      if (typeof parsed.content === "string" && parsed.content.trim()) {
        return sanitizeMessage(parsed.content);
      }
      // It is a structured envelope but carries no renderable text — e.g. an
      // intermediate `executing`/tool step leaked into the response, or the
      // final answer is malformed. Never paint raw JSON: surface a clear error.
      if (typeof parsed.status === "string") {
        return "⚠️ The agent returned an incomplete or malformed response (missing message content).";
      }
    }
  } catch {
    // not valid JSON — fall through to lenient extraction
  }

  // 2) Lenient: pull the `message` (or `content`) field out of malformed JSON
  const msg = extractJsonField(trimmed, "message") ?? extractJsonField(trimmed, "content");
  if (msg && msg.trim()) return msg;

  // 3) It looked like JSON but is not a parseable, message-bearing envelope.
  //    Never render the raw JSON to the user — show a safe, readable error.
  return "⚠️ The agent returned a malformed response that could not be parsed.";
}

/**
 * Extract a string field value from JSON even when the JSON is malformed or
 * truncated (e.g. an envelope cut off mid-stream). Walks the source from the
 * field name, skips to the opening quote, then captures the value handling
 * escapes and unescaped inner quotes, stopping at the quote that terminates
 * the field (the one followed by `,` or `}`).
 */
function extractJsonField(src: string, field: string): string | null {
  const idx = src.indexOf(`"${field}"`);
  if (idx === -1) return null;
  const colon = src.indexOf(":", idx);
  if (colon === -1) return null;
  let q = colon + 1;
  while (q < src.length && (src[q] === " " || src[q] === "\t" || src[q] === "\n" || src[q] === "\r")) q++;
  if (src[q] !== '"') return null;
  q++; // past the opening quote
  let out = "";
  let i = q;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      out += c + (src[i + 1] ?? "");
      i += 2;
      continue;
    }
    if (c === '"') {
      // closing quote — accept it only if it terminates the field
      let j = i + 1;
      while (j < src.length && (src[j] === " " || src[j] === "\t" || src[j] === "\n" || src[j] === "\r")) j++;
      if (src[j] === "," || src[j] === "}" || j >= src.length) break;
      out += c; // unescaped inner quote — keep it
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
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
  activeAgentSessionId: null,
  setActiveAgentSessionId: (id) => set({ activeAgentSessionId: id }),

  createAgentSession: (title) => {
    const id = "agent-session-" + genId();
    const newSession: SessionAgentState = {
      ...defaultSessionState(),
      isAgentViewSession: true,
      title: title || "New Session",
    };
    set((state) => ({
      sessions: {
        ...state.sessions,
        [id]: newSession,
      },
      activeAgentSessionId: id,
    }));
    return id;
  },

  renameAgentSession: (sessionId, title) => {
    updateSession(set, sessionId, { title });
  },

  deleteAgentSession: (sessionId) => {
    set((state) => {
      const sessions = { ...state.sessions };
      delete sessions[sessionId];
      let nextActiveId = state.activeAgentSessionId;
      if (state.activeAgentSessionId === sessionId) {
        const remaining = Object.entries(sessions).filter(([_, s]) => s.isAgentViewSession);
        nextActiveId = remaining.length > 0 ? remaining[remaining.length - 1][0] : null;
      }
      return { sessions, activeAgentSessionId: nextActiveId };
    });
  },

  startTask: (sessionId, taskId, goal) =>
    updateSession(set, sessionId, (prev) => ({
      taskId,
      originalGoal: goal,
      status: "planning",
      queue: [],
      currentCommandIndex: -1,
      stepCount: 0,
      logs: [],
      planningThinking: "",
      conclusionThinking: "",
      startedAt: Date.now(),
      agentLogs: [{ timestamp: Date.now(), type: "plan", content: `Starting task: ${goal}` }],
      chainNodes: [
        {
          id: genId(),
          type: "planning",
          label: "Planning",
          subLabel: "",
          status: "active",
          content: "",
        },
      ],
      lastMessage: null,
      activeSubagent: null,
      title: prev.title === "New Session" || !prev.title ? `Session-${Math.floor(1000 + Math.random() * 9000)}` : prev.title,
    })),

  pauseTask: (sessionId) => updateSession(set, sessionId, { status: "paused" }),

  resumeTask: (sessionId) => updateSession(set, sessionId, { status: "executing" }),

  completeTask: (sessionId, message) =>
    updateSession(set, sessionId, (prev) => {
      // Guard: if the LLM leaked a raw JSON object as the message string,
      // extract just the human-readable `message` field from it.
      const cleanMsg = sanitizeMessage(message);
      const conclusionText = prev.conclusionThinking || cleanMsg;
      const baseNodes = prev.chainNodes.map((n) =>
        n.status === "active" ? { ...n, status: "done" as const } : n
      );
      // Reuse the live "Conclusion" node created by streamConclusion during the
      // final step, or append one when the completion arrives without streaming.
      const existing = baseNodes.find((n) => n.type === "complete");
      const chainNodes = existing
        ? baseNodes.map((n) =>
            n.id === existing.id
              ? {
                  ...n,
                  status: "done" as const,
                  content: conclusionText,
                  subLabel: cleanMsg.length > 50 ? cleanMsg.slice(0, 50) + "\u2026" : cleanMsg,
                }
              : n
          )
        : [
            ...baseNodes,
            {
              id: genId(),
              type: "complete" as const,
              label: "Conclusion",
              subLabel: cleanMsg.length > 50 ? cleanMsg.slice(0, 50) + "\u2026" : cleanMsg,
              content: conclusionText,
              status: "done" as const,
            },
          ];
      return {
        status: "completed",
        lastMessage: cleanMsg,
        activeSubagent: null,
        chainNodes,
        agentLogs: [
          ...prev.agentLogs,
          { timestamp: Date.now(), type: "complete" as const, content: cleanMsg },
        ],
      };
    }),

  failTask: (sessionId, error, type = "error") =>
    updateSession(set, sessionId, (prev) => {
      const raw = formatTauriError(error);
      const msg = sanitizeMessage(raw);
      if (type === "info") notifyInfo(msg);
      else notifyError(msg);
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

  setAgentLogs: (sessionId, logs) =>
    updateSession(set, sessionId, { agentLogs: logs }),

  setThinking: (sessionId, thinking) =>
    updateSession(set, sessionId, { thinking }),

  setPlanningThinking: (sessionId, thinking) =>
    updateSession(set, sessionId, { planningThinking: thinking }),

  streamConclusion: (sessionId, text) =>
    updateSession(set, sessionId, (prev) => {
      // Atomically stream the conclusion text into a single live "Conclusion"
      // chain node. The find-and-add happens inside one update so concurrent
      // polls can never create duplicate conclusion nodes.
      const existing = prev.chainNodes.find((n) => n.type === "complete");
      const chainNodes = existing
        ? prev.chainNodes.map((n) =>
            n.id === existing.id
              ? { ...n, content: text, status: n.status === "done" ? ("done" as const) : ("active" as const) }
              : n
          )
        : [
            ...prev.chainNodes,
            {
              id: genId(),
              type: "complete" as const,
              label: "Conclusion",
              status: "active" as const,
              content: text,
            },
          ];
      return { conclusionThinking: text, chainNodes };
    }),

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
    updateSession(set, sessionId, (prev) => ({
      stepCount: prev.stepCount + 1,
    })),

  setAgentType: (sessionId, type) =>
    updateSession(set, sessionId, { agentType: type }),

  setAgentMode: (sessionId, mode) =>
    updateSession(set, sessionId, { agentMode: mode }),

  setActiveDrawerTab: (sessionId, tab) =>
    updateSession(set, sessionId, { activeDrawerTab: tab }),

  addFileChange: (sessionId, change) =>
    updateSession(set, sessionId, (prev) => {
      // Avoid duplicate path changes in the drawer
      const filtered = prev.filesChanged.filter((f) => f.path !== change.path);
      return {
        filesChanged: [...filtered, { ...change, status: "pending" }],
      };
    }),

  updateFileChangeStatus: (sessionId, path, status) =>
    updateSession(set, sessionId, (prev) => ({
      filesChanged: prev.filesChanged.map((f) =>
        f.path === path ? { ...f, status } : f
      ),
    })),

  setPendingToolCall: (sessionId, toolCall) =>
    updateSession(set, sessionId, { pendingToolCall: toolCall }),

  clearFileChanges: (sessionId) =>
    updateSession(set, sessionId, { filesChanged: [], pendingToolCall: null, activeDrawerTab: null }),

  setAgentModel: (sessionId, model) =>
    updateSession(set, sessionId, { model }),

  finalizeInterruptedRun: (sessionId) =>
    updateSession(set, sessionId, (prev) => ({
      // Any chain-of-thought node still spinning/waiting becomes terminal so the
      // spinner (only shown for `active`) and stale `pending` cards disappear.
      chainNodes: prev.chainNodes.map((n) =>
        n.status === "active" || n.status === "pending"
          ? { ...n, status: "failed" as const }
          : n
      ),
      // Any queued command that never reached a terminal status is cancelled,
      // clearing the Terminals-drawer "running"/"requires_action" loaders.
      queue: prev.queue.map((c) =>
        c.status === "running" || c.status === "requires_action" || c.status === "pending"
          ? { ...c, status: "cancelled" as const }
          : c
      ),
      pendingToolCall: null,
      activeSubagent: null,
    })),
}));
