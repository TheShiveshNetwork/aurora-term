import { create } from "zustand";
import { ProviderName, ProviderConfig, TaskTier } from "@aurora/types";

interface PendingRequest {
  tier: TaskTier;
  abortable: boolean;
}

// Model defaults are intentionally NOT hardcoded here. They are hydrated from
// the persisted config at bootstrap (applyAppConfig) and then healed against
// each provider's live model list — see lib/modelDefaults.ts
const emptyModels = { fastModel: "", balancedModel: "", powerfulModel: "", selectedModel: "" };

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
  activeProvider: "groq",
  providers: {
    groq: {
      name: "groq",
      enabled: true,
      hasApiKey: false,
      baseUrl: undefined,
      ...emptyModels,
    },
    anthropic: {
      name: "anthropic",
      enabled: true,
      hasApiKey: false,
      baseUrl: undefined,
      ...emptyModels,
    },
    openai: {
      name: "openai",
      enabled: false,
      hasApiKey: false,
      baseUrl: "https://api.openai.com/v1",
      ...emptyModels,
    },
    gemini: {
      name: "gemini",
      enabled: false,
      hasApiKey: false,
      baseUrl: undefined,
      ...emptyModels,
    },
    nvidia: {
      name: "nvidia",
      enabled: false,
      hasApiKey: false,
      baseUrl: "https://integrate.api.nvidia.com/v1",
      ...emptyModels,
    },
    ollama: {
      name: "ollama",
      enabled: false,
      hasApiKey: true, // Local doesn't need key
      baseUrl: "http://localhost:11434",
      ...emptyModels,
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
