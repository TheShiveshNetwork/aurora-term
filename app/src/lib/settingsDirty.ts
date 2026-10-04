/**
 * Decides whether the Settings page has unsaved changes.
 *
 * Two fields are application-managed rather than user-drafted and are excluded:
 *
 *  - `config.cloud` — Upload/Revert and saving flip `cloud.synced` on their own,
 *    so including it creates a save↔sync loop where the page always looks dirty.
 *  - `config.ai.active_provider` — switching the default provider persists and
 *    applies immediately (see `setActiveProviderNow`), so it is never awaiting a
 *    Save or Apply.
 *
 * Excluding a field means it cannot hold the banner open on its own, while any
 * other pending edit still can.
 */

/**
 * Config is typed as `unknown` rather than `Record<string, any>`: `AppConfig` is
 * an interface, and interfaces have no implicit index signature, so it is not
 * assignable to a `Record<string, any>` parameter.
 */
export interface DraftLike {
  config?: unknown;
}

export function normalizeDraft(d: DraftLike | null): string {
  if (!d) return "";
  const copy: any = JSON.parse(JSON.stringify(d));
  if (copy.config) {
    delete copy.config.cloud;
    if (copy.config.ai) delete copy.config.ai.active_provider;
  }
  return JSON.stringify(copy);
}

export function hasUnsavedChanges(draft: DraftLike | null, initial: DraftLike | null): boolean {
  return !!draft && !!initial && normalizeDraft(draft) !== normalizeDraft(initial);
}
