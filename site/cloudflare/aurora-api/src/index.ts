/**
 * Aurora backend — Cloudflare Worker.
 *
 * Self-contained (`fetch` router, no framework). It is the single backend for
 * the web companion, the Tauri desktop app, and the release-mirror GitHub
 * Action, exposing this API surface:
 *
 *   GET  /v1/health               -> { ok: true }
 *   POST /v1/auth/start-oauth     -> GitHub authorize URL (PKCE forwarded)
 *   POST /v1/auth/oauth-exchange  -> { token, email, username }
 *   POST /v1/auth/logout          (Bearer token)
 *   GET  /v1/auth/me              (Bearer token) -> { email, username }
 *   GET  /v1/sync                 (Bearer token) -> sync doc or 404
 *   POST /v1/sync                 (Bearer token) -> store doc (CAS -> 409)
 *   GET  /v1/update/latest        -> app_release row (mirrors installers to R2)
 *   GET  /v1/update/lsp           -> lsp_release row (GitHub-backed)
 *   POST /v1/update/store         (Bearer AURORA_DEPLOY_TOKEN) -> force re-mirror
 *
 * Storage:
 *   D1 (`DB`)  — users, sessions, configs (settings sync), release_cache, oauth state.
 *   R2 (`MIRROR_BUCKET`) — public `aurora` bucket re-hosting built installers at
 *   versioned, permanent paths; served via an R2 custom domain (R2_PUBLIC_URL).
 *
 * Secrets:      wrangler secret put GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET ...
 * Non-secrets:  AURORA_MAX_ASSET_BYTES, CACHE_TTL_MS, R2_PUBLIC_URL, ALLOWED_ORIGINS
 *               (vars in wrangler.toml or --var).
 *
 * Layout mirrors the old edge function 1:1 so the move is a drop-in swap of
 * `api_base_url` on every client.
 */

const GITHUB_AUTHORIZE = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_API = "https://api.github.com";

const APP_CACHE_KEY = "app_release";
const LSP_CACHE_KEY = "lsp_release";

const DEFAULT_TTL_S = 3 * 60 * 60; // 3 h
const DEFAULT_MAX_ASSET_BYTES = 50 * 1024 * 1024; // 50 MiB
const SESSION_TTL_S = 90 * 24 * 60 * 60; // 90 days

type Json = Record<string, unknown>;

function envNum(env: Env, name: keyof Env, fallback: number): number {
  const raw = env[name];
  if (typeof raw !== "string") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────

function json(data: unknown, status = 200, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin");
  const allowed = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allowAll = allowed.length === 0 || allowed.includes("*");
  const allowThis = origin && allowed.includes(origin);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
  if (!origin) return headers; // non-browser caller
  if (allowAll) headers["Access-Control-Allow-Origin"] = "*";
  else if (allowThis && origin) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

async function readBody<T extends Json>(request: Request): Promise<T | null> {
  try {
    const text = await request.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

// ─── Crypto helpers ──────────────────────────────────────────────────────────

const enc = new TextEncoder();

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Stateless OAuth `state`: HMAC-signed JSON { redirect_uri, code_challenge }.
 * Crucially this binds the GitHub callback to the exact redirect_uri+challenge
 * pair the client started with, so a replayed/mismatched callback cannot be
 * swapped to a different destination (the same job CSRF `state` performs).
 */
interface OAuthState {
  r: string; // redirect_uri
  c: string; // code_challenge
}

async function signState(env: Env, st: OAuthState): Promise<string> {
  const secret = env.STATE_SECRET || env.GITHUB_CLIENT_SECRET || "aurora-dev-state";
  const body = JSON.stringify(st);
  const sig = await hmacHex(secret, body);
  return `${base64Url(enc.encode(body))}.${sig}`;
}

function base64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function verifyState(env: Env, token: string | null): Promise<OAuthState | null> {
  if (!token) return null;
  const secret = env.STATE_SECRET || env.GITHUB_CLIENT_SECRET || "aurora-dev-state";
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await hmacHex(secret, body);
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) if (sig.charCodeAt(i) !== expected.charCodeAt(i)) diff++;
  if (diff > 0) return null;
  try {
    const b64 = body.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const text = atob(padded);
    return JSON.parse(text) as OAuthState;
  } catch {
    return null;
  }
}

// ─── D1 helpers ──────────────────────────────────────────────────────────────

interface UserRow {
  id: string;
  github_id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
}

interface SessionUser {
  token: string;
  user_id: string;
  login: string;
  email: string | null;
  expires_at: number;
}

async function findSession(env: Env, token: string | null): Promise<SessionUser | null> {
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT s.token, s.user_id, s.expires_at, u.login, u.email
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ?`,
  )
    .bind(token)
    .first<SessionUser>();
  if (!row) return null;
  if (row.expires_at <= Math.floor(Date.now() / 1000)) {
    await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
    return null;
  }
  return row;
}

function requireBearer(request: Request): string | null {
  const auth = request.headers.get("Authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : null;
}

// ─── GitHub proxy ────────────────────────────────────────────────────────────

function ghHeaders(env: Env, extra?: Record<string, string>): HeadersInit {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "aurora-update-check",
    "X-GitHub-Api-Version": "2022-11-28",
    ...extra,
  };
  if (env.GITHUB_TOKEN) h.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  return h;
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T | null> {
  const res = await fetch(url, init);
  if (!res.ok) return null;
  return (await res.json()) as T;
}

async function fetchReleasesList(env: Env): Promise<Array<Record<string, unknown>> | null> {
  if (!env.GITHUB_REPO) return null;
  return fetchJson(
    `${GITHUB_API}/repos/${env.GITHUB_REPO}/releases?per_page=100`,
    { headers: ghHeaders(env) },
  );
}

async function exchangeCodeForGitHubToken(env: Env, body: Record<string, string>): Promise<string | null> {
  const res = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "aurora-api",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string; error?: string };
  return data.access_token ?? null;
}

function githubAvatar(id: number): string | null {
  return id ? `https://avatars.githubusercontent.com/u/${id}?v=4` : null;
}

// ─── Auth routes ─────────────────────────────────────────────────────────────

async function routeStartOauth(request: Request, env: Env): Promise<Response> {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    return json({ error: "GitHub OAuth app not configured" }, 500);
  }
  const body = await readBody<Record<string, string>>(request);
  const redirect_uri = body?.redirect_uri ?? "";
  const provider = body?.provider ?? "github";
  const code_challenge = body?.code_challenge ?? "";
  const method = body?.code_challenge_method ?? "S256";
  if (provider !== "github" || !redirect_uri || !code_challenge) {
    return json({ error: "missing provider, redirect_uri or code_challenge" }, 400);
  }
  const state = await signState(env, { r: redirect_uri, c: code_challenge });
  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri,
    scope: "read:user user:email",
    state,
    allow_signup: "false",
  });
  // GitHub supports PKCE: forward the challenge so the returned code is bound
  // to the verifier the client generated (https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps).
  if (code_challenge) {
    params.set("code_challenge", code_challenge);
    params.set("code_challenge_method", method === "plain" ? "plain" : "S256");
  }
  return json({ authorize_url: `${GITHUB_AUTHORIZE}?${params.toString()}` });
}

async function routeOauthExchange(request: Request, env: Env): Promise<Response> {
  const body = await readBody<Record<string, string>>(request);
  const code = body?.code ?? "";
  const redirect_uri = body?.redirect_uri ?? "";
  if (!code || !redirect_uri) {
    return json({ error: "missing code or redirect_uri" }, 400);
  }
  const state = await verifyState(env, body?.state ?? null);
  if (state && state.r !== redirect_uri) {
    return json({ error: "state/redirect_uri mismatch" }, 400);
  }

  const exchange: Record<string, string> = {
    client_id: env.GITHUB_CLIENT_ID,
    client_secret: env.GITHUB_CLIENT_SECRET,
    code,
    redirect_uri,
  };
  if (body?.code_verifier) exchange.code_verifier = body.code_verifier;

  const access_token = await exchangeCodeForGitHubToken(env, exchange);
  if (!access_token) {
    return json({ error: "github code exchange failed" }, 401);
  }

  // Always re-validate the account: a user can switch GitHub accounts mid-flow.
  const gh = await fetchJson<Record<string, unknown>>(`${GITHUB_API}/user`, {
    headers: { Authorization: `Bearer ${access_token}`, Accept: "application/vnd.github+json", "User-Agent": "aurora-api" },
  });
  if (!gh?.id) return json({ error: "github user lookup failed" }, 401);

  const githubId = Number(gh.id);
  const login = String(gh.login ?? "");
  const name = typeof gh.name === "string" ? gh.name : null;
  const email = typeof gh.email === "string" && gh.email ? gh.email : null;
  const avatar = githubAvatar(githubId);
  const id = String(githubId);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, github_id, login, name, email, avatar_url)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET login = excluded.login, name = excluded.name,
         email = excluded.email, avatar_url = excluded.avatar_url`,
    ).bind(id, githubId, login, name, email, avatar),
    // Opportunistic cleanup of expired sessions.
    env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(Math.floor(Date.now() / 1000)),
  ]);

  const token = randomHex(32);
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_S;
  await env.DB.prepare(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
  ).bind(token, id, expiresAt).run();

  return json({
    token,
    email: email ?? `${login}@users.noreply.github.com`,
    username: login,
  });
}

async function routeLogout(request: Request, env: Env): Promise<Response> {
  const token = requireBearer(request);
  if (!token) return json({ error: "unauthorized" }, 401);
  await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  return json({ ok: true });
}

async function routeMe(request: Request, env: Env): Promise<Response> {
  const session = await findSession(env, requireBearer(request));
  if (!session) return json({ error: "unauthorized" }, 401);
  const email = session.email ?? `${session.login}@users.noreply.github.com`;
  return json({ email, username: session.login });
}

// ─── Sync routes (settings sync; CAS) ────────────────────────────────────────

interface SyncDoc {
  version: string;
  updated_at: string;
  payload: unknown;
}

async function syncDocFor(env: Env, userId: string): Promise<SyncDoc | null> {
  const row = await env.DB.prepare(
    "SELECT version, payload, updated_at FROM configs WHERE user_key = ?",
  ).bind(userId).first<{ version: string; payload: string; updated_at: string }>();
  if (!row) return null;
  let payload: unknown = null;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    return null;
  }
  return { version: row.version, updated_at: row.updated_at, payload };
}

async function routeGetSync(request: Request, env: Env): Promise<Response> {
  const session = await findSession(env, requireBearer(request));
  if (!session) return json({ error: "unauthorized" }, 401);
  const doc = await syncDocFor(env, session.user_id);
  if (!doc) return json({ error: "not found" }, 404);
  return json(doc);
}

async function routePostSync(request: Request, env: Env): Promise<Response> {
  const session = await findSession(env, requireBearer(request));
  if (!session) return json({ error: "unauthorized" }, 401);
  const body = await readBody<{
    payload?: unknown;
    version?: string;
    base_version?: string | null;
  }>(request);
  if (!body || body.payload === undefined || !body.version) {
    return json({ error: "missing payload or version" }, 400);
  }

  const current = await syncDocFor(env, session.user_id);
  const base = body.base_version ?? null;
  if (current) {
    if (base !== null && base === current.version) {
      // CAS success: advance.
    } else {
      // Either `base_version` was not supplied (manual overwrite) or it is
      // stale (concurrent edit) — surface the current doc as a conflict so
      // clients resolve explicitly instead of silently clobbering.
      return json(current, 409);
    }
  } else if (base !== null && base !== null) {
    // A CAS write against nothing is fine only when base was null.
    return json({ error: "no existing document" }, 409);
  }

  const payloadText = JSON.stringify(body.payload);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO configs (user_key, version, payload, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (user_key) DO UPDATE SET version = excluded.version,
       payload = excluded.payload, updated_at = excluded.updated_at`,
  ).bind(session.user_id, body.version, payloadText, now).run();

  return json({ version: body.version, updated_at: now, payload: body.payload });
}

// ─── Update / release proxy ─────────────────────────────────────────────────

interface Package {
  name: string;
  arch: string;
  url: string;
}

interface ReleaseRow {
  version: string | null;
  url: string | null;
  download_url: string | null;
  notes: string | null;
  published_at: string | null;
  packages: Package[] | null;
  mirrored_at: string | null;
}

interface ReleaseDoc {
  version: string;
  url: string | null;
  notes: string | null;
  publishedAt: string | null;
  download_url: string | null;
}

function isDigits(s: string): boolean {
  return s.length > 0 && [...s].every((c) => c >= "0" && c <= "9");
}

function isAppTag(tag: string): boolean {
  const t = tag.startsWith("v") ? tag.slice(1) : tag;
  const parts = t.split(".");
  return parts.length === 3 && parts.every(isDigits);
}

function isLspTag(tag: string): boolean {
  return tag.toLowerCase().includes("lsp");
}

function classifyAppLsp(
  githubRepo: string,
  releases: Array<Record<string, unknown>>,
): { app: ReleaseDoc | null; lsp: ReleaseDoc | null } {
  let app: ReleaseDoc | null = null;
  let lsp: ReleaseDoc | null = null;
  for (const r of releases) {
    if (r.draft || r.prerelease) continue;
    const tag = String(r.tag_name ?? "");
    const base = {
      version: tag.startsWith("v") ? tag.slice(1) : tag,
      url: (r.html_url as string) ?? null,
      notes: (r.body as string) ?? null,
      publishedAt: (r.published_at as string) ?? null,
    };
    if (!app && isAppTag(tag)) app = { ...base, download_url: null };
    if (!lsp && isLspTag(tag)) {
      lsp = {
        ...base,
        download_url: githubRepo
          ? `https://github.com/${githubRepo}/releases/download/${encodeURIComponent(tag)}/manifest.json`
          : null,
      };
    }
    if (app && lsp) break;
  }
  return { app, lsp };
}

function sanitizeSegment(s: string): string {
  return s
    .replace(/[\0-\x1f\x7f]/g, "")
    .replace(/[/\\]/g, "_")
    .replace(/\.\.+/g, "_")
    .replace(/^\.+/, "")
    .trim();
}

function isAppAsset(name: string): boolean {
  return name.endsWith(".exe") || name.endsWith(".msi");
}

function isLspAsset(name: string): boolean {
  const n = name.toLowerCase();
  if (n === "manifest.json") return false;
  if (n.startsWith("source code")) return false;
  if (n.endsWith(".sha256") || n.endsWith(".sha512") || n.endsWith(".sig") || n.endsWith(".asc")) {
    return false;
  }
  return true;
}

function contentTypeFor(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".exe")) return "application/x-msdownload";
  if (n.endsWith(".msi")) return "application/x-msi";
  return "application/octet-stream";
}

function archFor(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("arm64")) return "arm64";
  if (n.includes("x86") || n.includes("win32") || n.includes("386")) return "x86";
  return "x64";
}

function primaryPackageUrl(packages: Package[]): string | null {
  if (!packages.length) return null;
  const exe = packages.find((p) => p.name.toLowerCase().endsWith(".exe"));
  return (exe ?? packages[0]).url;
}

function githubPackages(release: Record<string, unknown>, want: (name: string) => boolean): Package[] {
  return (release.assets as Array<Record<string, unknown>> | undefined ?? [])
    .filter((a) => want(String(a.name ?? "").toLowerCase()))
    .map((a) => ({
      name: sanitizeSegment(String(a.name)),
      arch: archFor(String(a.name)),
      url: String(a.browser_download_url),
    }));
}

async function getStoredRow(env: Env, key: string): Promise<(ReleaseRow & { fetched_at: number }) | null> {
  const row = await env.DB.prepare(
    `SELECT version, url, download_url, notes, published_at, packages, mirrored_at, fetched_at
       FROM release_cache WHERE key = ?`,
  ).bind(key).first<Record<string, unknown>>();
  if (!row) return null;
  let packages: Package[] | null = null;
  if (typeof row.packages === "string" && row.packages) {
    try {
      packages = JSON.parse(row.packages);
    } catch {
      packages = null;
    }
  }
  return {
    version: (row.version as string) ?? null,
    url: (row.url as string) ?? null,
    download_url: (row.download_url as string) ?? null,
    notes: (row.notes as string) ?? null,
    published_at: (row.published_at as string) ?? null,
    packages,
    mirrored_at: (row.mirrored_at as string) ?? null,
    fetched_at: Number(row.fetched_at ?? 0),
  };
}

async function getCached(env: Env, key: string, ttlS: number): Promise<(ReleaseRow & { fetched_at: number }) | null> {
  const row = await getStoredRow(env, key);
  if (!row) return null;
  if (Math.floor(Date.now() / 1000) - row.fetched_at > ttlS) return null;
  return row;
}

async function touchRow(env: Env, key: string): Promise<void> {
  await env.DB.prepare("UPDATE release_cache SET fetched_at = ? WHERE key = ?")
    .bind(Math.floor(Date.now() / 1000), key)
    .run();
}

async function cacheRelease(env: Env, key: string, row: ReleaseRow): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO release_cache
       (key, version, url, download_url, notes, published_at, packages, mirrored_at, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET version = excluded.version, url = excluded.url,
       download_url = excluded.download_url, notes = excluded.notes,
       published_at = excluded.published_at, packages = excluded.packages,
       mirrored_at = excluded.mirrored_at, fetched_at = excluded.fetched_at`,
  )
    .bind(
      key,
      row.version,
      row.url,
      row.download_url,
      row.notes,
      row.published_at,
      row.packages ? JSON.stringify(row.packages) : null,
      row.mirrored_at,
      Math.floor(Date.now() / 1000),
    )
    .run();
}

/**
 * Re-hosts the given binary assets into the R2 `aurora` bucket under a
 * versioned, permanent path: `{version}/{asset}`. Returns the mirrored package
 * list (URLs through the R2 custom domain). When R2_PUBLIC_URL is not set it
 * degrades to GitHub's own asset URLs so nothing breaks during local dev.
 */
async function mirrorPackages(
  env: Env,
  folder: string,
  assets: Array<Record<string, unknown>> | undefined,
  want: (name: string) => boolean,
  maxBytes: number,
  publicBase: string,
): Promise<{ packages: Package[]; mirroredAt: string; skipped: string[] }> {
  const safeFolder = sanitizeSegment(folder);
  const binaries = (assets ?? []).filter((a) => want(String(a.name ?? "").toLowerCase()));
  const packages: Package[] = [];
  const skipped: string[] = [];

  for (const a of binaries) {
    const name = String(a.name ?? "");
    const size = Number(a.size ?? 0);
    if (size > maxBytes) {
      skipped.push(`${name} (${size} bytes)`);
      continue;
    }
    let dl: Response;
    try {
      const headers: Record<string, string> = {};
      if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
      dl = await fetch(String(a.browser_download_url), { headers });
    } catch (e) {
      console.error(`aurora-api: asset ${name} download failed:`, (e as Error).message);
      skipped.push(name);
      continue;
    }
    if (!dl.ok) {
      skipped.push(name);
      continue;
    }
    const bytes = await dl.arrayBuffer();
    if (bytes.byteLength > maxBytes) {
      skipped.push(`${name} (${bytes.byteLength} bytes)`);
      continue;
    }
    const safeName = sanitizeSegment(name);
    const publicUrl = publicBase ? `${publicBase}/${safeFolder}/${safeName}` : String(a.browser_download_url);
    if (publicBase) {
      try {
        await env.MIRROR_BUCKET.put(`${safeFolder}/${safeName}`, bytes, {
          httpMetadata: { contentType: contentTypeFor(safeName) },
        });
      } catch (e) {
        console.error(`aurora-api: R2 upload of ${safeName} failed:`, (e as Error).message);
        skipped.push(name);
        continue;
      }
    } else {
      console.warn("aurora-api: R2_PUBLIC_URL not set — mirroring disabled, using GitHub URLs");
    }
    packages.push({ name: safeName, arch: archFor(safeName), url: publicUrl });
  }
  return { packages, mirroredAt: new Date().toISOString(), skipped };
}

async function maybeMirror(
  env: Env,
  key: string,
  sourceVersion: string | null,
  folder: string,
  assets: Array<Record<string, unknown>> | undefined,
  want: (name: string) => boolean,
  maxBytes: number,
  publicBase: string,
): Promise<{ packages: Package[]; mirroredAt: string; skipped: string[] }> {
  const cached = await getCached(env, key, DEFAULT_TTL_S);
  if (cached && (sourceVersion === null || cached.version === sourceVersion)) {
    return {
      packages: cached.packages ?? [],
      mirroredAt: cached.mirrored_at ?? "",
      skipped: [],
    };
  }
  return mirrorPackages(env, folder, assets, want, maxBytes, publicBase);
}

function findAppRelease(releases: Array<Record<string, unknown>>): Record<string, unknown> | null {
  for (const r of releases) {
    if (r.draft || r.prerelease) continue;
    if (isAppTag(String(r.tag_name ?? ""))) return r;
  }
  return null;
}

function findLspRelease(releases: Array<Record<string, unknown>>): Record<string, unknown> | null {
  for (const r of releases) {
    if (r.draft || r.prerelease) continue;
    if (isLspTag(String(r.tag_name ?? ""))) return r;
  }
  return null;
}

async function resolveRelease(
  env: Env,
  kind: "app" | "lsp",
  force: boolean,
  maxBytes: number,
  publicBase: string,
): Promise<ReleaseRow | null> {
  const key = kind === "app" ? APP_CACHE_KEY : LSP_CACHE_KEY;
  if (!force) {
    const cached = await getCached(env, key, DEFAULT_TTL_S);
    if (cached) return cached;
  }
  const releases = await fetchReleasesList(env);
  if (!releases) return null;
  const { app, lsp } = classifyAppLsp(env.GITHUB_REPO ?? "", releases);
  const doc = kind === "app" ? app : lsp;
  if (!doc) return null;
  const release = kind === "app" ? findAppRelease(releases) : findLspRelease(releases);
  const tag = String(release?.tag_name ?? "");

  // LSP: GitHub-only, never uploaded to R2 — bundle sizes exceed practical
  // object limits. Refresh only when upstream is newer.
  if (kind === "lsp") {
    const stored = await getStoredRow(env, key);
    const storedPub = stored?.published_at ?? null;
    if (!force && storedPub && doc.publishedAt &&
      new Date(doc.publishedAt).getTime() <= new Date(storedPub).getTime()) {
      await touchRow(env, key);
      return stored;
    }
    const row: ReleaseRow = {
      version: null,
      url: doc.url,
      download_url: doc.download_url,
      notes: doc.notes,
      published_at: doc.publishedAt,
      packages: githubPackages(release ?? {}, isLspAsset),
      mirrored_at: null,
    };
    await cacheRelease(env, key, row);
    return row;
  }

  // App: mirror installers to the R2 bucket, permanent versioned URLs.
  const folder = sanitizeSegment(doc.version ?? tag);
  const releaseAssets = release?.assets as Array<Record<string, unknown>> | undefined;
  const mirrored = force
    ? await mirrorPackages(env, folder, releaseAssets, isAppAsset, maxBytes, publicBase).catch(() => ({
        packages: [] as Package[],
        mirroredAt: "",
        skipped: [] as string[],
      }))
    : await maybeMirror(env, key, doc.version, folder, releaseAssets, isAppAsset, maxBytes, publicBase)
      .catch(() => ({
        packages: [] as Package[],
        mirroredAt: "",
        skipped: [] as string[],
      }));

  // download_url is always a stable permalink: the R2 URL when mirrored,
  // otherwise derived from the mirrored package list.
  let download_url: string | null = null;
  if (mirrored.packages.length > 0) {
    download_url = primaryPackageUrl(mirrored.packages);
  }

  const row: ReleaseRow = {
    version: doc.version,
    url: doc.url,
    download_url,
    notes: doc.notes,
    published_at: doc.publishedAt,
    packages: mirrored.packages,
    mirrored_at: mirrored.mirroredAt || null,
  };
  await cacheRelease(env, key, row);
  return row;
}

// ─── Update routes ───────────────────────────────────────────────────────────

async function routeUpdateLatest(env: Env): Promise<Response> {
  const r = await resolveRelease(env, "app", false, envNum(env, "AURORA_MAX_ASSET_BYTES", DEFAULT_MAX_ASSET_BYTES), (env.R2_PUBLIC_URL ?? "").replace(/\/+$/, ""));
  if (!r) return json({ error: "not found" }, 404);
  return json(r);
}

async function routeUpdateLsp(env: Env): Promise<Response> {
  const r = await resolveRelease(env, "lsp", false, envNum(env, "AURORA_MAX_ASSET_BYTES", DEFAULT_MAX_ASSET_BYTES), (env.R2_PUBLIC_URL ?? "").replace(/\/+$/, ""));
  if (!r) return json({ error: "not found" }, 404);
  return json(r);
}

async function routeUpdateStore(request: Request, env: Env): Promise<Response> {
  if (env.AURORA_DEPLOY_TOKEN) {
    const auth = request.headers.get("Authorization") ?? "";
    if (auth !== `Bearer ${env.AURORA_DEPLOY_TOKEN}`) {
      return json({ error: "unauthorized" }, 401);
    }
  }
  try {
    const r = await resolveRelease(env, "app", true, envNum(env, "AURORA_MAX_ASSET_BYTES", DEFAULT_MAX_ASSET_BYTES), (env.R2_PUBLIC_URL ?? "").replace(/\/+$/, ""));
    if (!r) return json({ error: "no app release" }, 404);
    return json(r);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}

// ─── Router ──────────────────────────────────────────────────────────────────

function handleOptions(request: Request, env: Env): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const withCors = (res: Response): Response => {
      if (res.headers.has("Access-Control-Allow-Origin")) return res;
      const headers = corsHeaders(request, env);
      for (const [k, v] of Object.entries(headers)) {
        if (!res.headers.has(k)) res.headers.set(k, v);
      }
      return res;
    };

    return withCors(await route(request, env, pathname));
  },
};

async function route(request: Request, env: Env, pathname: string): Promise<Response> {
  if (request.method === "OPTIONS") return handleOptions(request, env);

  switch (pathname) {
    case "/v1/health":
      return json({ ok: true });

    case "/v1/auth/start-oauth":
      if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
      return routeStartOauth(request, env);

    case "/v1/auth/oauth-exchange":
      if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
      return routeOauthExchange(request, env);

    case "/v1/auth/logout":
      if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
      return routeLogout(request, env);

    case "/v1/auth/me":
      if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
      return routeMe(request, env);

    case "/v1/sync":
      if (request.method === "GET") return routeGetSync(request, env);
      if (request.method === "POST") return routePostSync(request, env);
      return json({ error: "method not allowed" }, 405);

    case "/v1/update/latest":
      if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
      return routeUpdateLatest(env);

    case "/v1/update/lsp":
      if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
      return routeUpdateLsp(env);

    case "/v1/update/store":
      if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
      return routeUpdateStore(request, env);

    default:
      return json({ error: "not found" }, 404);
  }
}