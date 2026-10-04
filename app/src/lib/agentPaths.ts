import { useAppShellStore } from "../stores/useAppShellStore";
import { system } from "./ipc";

/** Drive letter (`C:\`), UNC (`\\server\share`), or a POSIX root (`/home`). */
const ABSOLUTE = /^(?:[a-zA-Z]:[\\/]|[\\/])/;

export function isAbsolutePath(path: string): boolean {
  return ABSOLUTE.test(path);
}

/**
 * The agent sends tool paths as the model wrote them, which is usually relative
 * to the sidecar's working directory. The sidecar resolves those against its own
 * cwd and writes the file successfully, but every filesystem IPC the frontend
 * makes (`read_file_content`, `path_exists`) resolves relative paths against the
 * Tauri process's cwd instead — so a file the agent just wrote comes back as
 * "could not be read" when opened from the UI.
 *
 * Resolving once, as the path enters the app, keeps every downstream consumer
 * (file viewer, diff tabs, undo snapshots) working off the same absolute path.
 */
export function resolveAgentPath(path: string): string {
  const trimmed = (path ?? "").trim();
  if (!trimmed || isAbsolutePath(trimmed)) return trimmed;

  const base = useAppShellStore.getState().projectDir || useAppShellStore.getState().cwdAbsolute;
  if (!base) return trimmed;

  const separator = base.includes("\\") ? "\\" : "/";
  const root = base.replace(/[\\/]+$/, "");
  return `${root}${separator}${trimmed.replace(/^\.\//, "").replace(/[\\/]+/g, separator)}`;
}

/**
 * Path for display: relative to the open project when the file lives inside it,
 * so the UI shows `src/app/main.ts` rather than a machine-specific absolute path.
 * Files outside the project keep their absolute path, since a relative form
 * would be misleading. Separators are normalised to forward slashes.
 */
export function projectRelativePath(path: string, base?: string): string {
  const normalized = path.replace(/\\/g, "/");
  const activeProject = useAppShellStore.getState().projectDir;
  const activeCwd = useAppShellStore.getState().cwdAbsolute;
  const root = (base ?? activeProject ?? activeCwd ?? "").replace(/\\/g, "/").replace(/\/+$/, "");

  if (!root) return normalized;
  const comparable = /^[a-zA-Z]:/.test(root) ? normalized.toLowerCase() : normalized;
  const comparableRoot = /^[a-zA-Z]:/.test(root) ? root.toLowerCase() : root;
  if (comparable === comparableRoot) return "";
  if (comparable.startsWith(`${comparableRoot}/`)) {
    return normalized.slice(root.length + 1);
  }
  return normalized;
}

function joinBase(base: string, relative: string): string {
  const separator = base.includes("\\") ? "\\" : "/";
  return `${base.replace(/[\\/]+$/, "")}${separator}${relative
    .replace(/^\.\//, "")
    .replace(/[\\/]+/g, separator)}`;
}

/**
 * Every plausible location for an agent-written path, most authoritative first.
 *
 * Sessions recorded before paths were normalised hold either a bare relative path
 * or an absolute path built against the wrong base, so a single guess is not
 * enough. Each base is one the agent could genuinely have resolved against: the
 * project root, and the sidecar's own working directory (which is its package
 * folder in dev, and is where relative paths used to land).
 */
export function agentPathCandidates(path: string, extraBases: string[] = []): string[] {
  const trimmed = (path ?? "").trim();
  if (!trimmed) return [];
  if (isAbsolutePath(trimmed)) return [trimmed];

  const bases = [
    useAppShellStore.getState().projectDir,
    useAppShellStore.getState().cwdAbsolute,
    ...extraBases,
  ].filter((base): base is string => !!base);

  const seen = new Set<string>();
  const options: string[] = [];
  for (const base of bases) {
    const candidate = joinBase(base, trimmed);
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    options.push(candidate);
  }
  return options.length > 0 ? options : [trimmed];
}

export function dirnameOf(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (index <= 0) return index === 0 ? normalized.slice(0, 1) : "";
  return normalized.slice(0, index);
}

/**
 * Resolves to the first candidate that actually exists, falling back to the
 * primary guess so callers still get a usable path when nothing matches.
 */
export async function resolveExistingAgentPath(
  path: string,
  extraBases: string[] = [],
): Promise<{ path: string; exists: boolean }> {
  const options = agentPathCandidates(path, extraBases);
  for (const option of options) {
    try {
      if (await system.pathExists(option)) return { path: option, exists: true };
    } catch {
      // keep trying the next candidate
    }
  }
  return { path: options[0] ?? path, exists: false };
}
