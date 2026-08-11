import { Hono } from "npm:hono@4";

/**
 * Aurora backend — Supabase Edge Function (Deno).
 *
 * Holds the Supabase service-role key here (server-side only). The desktop
 * app never sees it; it talks to this function using an opaque session token.
 *
 * Endpoints:
 *   POST /v1/auth/password      { email, password }            -> { token, email }
 *   POST /v1/auth/start-oauth   { provider, redirect_uri, code_challenge } -> { authorizeUrl }
 *   POST /v1/auth/oauth-exchange { code, code_verifier, redirect_uri }     -> { token, email }
 *   POST /v1/auth/logout        (Bearer)                       -> { ok }
 *   GET  /v1/auth/me            (Bearer)                       -> { email }
 *   GET  /v1/sync               (Bearer)                       -> 200 {version,updatedAt,payload} | 404
 *   POST /v1/sync               (Bearer) {payload,version,base_version}    -> 200 | 409
 *   GET  /v1/update/latest                                     -> { version, url, notes, publishedAt }
 *
 * Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
 * Optional env vars: AURORA_GITHUB_REPO ("owner/repo"), AURORA_GITHUB_TOKEN
 */

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const GITHUB_REPO = Deno.env.get("AURORA_GITHUB_REPO") ?? "";
const GITHUB_TOKEN = Deno.env.get("AURORA_GITHUB_TOKEN") ?? "";
const CACHE_TTL_MS = 30 * 60 * 1000;

const app = new Hono();

// ── CORS ────────────────────────────────────────────────────────────────

function corsHeaders(req: { header: (k: string) => string | undefined }) {
  const origin = req.header("origin") ?? req.header("Origin");
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

app.use("*", (c, next) => {
  const headers = corsHeaders(c.req);
  if (c.req.method === "OPTIONS") return c.body(null, 204, headers);
  return next().then(() => {
    for (const [k, v] of Object.entries(headers)) c.res.headers.set(k, v);
  });
});

// ── PostgREST helper (service-role) ─────────────────────────────────────

type PgResponse = { status: number; data: any };

async function pg(
  path: string,
  opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<PgResponse> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: opts.method ?? "GET",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      ...(opts.headers ?? {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status: res.status, data };
}

// ── Supabase Auth REST ──────────────────────────────────────────────────

type SupabaseToken = {
  access_token: string;
  refresh_token: string;
  user: { id: string; email: string };
};

async function supabaseToken(
  grantType: string,
  body: Record<string, string>,
): Promise<SupabaseToken | null> {
  const res = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=${grantType}`,
    {
      method: "POST",
      headers: {
        apikey: ANON_KEY,
        "Content-Type": "application/json",
        ...(ANON_KEY ? { Authorization: `Bearer ${ANON_KEY}` } : {}),
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) return null;
  return res.json();
}

// ── Sessions ────────────────────────────────────────────────────────────

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function newOpaqueToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function ensureUser(id: string, email: string) {
  await pg("users", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: { id, email },
  });
}

async function issueSession(auth: SupabaseToken): Promise<{ token: string; email: string }> {
  await ensureUser(auth.user.id, auth.user.email);
  const token = newOpaqueToken();
  const tokenHash = await sha256Hex(token);
  await pg("sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: {
      token_hash: tokenHash,
      user_id: auth.user.id,
      email: auth.user.email,
      supabase_refresh_token: auth.refresh_token,
      supabase_access_token: auth.access_token,
      expires_at: new Date(Date.now() + 60 * 60 * 24 * 30 * 1000).toISOString(),
    },
  });
  return { token, email: auth.user.email };
}

async function getSession(token: string): Promise<{ user_id: string; email: string } | null> {
  const tokenHash = await sha256Hex(token);
  const { status, data } = await pg(`sessions?select=user_id,email&token_hash=eq.${tokenHash}`);
  if (status === 200 && Array.isArray(data) && data.length) return data[0];
  return null;
}

async function revokeSession(token: string): Promise<boolean> {
  const tokenHash = await sha256Hex(token);
  const { status } = await pg(`sessions?token_hash=eq.${tokenHash}`, { method: "DELETE" });
  return status === 200 || status === 204;
}

function bearer(c: any): string | null {
  const h = c.req.header("Authorization") ?? c.req.header("authorization");
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice(7).trim();
}

// ── Config sync (compare-and-swap) ──────────────────────────────────────

type SyncDoc = { version: string; updatedAt: string; payload: unknown };

async function getConfig(userId: string): Promise<SyncDoc | null> {
  const { status, data } = await pg(
    `configs?select=version,payload,updated_at&user_id=eq.${userId}`,
  );
  if (status !== 200 || !Array.isArray(data) || !data.length) return null;
  return { version: data[0].version, updatedAt: data[0].updated_at, payload: data[0].payload };
}

async function upsertConfig(
  userId: string,
  payload: unknown,
  version: string,
  baseVersion: string | null,
): Promise<{ conflict: boolean; doc: SyncDoc }> {
  const existing = await getConfig(userId);
  if (existing) {
    if (!baseVersion || baseVersion !== existing.version) {
      return { conflict: true, doc: existing };
    }
  }
  const now = new Date().toISOString();
  if (existing) {
    await pg(`configs?user_id=eq.${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: { version, payload, updated_at: now },
    });
  } else {
    await pg("configs", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: { user_id: userId, version, payload, updated_at: now },
    });
  }
  return { conflict: false, doc: { version, updatedAt: now, payload } };
}

// ── GitHub Releases proxy ───────────────────────────────────────────────

type ReleaseDoc = {
  version: string;
  url: string | null;
  notes: string | null;
  publishedAt: string | null;
};

async function fetchLatestRelease(): Promise<ReleaseDoc | null> {
  if (!GITHUB_REPO) return null;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "aurora-update-check",
  };
  if (GITHUB_TOKEN) headers["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
    headers,
  });
  if (!res.ok) return null;
  const r = await res.json();
  if (r.prerelease || r.draft) return null;
  return {
    version: String(r.tag_name ?? "").replace(/^v/, ""),
    url: r.html_url ?? null,
    notes: r.body ?? null,
    publishedAt: r.published_at ?? null,
  };
}

async function getCachedRelease(): Promise<ReleaseDoc | null> {
  const { status, data } = await pg(
    "release_cache?select=payload,fetched_at&key=eq.github_latest",
  );
  if (status !== 200 || !Array.isArray(data) || !data.length) return null;
  if (Date.now() - new Date(data[0].fetched_at).getTime() > CACHE_TTL_MS) return null;
  return data[0].payload;
}

async function cacheRelease(payload: ReleaseDoc) {
  await pg("release_cache", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: { key: "github_latest", payload, fetched_at: new Date().toISOString() },
  });
}

// ── Routes ──────────────────────────────────────────────────────────────

app.get("/v1/health", (c) => c.json({ ok: true }));

app.post("/v1/auth/password", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.email || !body?.password) {
    return c.json({ error: "email and password required" }, 400);
  }
  const auth = await supabaseToken("password", { email: body.email, password: body.password });
  if (!auth) return c.json({ error: "invalid credentials" }, 401);
  return c.json(await issueSession(auth));
});

app.post("/v1/auth/start-oauth", async (c) => {
  const body = await c.req.json().catch(() => null);
  const provider = body?.provider;
  const redirectUri = body?.redirect_uri;
  const challenge = body?.code_challenge;
  if (!provider || !redirectUri || !challenge) {
    return c.json({ error: "provider, redirect_uri and code_challenge required" }, 400);
  }
  const params = new URLSearchParams({
    provider,
    redirect_to: redirectUri,
    code_challenge: challenge,
    code_challenge_method: body?.code_challenge_method ?? "S256",
    scope: "email",
  });
  return c.json({ authorizeUrl: `${SUPABASE_URL}/auth/v1/authorize?${params.toString()}` });
});

app.post("/v1/auth/oauth-exchange", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.code || !body?.code_verifier) {
    return c.json({ error: "code and code_verifier required" }, 400);
  }
  const auth = await supabaseToken("authorization_code", {
    auth_code: body.code,
    code_verifier: body.code_verifier,
    redirect_to: body.redirect_uri ?? "",
  });
  if (!auth) return c.json({ error: "code exchange failed" }, 401);
  return c.json(await issueSession(auth));
});

app.post("/v1/auth/logout", async (c) => {
  const token = bearer(c);
  if (!token) return c.json({ error: "missing token" }, 401);
  return c.json({ ok: await revokeSession(token) });
});

app.get("/v1/auth/me", async (c) => {
  const session = await getSession(bearer(c) ?? "");
  if (!session) return c.json({ error: "unauthorized" }, 401);
  return c.json({ email: session.email });
});

app.get("/v1/sync", async (c) => {
  const session = await getSession(bearer(c) ?? "");
  if (!session) return c.json({ error: "unauthorized" }, 401);
  const doc = await getConfig(session.user_id);
  if (!doc) return c.json({ error: "not found" }, 404);
  return c.json(doc);
});

app.post("/v1/sync", async (c) => {
  const session = await getSession(bearer(c) ?? "");
  if (!session) return c.json({ error: "unauthorized" }, 401);
  const body = await c.req.json().catch(() => null);
  if (!body?.payload || !body?.version) {
    return c.json({ error: "payload and version required" }, 400);
  }
  const result = await upsertConfig(
    session.user_id,
    body.payload,
    String(body.version),
    typeof body.base_version === "string" ? body.base_version : null,
  );
  if (result.conflict) return c.json(result.doc, 409);
  return c.json(result.doc);
});

app.get("/v1/update/latest", async (c) => {
  const cached = await getCachedRelease();
  if (cached) return c.json(cached);
  const release = await fetchLatestRelease();
  if (!release) return c.json({ error: "not found" }, 404);
  await cacheRelease(release);
  return c.json(release);
});

Deno.serve(app.fetch);
