export type ProviderName = 'anthropic' | 'openai' | 'gemini' | 'nvidia' | 'ollama' | 'groq';

export type TaskTier = 'fast' | 'balanced' | 'powerful';

export interface ProviderConfig {
  name: ProviderName;
  enabled: boolean;
  hasApiKey: boolean;
  fastModel: string;
  balancedModel: string;
  powerfulModel: string;
  baseUrl?: string;
}

export interface ModelInfo {
  id: string;
  display_name: string;
  supports_tools: boolean;
  max_tokens: number | null;
  context_window: number | null;
}