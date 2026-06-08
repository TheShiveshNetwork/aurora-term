import { create } from "zustand";

export interface AgentCommand {
  command: string;
  explanation: string;
  status: "pending" | "running" | "success" | "error" | "cancelled" | "requires_action";
}

interface AgentStore {
  taskId: string | null;
  originalGoal: string;
  status: "idle" | "planning" | "executing" | "paused" | "completed" | "error";
  queue: AgentCommand[];
  currentCommandIndex: number;
  logs: string[];
  lastMessage: string | null;

  startTask: (taskId: string, goal: string) => void;
  pauseTask: () => void;
  resumeTask: () => void;
  completeTask: (message: string) => void;
  failTask: (error: string) => void;
  clearTask: () => void;
  setQueue: (commands: { command: string; explanation: string }[]) => void;
  addCommandToQueue: (command: string, explanation: string, status?: AgentCommand["status"]) => void;
  updateCommandStatus: (index: number, status: AgentCommand["status"]) => void;
  setCurrentCommandIndex: (index: number) => void;
  addLog: (log: string) => void;
}

export const useAgentStore = create<AgentStore>((set) => ({
  taskId: null,
  originalGoal: "",
  status: "idle",
  queue: [],
  currentCommandIndex: -1,
  logs: [],
  lastMessage: null,

  startTask: (taskId, goal) =>
    set({
      taskId,
      originalGoal: goal,
      status: "planning",
      queue: [],
      currentCommandIndex: -1,
      logs: [`Started Agent Task: "${goal}"`],
      lastMessage: null,
    }),

  pauseTask: () =>
    set((state) => ({
      status: "paused",
      logs: [...state.logs, "Agent execution paused by user."],
    })),

  resumeTask: () =>
    set((state) => ({
      status: "executing",
      logs: [...state.logs, "Agent execution resumed."],
    })),

  completeTask: (message) =>
    set((state) => ({
      status: "completed",
      lastMessage: message,
      logs: [...state.logs, `Agent completed task: ${message}`],
    })),

  failTask: (error) =>
    set((state) => ({
      status: "error",
      lastMessage: error,
      logs: [...state.logs, `Agent failed: ${error}`],
    })),

  clearTask: () =>
    set({
      taskId: null,
      originalGoal: "",
      status: "idle",
      queue: [],
      currentCommandIndex: -1,
      logs: [],
      lastMessage: null,
    }),

  setQueue: (commands) =>
    set({
      queue: commands.map((c) => ({
        command: c.command,
        explanation: c.explanation,
        status: "pending",
      })),
      currentCommandIndex: 0,
    }),

  addCommandToQueue: (command, explanation, status = "pending") =>
    set((state) => ({
      queue: [...state.queue, { command, explanation, status }],
      currentCommandIndex: state.currentCommandIndex === -1 ? 0 : state.currentCommandIndex,
    })),

  updateCommandStatus: (index, status) =>
    set((state) => {
      const updated = state.queue.map((cmd, i) =>
        i === index ? { ...cmd, status } : cmd
      );
      return { queue: updated };
    }),

  setCurrentCommandIndex: (index) =>
    set({ currentCommandIndex: index }),

  addLog: (log) =>
    set((state) => ({ logs: [...state.logs, log] })),
}));
