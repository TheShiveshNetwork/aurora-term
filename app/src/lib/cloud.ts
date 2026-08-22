import { createClient } from "@supabase/supabase-js";
import { listen } from "@tauri-apps/api/event";
import { system, AuthStatus } from "./ipc";
import { WEB_AUTH_URL } from "../../configs/appConfig";

// The desktop talks to Supabase directly with the publishable key (public by
// design). All reads/writes go through Row Level Security, so a user can only
// ever touch their own `configs` / `users` rows — never another account's, and
// the service-role key is never present in the app.
const SUPABASE_URL =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ??
  "https://yybxsggbvuzjzlwlwbtv.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ??
  "sb_publishable_RLefJueP40i_3FjO_D_7zw_fBYcAoDb";

const DEEP_LINK_SCHEME = "aurora://auth/callback";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    // The WebView persists the session locally; the deep link hands a fresh
    // session to us when the user signs in through the web companion.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

const AUTH_CHANGED = "aurora-auth-changed";

// ── Content hashing (last-writer-wins) ───────────────────────────────────
// Mirrors the function/Rust algorithm: SHA-256 over canonical JSON with
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
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) return { signed_in: false, email: null, username: null };
  const u = session.user;
  const meta = (u.user_metadata ?? {}) as Record<string, any>;
  const username = meta.user_name ?? meta.name ?? u.email ?? null;
  return { signed_in: true, email: u.email ?? null, username: username ?? null };
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
  window.dispatchEvent(new CustomEvent(AUTH_CHANGED));
}

export function onAuthChange(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener(AUTH_CHANGED, handler);
  return () => window.removeEventListener(AUTH_CHANGED, handler);
}

// Open the web companion in the system browser; it performs the OAuth and
// deep-links the resulting Supabase session back to this app.
export async function signInOAuth(provider: "github" | "google"): Promise<AuthStatus> {
  const url = `${WEB_AUTH_URL}?scheme=${encodeURIComponent(DEEP_LINK_SCHEME)}`;
  await system.openExternalUrl(url);
  // The real sign-in completes via the deep-link handler below.
  return authStatus();
}

// ── Sync (manual upload / download under RLS) ────────────────────────────
// The app never auto-syncs. The user explicitly uploads the current config to
// the cloud, or downloads (and applies) the cloud config, via the UI buttons.
// Each operation is a plain upsert / read of the user's `configs` row, so there
// is no conflict resolution or merge step.

export async function uploadSettings(cfg: any): Promise<void> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) throw new Error("Not signed in");
  const userId = userData.user.id;

  const version = await contentHash(cfg);
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("configs")
    .upsert({ user_id: userId, version, payload: cfg, updated_at: now }, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
}

export type RemoteConfig = { payload: any; version: string | null; updated_at: string | null };

export async function downloadSettings(): Promise<RemoteConfig | null> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) throw new Error("Not signed in");
  const userId = userData.user.id;

  const { data, error } = await supabase
    .from("configs")
    .select("payload, version, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
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
  const hash = url.includes("#") ? url.split("#")[1] : "";
  const params = new URLSearchParams(hash);
  const access = params.get("access_token");
  const refresh = params.get("refresh_token");
  if (!access || !refresh) return;
  const { error } = await supabase.auth.setSession({ access_token: access, refresh_token: refresh });
  if (error) throw new Error(error.message);
  window.dispatchEvent(new CustomEvent(AUTH_CHANGED));
}

export function initCloud(): void {
  // Reflect any Supabase auth-state change (including the deep-link handoff's
  // setSession, and sign-out) into our UI event, so the account menu always
  // shows the current sign-in state without depending solely on the deep-link
  // callback firing first.
  supabase.auth.onAuthStateChange(() => {
    window.dispatchEvent(new CustomEvent(AUTH_CHANGED));
  });

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
