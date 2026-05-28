export type ProviderName = 'anthropic' | 'openai' | 'gemini' | 'nvidia' | 'ollama';

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