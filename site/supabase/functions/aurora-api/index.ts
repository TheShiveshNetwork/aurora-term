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
 *   GET /v1/update/store  -> { version, packages:[{name,arch,url}], mirroredAt }
 *   POST /v1/update/store -> re-mirror latest release binaries into `aurora` bucket
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
// Optional shared secret required to call POST /v1/update/store. If set, the
// endpoint rejects any request without `Authorization: Bearer <token>`.
const DEPLOY_TOKEN = Deno.env.get("AURORA_DEPLOY_TOKEN") ?? "";
const CACHE_TTL_MS = 3 * 60 * 60 * 1000;

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

// ---------------------------------------------------------------------------
// Microsoft Store binary mirror
//
// GitHub release asset URLs 302-redirect to objects.githubusercontent.com, which
// the Microsoft Store submission fetcher rejects. To get a stable, direct,
// versioned Package URL we download each built .exe/.msi and re-host it in the
// public Supabase Storage bucket `aurora`:
//
//   https://<project>/storage/v1/object/public/aurora/<version>/<asset>
//
// Each version gets its own path, so the URL is a permanent permalink and we
// never overwrite an older release. Use these URLs as the Package URL(s) in the
// Store submission (one per architecture).
// ---------------------------------------------------------------------------

const STORE_BUCKET = "aurora";
const STORE_CACHE_KEY = "app_store";

type StorePackage = { name: string; arch: string; url: string };
type StoreResult = {
  version: string;
  packages: StorePackage[];
  mirroredAt: string;
};

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
  if (n.includes("x64") || n.includes("amd64")) return "x64";
  return "x64";
}

// Strips characters that could allow path traversal / separator injection in the
// Storage object path. Values originate from GitHub release tags/asset names, but
// we sanitize defensively so a crafted tag can't escape the version folder.
function sanitizeSegment(s: string): string {
  return s
    .replace(/[\0-\x1f\x7f]/g, "") // control chars
    .replace(/[\/\\]/g, "_") // path separators
    .replace(/\.\.+/g, "_") // traversal
    .replace(/^\.+/, "") // leading dots
    .trim();
}

async function ensureStoreBucket() {
  // Create (ignore if it already exists), then force it public.
  await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: STORE_BUCKET, public: true }),
  }).catch(() => {});
  await fetch(`${SUPABASE_URL}/storage/v1/bucket/${STORE_BUCKET}`, {
    method: "PUT",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ public: true }),
  });
}

async function uploadBinary(
  path: string,
  bytes: ArrayBuffer,
  contentType: string,
): Promise<string> {
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${STORE_BUCKET}/${path}?upsert=true`,
    {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": contentType,
        "x-upsert": "true",
      },
      body: bytes,
    },
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`storage upload failed (${res.status}): ${t}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${STORE_BUCKET}/${path}`;
}

async function mirrorStore(version: string, assets: any[]): Promise<StoreResult> {
  await ensureStoreBucket();
  const safeVersion = sanitizeSegment(version);
  const binaries = (assets ?? []).filter((a) => {
    const n = String(a.name ?? "").toLowerCase();
    return n.endsWith(".exe") || n.endsWith(".msi");
  });
  const packages: StorePackage[] = [];
  for (const a of binaries) {
    const name = sanitizeSegment(String(a.name));
    const dl = await fetch(String(a.browser_download_url), {
      headers: GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {},
    });
    if (!dl.ok) {
      throw new Error(`download failed ${a.browser_download_url}: ${dl.status}`);
    }
    const bytes = await dl.arrayBuffer();
    const url = await uploadBinary(
      `${safeVersion}/${name}`,
      bytes,
      contentTypeFor(name),
    );
    packages.push({ name, arch: archFor(name), url });
  }
  return { version: safeVersion, packages, mirroredAt: new Date().toISOString() };
}

async function maybeMirrorStore(version: string, assets: any[]): Promise<StoreResult> {
  const cached = await getCached(STORE_CACHE_KEY);
  if (cached && cached.version === version) return cached;
  const result = await mirrorStore(version, assets);
  await cacheRelease(STORE_CACHE_KEY, result);
  return result;
}

// Finds the raw app release object (with assets) for the latest app tag.
function findAppRelease(releases: any[]): any | null {
  for (const r of releases) {
    if (r.draft || r.prerelease) continue;
    if (isAppTag(String(r.tag_name ?? ""))) return r;
  }
  return null;
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

async function getCached(key: string): Promise<any | null> {
  const { status, data } = await pg(
    `release_cache?select=payload,fetched_at&key=eq.${key}`,
  );
  if (status !== 200 || !Array.isArray(data) || !data.length) return null;
  if (Date.now() - new Date(data[0].fetched_at).getTime() > CACHE_TTL_MS) {
    return null;
  }
  return data[0].payload;
}

async function cacheRelease(key: string, payload: any) {
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
  if (app) {
    // Re-host the built binaries to the `aurora` bucket so the Store gets a
    // direct, versioned URL. Best-effort and non-blocking for update checks.
    const appRelease = findAppRelease(releases);
    maybeMirrorStore(app.version, appRelease?.assets ?? []).catch((e) =>
      console.error("aurora-api: store mirror skipped:", (e as Error).message),
    );
  }
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

// Read the currently mirrored Store package URLs (last mirrored version).
app.get("/v1/update/store", async (c) => {
  const r = await getCached(STORE_CACHE_KEY);
  if (!r) return c.json({ error: "not mirrored yet" }, 404);
  return c.json(r);
});

// Force a re-mirror of the latest app release's binaries into the `aurora`
// bucket. Safe to call after publishing a GitHub release; skips re-download if
// the version is unchanged. Recommended trigger from CI or manually.
// Guarded by AURORA_DEPLOY_TOKEN when configured (see README).
app.post("/v1/update/store", async (c) => {
  if (DEPLOY_TOKEN) {
    const auth = c.req.header("authorization") ?? "";
    if (auth !== `Bearer ${DEPLOY_TOKEN}`) {
      return c.json({ error: "unauthorized" }, 401);
    }
  }
  try {
    const releases = await fetchReleasesList();
    if (!releases) return c.json({ error: "github unreachable" }, 502);
    const appRelease = findAppRelease(releases);
    if (!appRelease) return c.json({ error: "no app release" }, 404);
    const version = String(appRelease.tag_name ?? "").replace(/^v/, "");
    const result = await maybeMirrorStore(version, appRelease.assets ?? []);
    return c.json(result);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

Deno.serve(app.fetch);
