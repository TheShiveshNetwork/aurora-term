import { getRuntimeSettings } from '../../runtime-settings';

// Failure results are cached alongside successes so a downed Ollama doesn't
// add probe latency to every generation within the TTL window.
const installedOllamaModelsCache: { baseUrl: string; models: string[]; fetchedAt: number } = {
  baseUrl: '',
  models: [],
  fetchedAt: 0,
};
const OLLAMA_CACHE_TTL_MS = 10_000;

async function getInstalledOllamaModels(baseUrl: string): Promise<string[]> {
  try {
    const url = baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    let data: any;
    try {
      const res = await fetch(`${url}/api/tags`, { signal: controller.signal });
      if (!res.ok) return [];
      data = await res.json();
    } finally {
      clearTimeout(timer);
    }
    return Array.isArray(data?.models)
      ? data.models.map((m: any) => m.name).filter((n: unknown): n is string => typeof n === 'string')
      : [];
  } catch {
    return [];
  }
}

async function getInstalledOllamaModelsCached(baseUrl: string): Promise<string[]> {
  const now = Date.now();
  if (installedOllamaModelsCache.baseUrl === baseUrl && now - installedOllamaModelsCache.fetchedAt < OLLAMA_CACHE_TTL_MS) {
    return installedOllamaModelsCache.models;
  }
  const models = await getInstalledOllamaModels(baseUrl);
  installedOllamaModelsCache.baseUrl = baseUrl;
  installedOllamaModelsCache.models = models;
  installedOllamaModelsCache.fetchedAt = now;
  return models;
}

export async function getModelProvider(
  providerName?: string,
  modelName?: string,
  tier: 'fast' | 'balanced' | 'powerful' = 'balanced',
): Promise<{ id: `${string}/${string}`; url?: string; apiKey?: string }> {
  const settings = getRuntimeSettings();
  const hasActiveProvider = !!settings.activeProvider;
  const activeProvider = settings.activeProvider || providerName;

  // The active provider's per-tier model (live runtime settings) wins over
  // the per-agent default modelName.
  let activeModel = hasActiveProvider ? settings.models[tier] : modelName;
  if (!activeModel) activeModel = modelName;

  if (!activeProvider || activeProvider.trim() === '') {
    throw new Error('No AI provider selected. Please select a provider in Settings → AI.');
  }

  const normalized = activeProvider.toLowerCase();
  const selectedModel = (activeModel || '').trim();

  if (!selectedModel) {
    throw new Error(`No model selected for provider '${activeProvider}'. Please select a model in Settings → AI.`);
  }

  const apiKey = settings.apiKeys[normalized];
  const baseUrl = settings.baseUrls[normalized];

  if (normalized === 'groq') {
    return { id: `groq/${selectedModel}`, apiKey };
  }
  if (normalized === 'gpt-oss') {
    return {
      id: `openai/${selectedModel}`,
      url: baseUrl ?? 'http://localhost:11434/v1',
      apiKey: apiKey ?? 'empty',
    };
  }
  if (normalized === 'kimi') {
    return {
      id: `openai/${selectedModel}`,
      url: 'https://api.moonshot.cn/v1',
      apiKey: apiKey ?? 'empty',
    };
  }
  if (normalized === 'anthropic') {
    return { id: `anthropic/${selectedModel}`, apiKey };
  }
  if (normalized === 'gemini' || normalized === 'google') {
    return { id: `google/${selectedModel}`, apiKey };
  }
  if (normalized === 'openai') {
    return { id: `openai/${selectedModel}`, apiKey };
  }
  if (normalized === 'nvidia') {
    return { id: `nvidia/${selectedModel}`, apiKey };
  }
  if (normalized === 'ollama') {
    const rawUrl = baseUrl || 'http://localhost:11434';
    const cleanUrl = rawUrl.endsWith('/v1') ? rawUrl : `${rawUrl.replace(/\/$/, '')}/v1`;

    let resolvedModel = selectedModel;
    const installed = await getInstalledOllamaModelsCached(rawUrl);
    if (installed.length > 0 && !installed.includes(resolvedModel)) {
      const cleanModel = resolvedModel.split(':')[0];
      const matched = installed.find(
        (m) => m === cleanModel || m.startsWith(cleanModel) || m.split(':')[0] === cleanModel
      );
      resolvedModel = matched || installed[0];
    }

    return {
      id: `openai/${resolvedModel}`,
      url: cleanUrl,
      apiKey: 'empty',
    };
  }

  return { id: `openai/${selectedModel}`, apiKey };
}
