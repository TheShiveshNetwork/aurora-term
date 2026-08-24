import { ModelInfo, ProviderName } from "@aurora/types";
import { ai as aiIpc, config, system, AppConfig } from "./ipc";
import { useAIStore } from "../stores/useAIStore";

/**
 * Live provider-model defaults.
 *
 * Instead of trusting hardcoded default model IDs, the app fetches each provider's live model
 * list at startup and self-heals the config when any configured tier model is
 * no longer offered by the provider:
 *
 *   1. Fetch live models for every provider we have credentials for.
 *   2. Any configured fast/balanced/powerful (or selected) model missing from
 *      the live list is replaced with a best-fit pick from that list.
 *   3. The correction is persisted to config (so Rust → agent env picks it up)
 *      and pushed to the running agent immediately via /api/settings.
 *
 * Providers without credentials can't be listed — those keep their static
 * defaults until a key is added. Everything here is fire-and-forget: a failed
 * fetch or offline provider is silently skipped and retried next launch.
 */

const PROVIDERS: ProviderName[] = [
  "groq",
  "anthropic",
  "openai",
  "gemini",
  "nvidia",
  "ollama",
];

const FAST_HINTS = ["instant", "flash", "mini", "small", "lite", "-8b", "3b"];
const POWER_HINTS = ["opus", "pro", "large", "120b", "405b", "max"];

function pickTierModels(models: ModelInfo[]): { fast: string; balanced: string; powerful: string } | null {
  // Prefer tool-capable models — every Aurora feature relies on tool calling.
  const capable = models.filter((m) => m.supports_tools);
  const pool = capable.length > 0 ? capable : models;
  if (pool.length === 0) return null;

  const ids = pool.map((m) => m.id.toLowerCase());
  const findHint = (hints: string[]) =>
    pool[ids.findIndex((id) => hints.some((h) => id.includes(h)))];

  const fast = findHint(FAST_HINTS) ?? pool[0];
  const powerful = findHint(POWER_HINTS) ?? pool[pool.length - 1];
  const balanced = pool[Math.floor((pool.length - 1) / 2)] ?? powerful;

  return { fast: fast.id, balanced: balanced.id, powerful: powerful.id };
}

function patchProviderModels(
  cfg: AppConfig,
  provider: ProviderName,
  models: { fast: string; balanced: string; powerful: string },
): AppConfig {
  const current = (cfg.ai as any)[provider];
  if (!current) return cfg;
  return {
    ...cfg,
    ai: {
      ...cfg.ai,
      [provider]: {
        ...current,
        fast_model: models.fast,
        balanced_model: models.balanced,
        powerful_model: models.powerful,
      },
    },
  };
}

async function healProvider(
  cfg: AppConfig,
  provider: ProviderName,
): Promise<AppConfig | null> {
  let live: ModelInfo[] = [];
  try {
    live = await aiIpc.fetchModels(provider);
  } catch {
    return null; // No key / server down / network error — keep current defaults.
  }
  if (!Array.isArray(live) || live.length === 0) return null;

  const liveIds = new Set(live.map((m) => m.id));
  const p = (cfg.ai as any)[provider];
  if (!p) return null;

  // Any tier that is unset (empty) or no longer offered by the provider is
  // stale and needs healing. Empty tiers are the normal state on a fresh
  // install — there are deliberately no static defaults to fall back on
  // Single-model mode is respected: only an invalid selected_model is healed.
  const tiers = ["fast_model", "balanced_model", "powerful_model"] as const;
  const usingSelected = !!p.selected_model;
  const stale = usingSelected
    ? !liveIds.has(p.selected_model)
    : tiers.some((t) => !p[t] || !liveIds.has(p[t]));
  if (!stale) return null; // Config is already valid against live data.

  const picked = pickTierModels(live);
  if (!picked) return null;

  let patched: AppConfig;
  if (usingSelected) {
    patched = cfg;
    (patched.ai as any)[provider].selected_model = picked.balanced;
  } else {
    patched = patchProviderModels(cfg, provider, picked);
  }
  const updated = (patched.ai as any)[provider];

  console.warn(
    `[model-defaults] ${provider}: configured model(s) no longer available — healed to ` +
    `${updated.fast_model} / ${updated.balanced_model} / ${updated.powerful_model}`
  );

  // Persist so the Rust side (agent env, native AI router) uses them too…
  await config.saveGlobal(patched);
  // …and push straight into the running agent without waiting for a restart
  try {
    await system.agentUpdateSettings(patched);
  } catch {
    // Agent not running yet — it will read the persisted config at spawn.
  }

  // Reflect in UI state.
  useAIStore.getState().updateProviderConfig(provider, {
    fastModel: updated.fast_model,
    balancedModel: updated.balanced_model,
    powerfulModel: updated.powerful_model,
    selectedModel: updated.selected_model ?? "",
  });

  return patched;
}

/**
 * Refresh provider defaults from live provider APIs. Call once after bootstrap;
 * never throws. Returns the (possibly healed) config, or null when unchanged.
 */
export async function syncProviderModelDefaults(): Promise<AppConfig | null> {
  let cfg: AppConfig;
  try {
    cfg = await config.get();
  } catch {
    return null;
  }

  let keyStatus: Record<string, boolean> = {};
  try {
    keyStatus = await aiIpc.getProviderStatus();
  } catch {
    // Without keyring status we simply attempt nothing for keyed providers.
  }

  let healedAny = false;
  try {
    for (const provider of PROVIDERS) {
      const info = (cfg.ai as any)[provider];
      if (!info?.enabled) continue;
      // Ollama needs no key; everyone else requires one before we can list.
      if (provider !== "ollama" && !keyStatus[provider]) continue;
      const healed = await healProvider(cfg, provider);
      if (healed) {
        cfg = healed;
        healedAny = true;
      }
    }
  } catch (e) {
    console.warn("[model-defaults] sync failed", e);
  }
  return healedAny ? cfg : null;
}
