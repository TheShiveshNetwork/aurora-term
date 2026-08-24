import { getRuntimeSettings } from './runtime-settings';

/**
 * Working-memory compatibility policy (#55).
 *
 * Mastra's built-in working memory injects its template/data into the system
 * message wrapped in hardcoded XML-style tags (<working_memory_data> etc.) in
 * BOTH markdown-template and schema modes (see getWorkingMemoryToolInstruction
 * in @mastra/memory). Certain Llama-family models — notably Groq-hosted Llamas
 * — misinterpret that XML as function-call syntax and start emitting
 * <function=name{...}> instead of proper JSON tool calls (the original bug that
 * led to workingMemory being blanket-disabled).
 *
 * There is no framework configuration to deliver working memory without those
 * tags, so for the models below the feature stays OFF; everything else gets
 * the standard implementation enabled.
 */

/**
 * Checklist of model ID fragments whose families break on the XML-wrapped
 * working-memory injection. Matched as lowercase substrings against the
 * resolved model ID (e.g. "groq/llama-3.1-8b-instant", "openai/llama3.2:3b"
 * for Ollama, "nvidia/meta/llama-3.1-..." for NIM).
 *
 * Keep entries family-scoped (not exact IDs) so point releases of these
 * models stay covered.
 */
export const WORKING_MEMORY_XML_FRAGILE_MODELS: readonly string[] = [
  // Groq-hosted Llama family (confirmed failure mode)
  'llama-3.1',
  'llama-3.2',
  'llama-3.3',
  'llama3',
  'llama-2',
  // NVIDIA NIM Llama hosting shares the family
  'meta/llama',
  // Local Ollama llama tags (llama3.2:3b, llama3.1:8b-instruct-q4_0, ...)
];

/**
 * Returns the matching fragile-model fragment for any of the given model IDs,
 * or null when none match (i.e. working memory is safe to enable).
 */
export function findWorkingMemoryFragileMatch(...modelIds: (string | undefined)[]): string | null {
  for (const raw of modelIds) {
    if (!raw) continue;
    const id = raw.toLowerCase();
    for (const fragment of WORKING_MEMORY_XML_FRAGILE_MODELS) {
      if (id.includes(fragment)) return fragment;
    }
  }
  return null;
}

/**
 * Decide whether working memory should be enabled for the current request.
 *
 * Checks the per-request model override (if any) plus every configured tier
 * model from the live runtime settings — if ANY of them belongs to a fragile
 * family, the XML wrapper would reach that model's context, so the feature is
 * disabled for the whole request.
 */
export function isWorkingMemoryEnabled(modelOverride?: string): boolean {
  const settings = getRuntimeSettings();
  return findWorkingMemoryFragileMatch(
    modelOverride,
    settings.activeProvider && `${settings.activeProvider}/${settings.models.balanced}`,
    settings.activeProvider && `${settings.activeProvider}/${settings.models.fast}`,
    settings.activeProvider && `${settings.activeProvider}/${settings.models.powerful}`,
  ) === null;
}
