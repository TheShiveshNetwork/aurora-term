import { create } from "zustand";
import { ProviderName, ProviderConfig, TaskTier } from "@aurora/types";

interface PendingRequest {
  tier: TaskTier;
  abortable: boolean;
}

interface AIStore {
  activeProvider: ProviderName;
  providers: Record<ProviderName, ProviderConfig>;
  pendingRequests: Record<string, PendingRequest>;
  streamingText: string | null;
  
  setActiveProvider: (provider: ProviderName) => void;
  setProviders: (providers: Record<ProviderName, ProviderConfig>) => void;
  updateProviderConfig: (provider: ProviderName, config: Partial<ProviderConfig>) => void;
  addPendingRequest: (requestId: string, req: PendingRequest) => void;
  removePendingRequest: (requestId: string) => void;
  setStreamingText: (text: string | null) => void;
  appendStreamingText: (text: string) => void;
}

export const useAIStore = create<AIStore>((set) => ({
  activeProvider: "anthropic",
  providers: {
    anthropic: {
      name: "anthropic",
      enabled: true,
      hasApiKey: false,
      fastModel: "claude-haiku-4-5-20251015",
      balancedModel: "claude-sonnet-4-6-20260217",
      powerfulModel: "claude-opus-4-7-20260416",
    },
    openai: {
      name: "openai",
      enabled: false,
      hasApiKey: false,
      fastModel: "gpt-5-mini",
      balancedModel: "gpt-5.4-mini",
      powerfulModel: "gpt-5.5",
    },
    gemini: {
      name: "gemini",
      enabled: false,
      hasApiKey: false,
      fastModel: "gemini-3.1-flash-lite",
      balancedModel: "gemini-3.5-flash",
      powerfulModel: "gemini-3.1-pro",
    },
    nvidia: {
      name: "nvidia",
      enabled: false,
      hasApiKey: false,
      fastModel: "meta/llama-3.1-8b-instruct",
      balancedModel: "meta/llama-4-scout-17b-16e-instruct",
      powerfulModel: "meta/llama-3.1-405b-instruct",
      baseUrl: "https://integrate.api.nvidia.com/v1",
    },
    ollama: {
      name: "ollama",
      enabled: false,
      hasApiKey: true, // Local doesn't need key
      fastModel: "llama3.2:3b",
      balancedModel: "llama3.1:8b",
      powerfulModel: "llama3.1:70b",
      baseUrl: "http://localhost:11434",
    },
  },
  pendingRequests: {},
  streamingText: null,

  setActiveProvider: (provider) => set({ activeProvider: provider }),
  setProviders: (providers) => set({ providers }),
  updateProviderConfig: (provider, config) =>
    set((state) => ({
      providers: {
        ...state.providers,
        [provider]: {
          ...state.providers[provider],
          ...config,
        },
      },
    })),
  addPendingRequest: (requestId, req) =>
    set((state) => ({
      pendingRequests: {
        ...state.pendingRequests,
        [requestId]: req,
      },
    })),
  removePendingRequest: (requestId) =>
    set((state) => {
      const copy = { ...state.pendingRequests };
      delete copy[requestId];
      return { pendingRequests: copy };
    }),
  setStreamingText: (text) => set({ streamingText: text }),
  appendStreamingText: (text) =>
    set((state) => ({
      streamingText: (state.streamingText || "") + text,
    })),
}));
