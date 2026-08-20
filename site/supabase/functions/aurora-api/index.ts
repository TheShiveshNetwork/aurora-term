import { Hono } from "npm:hono@4";

/**
 * Aurora backend — Supabase Edge Function (Deno).
 *
 * Server-side only. Holds the Supabase service-role key to read/write the
 * `release_cache` table (which has no authenticated policy) and to proxy the
 * GitHub Releases API. All user/auth and settings-sync traffic goes directly
 * from the apps to Supabase under RLS — this function only serves updates.
 *
 * Two separate collections are cached (different rows in `release_cache`):
 *   - app_latest : newest app release whose tag looks like vX.Y.Z
 *   - lsp_latest : newest release whose tag mentions "lsp" (e.g. lsp-bundles)
 *
 * Endpoints:
 *   GET /v1/health         -> { ok: true }
 *   GET /v1/update/latest -> { version, url, notes, publishedAt }  (app)
 *   GET /v1/update/lsp    -> { version, url, notes, publishedAt }  (lsp bundles)
 *
 * Env: SUPABASE_URL, SUPABASE_SECRET_KEY, AURORA_GITHUB_REPO, AURORA_GITHUB_TOKEN
 */

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(
  new RegExp("/+$"),
  "",
);
const SERVICE_KEY =
  Deno.env.get("SUPABASE_SECRET_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "";
const GITHUB_REPO = Deno.env.get("AURORA_GITHUB_REPO") ?? "";
const GITHUB_TOKEN = Deno.env.get("AURORA_GITHUB_TOKEN") ?? "";
const CACHE_TTL_MS = 30 * 60 * 1000;

const app = new Hono().basePath("/aurora-api");

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

async function pg(
  path: string,
  opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; data: any }> {
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

type ReleaseDoc = {
  version: string;
  url: string | null;
  notes: string | null;
  publishedAt: string | null;
  // For LSP bundles: the direct manifest.json download URL. Null for app.
  download_url: string | null;
};

function isDigits(s: string): boolean {
  if (!s) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

// App releases are tagged like v1.2.3 (or 1.2.3).
function isAppTag(tag: string): boolean {
  const t = tag.startsWith("v") ? tag.slice(1) : tag;
  const parts = t.split(".");
  return parts.length === 3 && parts.every(isDigits);
}

// LSP bundle releases mention "lsp" in the tag (e.g. lsp-bundles).
function isLspTag(tag: string): boolean {
  return tag.toLowerCase().includes("lsp");
}

async function fetchReleasesList(): Promise<any[] | null> {
  if (!GITHUB_REPO) return null;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "aurora-update-check",
  };
  if (GITHUB_TOKEN) headers["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=100`,
    { headers },
  );
  if (!res.ok) return null;
  return await res.json();
}

function classify(releases: any[]): {
  app: ReleaseDoc | null;
  lsp: ReleaseDoc | null;
} {
  let app: ReleaseDoc | null = null;
  let lsp: ReleaseDoc | null = null;
  for (const r of releases) {
    if (r.draft || r.prerelease) continue;
    const tag = String(r.tag_name ?? "");
    const base = {
      version: tag.startsWith("v") ? tag.slice(1) : tag,
      url: r.html_url ?? null,
      notes: r.body ?? null,
      publishedAt: r.published_at ?? null,
    };
    if (!app && isAppTag(tag)) app = { ...base, download_url: null };
    if (!lsp && isLspTag(tag)) {
      const download_url = GITHUB_REPO
        ? `https://github.com/${GITHUB_REPO}/releases/download/${encodeURIComponent(tag)}/manifest.json`
        : null;
      lsp = { ...base, download_url };
    }
    if (app && lsp) break;
  }
  return { app, lsp };
}

async function getCached(key: string): Promise<ReleaseDoc | null> {
  const { status, data } = await pg(
    `release_cache?select=payload,fetched_at&key=eq.${key}`,
  );
  if (status !== 200 || !Array.isArray(data) || !data.length) return null;
  if (Date.now() - new Date(data[0].fetched_at).getTime() > CACHE_TTL_MS) {
    return null;
  }
  return data[0].payload;
}

async function cacheRelease(key: string, payload: ReleaseDoc) {
  await pg("release_cache", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: { key, payload, fetched_at: new Date().toISOString() },
  });
}

// Resolves one collection. A single GitHub fetch refreshes BOTH collections,
// so the app and lsp caches stay consistent and share one rate-limit budget.
async function resolveLatest(kind: "app" | "lsp"): Promise<ReleaseDoc | null> {
  const key = kind === "app" ? "app_latest" : "lsp_latest";
  const cached = await getCached(key);
  if (cached) return cached;
  const releases = await fetchReleasesList();
  if (!releases) return null;
  const { app, lsp } = classify(releases);
  if (app) await cacheRelease("app_latest", app);
  if (lsp) await cacheRelease("lsp_latest", lsp);
  return kind === "app" ? app : lsp;
}

app.get("/v1/health", (c) => c.json({ ok: true }));

app.get("/v1/update/latest", async (c) => {
  const r = await resolveLatest("app");
  if (!r) return c.json({ error: "not found" }, 404);
  return c.json(r);
});

app.get("/v1/update/lsp", async (c) => {
  const r = await resolveLatest("lsp");
  if (!r) return c.json({ error: "not found" }, 404);
  return c.json(r);
});

Deno.serve(app.fetch);
