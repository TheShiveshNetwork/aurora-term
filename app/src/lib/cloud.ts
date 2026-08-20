import { createClient } from "@supabase/supabase-js";
import { config, system, SyncAction, SyncResult, AuthStatus } from "./ipc";

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

const WEB_AUTH_URL =
  (import.meta.env.VITE_WEB_AUTH_URL as string | undefined) ??
  "http://localhost:5175/signin";
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

// Deep-merge `over` on top of `base` (remote wins). Used for the "merge"
// conflict resolution.
function deepMerge(base: any, over: any): any {
  if (Array.isArray(base) || Array.isArray(over)) return over;
  if (base && typeof base === "object" && over && typeof over === "object") {
    const out: Record<string, any> = { ...base };
    for (const k of Object.keys(over)) {
      out[k] = k in base ? deepMerge(base[k], over[k]) : over[k];
    }
    return out;
  }
  return over;
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

// ── Sync (compare-and-swap under RLS) ───────────────────────────────────

export async function syncNow(cfg: any): Promise<SyncResult> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return { status: "signed_out", remote_payload: null, remote_version: null, remote_updated_at: null };
  }
  const userId = userData.user.id;

  const version = await contentHash(cfg);

  const { data: remote, error: fetchErr } = await supabase
    .from("configs")
    .select("version, payload, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (fetchErr) throw new Error(fetchErr.message);

  // No remote document yet → seed it with the local config.
  if (!remote) {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("configs")
      .insert({ user_id: userId, version, payload: cfg, updated_at: now });
    if (error) throw new Error(error.message);
    return { status: "pushed", remote_payload: cfg, remote_version: version, remote_updated_at: now };
  }

  // Identical content → already in sync.
  if (remote.version === version) {
    return { status: "synced", remote_payload: remote.payload, remote_version: remote.version, remote_updated_at: remote.updated_at };
  }

  // CAS update: succeeds only if the remote hasn't changed since we read it.
  const now = new Date().toISOString();
  const { data: updated, error: updErr } = await supabase
    .from("configs")
    .update({ version, payload: cfg, updated_at: now })
    .eq("user_id", userId)
    .eq("version", remote.version)
    .select("version, payload, updated_at");
  if (updErr) throw new Error(updErr.message);
  if (!updated || updated.length === 0) {
    const { data: cur } = await supabase
      .from("configs")
      .select("version, payload, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    return { status: "conflict", remote_payload: cur?.payload ?? null, remote_version: cur?.version ?? null, remote_updated_at: cur?.updated_at ?? null };
  }
  return { status: "pushed", remote_payload: updated[0].payload, remote_version: updated[0].version, remote_updated_at: updated[0].updated_at };
}

export async function resolveConflict(
  action: SyncAction,
  cfg: any,
  remoteVersion: string,
): Promise<SyncResult> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return { status: "signed_out", remote_payload: null, remote_version: null, remote_updated_at: null };
  }
  const userId = userData.user.id;
  const now = new Date().toISOString();

  // Adopt the cloud document wholesale.
  if (action === "keep_cloud") {
    const { data: remote, error } = await supabase
      .from("configs")
      .select("version, payload, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!remote) throw new Error("No cloud config to adopt");
    if (remote.payload) await config.saveGlobal(remote.payload as any);
    return { status: "pulled", remote_payload: remote.payload, remote_version: remote.version, remote_updated_at: remote.updated_at };
  }

  const basePayload =
    action === "merge"
      ? deepMerge(
          cfg,
          (await supabase.from("configs").select("payload").eq("user_id", userId).maybeSingle()).data?.payload ?? {},
        )
      : cfg;
  const version = await contentHash(basePayload);

  const { data: updated, error } = await supabase
    .from("configs")
    .update({ version, payload: basePayload, updated_at: now })
    .eq("user_id", userId)
    .eq("version", remoteVersion)
    .select("version, payload, updated_at");
  if (error) throw new Error(error.message);
  if (!updated || updated.length === 0) {
    const { data: cur } = await supabase
      .from("configs")
      .select("version, payload, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    return { status: "conflict", remote_payload: cur?.payload ?? null, remote_version: cur?.version ?? null, remote_updated_at: cur?.updated_at ?? null };
  }
  // `keep_local` publishes the local doc; `merge` publishes the blended doc,
  // which the UI treats like a pull.
  const status = action === "merge" ? "pulled" : "pushed";
  if (status === "pulled") await config.saveGlobal(updated[0].payload as any);
  return { status, remote_payload: updated[0].payload, remote_version: updated[0].version, remote_updated_at: updated[0].updated_at };
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
  syncNow,
  resolveConflict,
};
