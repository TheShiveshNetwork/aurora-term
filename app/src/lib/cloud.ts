import { listen } from "@tauri-apps/api/event";
import { AuthStatus } from "./ipc";
import { WEB_AUTH_URL } from "../../configs/appConfig";

// The desktop talks to the Aurora backend (Cloudflare Worker) with its own
// opaque session token. All reads/writes on `/v1/sync` are scoped to the bearer
// token's user server-side — the app never holds any shared secret.

const API_URL =
  (import.meta.env.VITE_AURORA_API_URL as string | undefined) ??
  "https://api.aurora.shitworks.co";

const DEEP_LINK_SCHEME = "aurora://auth/callback";

// Local session store (rendered unusable by any uuid that isn't ours).
const SESSION_KEY = "aurora_session";

type StoredSession = { token: string; email: string; username: string };

function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    return parsed.token ? parsed : null;
  } catch {
    return null;
  }
}

function saveSession(session: StoredSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

const AUTH_CHANGED = "aurora-auth-changed";

class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function api<T>(path: string, init?: RequestInit & { token?: string }): Promise<T> {
  const token = init?.token ?? loadSession()?.token;
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (res.status === 401) {
    clearSession();
    window.dispatchEvent(new CustomEvent(AUTH_CHANGED));
    throw new ApiError("Unauthorized", 401);
  }
  const text = await res.text();
  if (res.status === 204) return undefined as T;
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status})`, res.status);
  }
  return data as T;
}

// ── Content hashing (last-writer-wins) ───────────────────────────────────
// Mirrors the Worker/Rust algorithm: SHA-256 over canonical JSON with
// recursively sorted object keys, so the hash is stable across clients.

function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  return crypto.subtle.digest("SHA-256", data).then((buf) => {
    const bytes = new Uint8Array(buf);
    let out = "";
    for (const b of bytes) out += b.toString(16).padStart(2, "0");
    return out;
  });
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object" && value.constructor === Object) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = canonicalJson((value as Record<string, unknown>)[k]);
    }
    return sorted;
  }
  return value;
}

function contentHash(payload: unknown): Promise<string> {
  return sha256Hex(JSON.stringify(canonicalJson(payload)));
}

// ── Auth status ─────────────────────────────────────────────────────────

export async function authStatus(): Promise<AuthStatus> {
  const stored = loadSession();
  if (!stored) return { signed_in: false, email: null, username: null };
  try {
    const me = await api<{ email: string; username: string }>("/v1/auth/me");
    saveSession({ ...stored, email: me.email, username: me.username });
    return { signed_in: true, email: me.email, username: me.username };
  } catch {
    return { signed_in: false, email: null, username: null };
  }
}

export async function signOut(): Promise<void> {
  const token = loadSession()?.token;
  if (token) {
    try {
      await api("/v1/auth/logout", { method: "POST", token, body: "{}" });
    } catch {
      /* best-effort: revoke locally regardless */
    }
  }
  clearSession();
  window.dispatchEvent(new CustomEvent(AUTH_CHANGED));
}

export function onAuthChange(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener(AUTH_CHANGED, handler);
  return () => window.removeEventListener(AUTH_CHANGED, handler);
}

// Open the web companion in the system browser; it performs the GitHub OAuth
// and deep-links the resulting backend token back to this app.
export async function signInOAuth(provider: "github"): Promise<AuthStatus> {
  const url = `${WEB_AUTH_URL}?scheme=${encodeURIComponent(DEEP_LINK_SCHEME)}`;
  const { system } = await import("./ipc");
  await system.openExternalUrl(url);
  return authStatus();
}

// ── Sync (manual upload / download) ─────────────────────────────────────
// The app never auto-syncs. The user explicitly uploads the current config to
// the cloud, or downloads (and applies) the cloud config, via the UI buttons.
// Writes are compare-and-swap on `version` (SHA-256 content hash); a changed
// remote version surfaces as a conflict instead of silently clobbering.

export type RemoteConfig = { payload: any; version: string | null; updated_at: string | null };

export async function uploadSettings(cfg: any): Promise<void> {
  const version = await contentHash(cfg);
  const remote = await downloadSettings();
  const base = remote?.version ?? null;

  const result = await api<{ status?: number }>("/v1/sync", {
    method: "POST",
    body: JSON.stringify({ payload: cfg, version, base_version: base }),
  }).catch(async (e) => {
    if (isConflict(e)) {
      // Overwrite path: retry against the version we just learned about.
      const fresh = await downloadSettings();
      return api("/v1/sync", {
        method: "POST",
        body: JSON.stringify({ payload: cfg, version, base_version: fresh?.version ?? null }),
      });
    }
    throw e;
  });
  void result;
}

export async function downloadSettings(): Promise<RemoteConfig | null> {
  try {
    const doc = await api<{ version: string; updated_at: string; payload: any }>("/v1/sync");
    return { payload: doc.payload, version: doc.version, updated_at: doc.updated_at };
  } catch (e) {
    if ((e as Error).message === "not found") return null;
    throw e;
  }
}

export type SyncState = { exists: boolean; inSync: boolean };

// Compare the local config against the cloud copy without transferring the
// payload. `version` is the content hash of the stored config, so a matching
// hash means nothing needs to be pushed or pulled.
export async function settingsSyncState(cfg: any): Promise<SyncState> {
  const remote = await downloadSettings();
  if (!remote) return { exists: false, inSync: false };
  const localHash = await contentHash(cfg);
  return { exists: true, inSync: localHash === remote.version };
}

// ── Deep-link receipt (web → desktop handoff) ───────────────────────────

export async function importSessionFromUrl(url: string): Promise<void> {
  const hash = url.includes("#") ? url.split("#")[1] : url.includes("?") ? url.split("?")[1] : "";
  const params = new URLSearchParams(hash);
  const token = params.get("token");
  const email = params.get("email") ?? "";
  const username = params.get("username") ?? "";
  if (!token) return;
  saveSession({ token, email, username });
  window.dispatchEvent(new CustomEvent(AUTH_CHANGED));
}

function isConflict(e: unknown): boolean {
  return (e as ApiError)?.status === 409;
}

export function initCloud(): void {
  // Deep links forwarded by the single-instance plugin (Windows/Linux) when the
  // app is already running and the OS spawns a second instance to deliver the
  // `aurora://` URL. The live instance receives it here and imports the session.
  listen<string>("aurora-deep-link", (e) => {
    void importSessionFromUrl(e.payload);
  }).catch(() => {
    /* not in Tauri */
  });

  // The deep-link plugin only exists inside a Tauri build; outside it (e.g.
  // `pnpm dev` in a plain browser) this import simply fails and is ignored.
  import("@tauri-apps/plugin-deep-link")
    .then((m) => {
      m.onOpenUrl((urls: string[]) => {
        for (const u of urls) void importSessionFromUrl(u);
      });
    })
    .catch(() => {
      /* not in Tauri */
    });
}

export const cloud = {
  authStatus,
  onAuthChange,
  signInOAuth,
  signOut,
  uploadSettings,
  downloadSettings,
  settingsSyncState,
};