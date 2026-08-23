import { create } from "zustand";

interface AgentStatusStore {
  // Whether the aurora-agent sidecar is currently running. Optimistically true
  // at startup (Rust spawns it on boot); flipped to false when Rust emits the
  // `agent_crashed` event (runtime crash) or a spawn failure.
  isAgentRunning: boolean;
  setAgentRunning: (v: boolean) => void;
}

export const useAgentStatusStore = create<AgentStatusStore>((set) => ({
  isAgentRunning: true,
  setAgentRunning: (v) => set({ isAgentRunning: v }),
}));
