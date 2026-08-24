/**
 * Live, mutable AI settings for the running agent process.
 *
 * These are initialized from the environment variables injected at sidecar
 * spawn time, but can be updated at runtime via POST /api/settings so that
 * changes made in Settings → AI take effect on the next generation without
 * restarting the agent process.
 *
 * This is what makes "switch provider in Settings → AI" work immediately:
 * `getModelProvider` reads from here instead of the frozen `process.env`, and
 * every agent's `model` is a function that re-resolves it per generation.
 */

export interface RuntimeSettings {
  activeProvider: string;
  models: { fast: string; balanced: string; powerful: string };
  baseUrls: Record<string, string>;
  apiKeys: Record<string, string>;
}

type EnvLike = Record<string, string | undefined>;

function parseEnv(env: EnvLike): RuntimeSettings {
  const models = {
    fast: env.ACTIVE_AI_MODEL_FAST || "",
    balanced: env.ACTIVE_AI_MODEL_BALANCED || "",
    powerful: env.ACTIVE_AI_MODEL_POWERFUL || "",
  };

  const baseUrls: Record<string, string> = {};
  if (env.GPT_OSS_BASE_URL) baseUrls["gpt-oss"] = env.GPT_OSS_BASE_URL;
  if (env.OLLAMA_BASE_URL) baseUrls["ollama"] = env.OLLAMA_BASE_URL;

  const apiKeys: Record<string, string> = {};
  if (env.GROQ_API_KEY) apiKeys["groq"] = env.GROQ_API_KEY;
  if (env.OPENAI_API_KEY) apiKeys["openai"] = env.OPENAI_API_KEY;
  if (env.GPT_OSS_API_KEY) apiKeys["gpt-oss"] = env.GPT_OSS_API_KEY;
  if (env.KIMI_API_KEY) apiKeys["kimi"] = env.KIMI_API_KEY;
  if (env.ANTHROPIC_API_KEY) apiKeys["anthropic"] = env.ANTHROPIC_API_KEY;
  if (env.GOOGLE_GENERATIVE_AI_API_KEY) apiKeys["gemini"] = env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (env.NVIDIA_API_KEY) apiKeys["nvidia"] = env.NVIDIA_API_KEY;

  return {
    activeProvider: (env.ACTIVE_AI_PROVIDER || "").toLowerCase(),
    models,
    baseUrls,
    apiKeys,
  };
}

let runtimeSettings: RuntimeSettings = parseEnv(process.env as EnvLike);

export function getRuntimeSettings(): RuntimeSettings {
  return runtimeSettings;
}

/**
 * Replace the live settings from an env-like map. The map uses the same keys as
 * the sidecar spawn environment (ACTIVE_AI_PROVIDER, ACTIVE_AI_MODEL_*,
 * *API_KEY, *_BASE_URL). Keys that are absent are cleared so a provider
 * without a configured key no longer leaks a stale credential.
 */
export function updateRuntimeSettingsFromEnv(env: EnvLike): void {
  runtimeSettings = parseEnv(env);
}
