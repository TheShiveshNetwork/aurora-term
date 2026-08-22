import { Hono } from "npm:hono@4";

/**
 * Aurora backend — Supabase Edge Function (Deno).
 *
 * Server-side only. Holds the Supabase service-role key to read/write the
 * `release_cache` table (which has no authenticated policy) and to proxy the
 * GitHub Releases API. All user/auth and settings-sync traffic goes directly
 * from the apps to Supabase under RLS — this function only serves updates.
 *
 * One row per release family is cached in `release_cache`:
 *   - app_release : newest app release (tag vX.Y.Z) + mirrored installers
 *   - lsp_release : newest LSP build (rolling, no version) + mirrored bundles
 * Each row carries version, url, download_url (Supabase bucket link, else
 * GitHub fallback), notes, published_at, packages[], mirrored_at.
 *
 * Endpoints:
 *   GET /v1/health         -> { ok: true }
 *   GET /v1/update/latest -> app_release row
 *   GET /v1/update/lsp    -> lsp_release row
 *   POST /v1/update/store -> force re-mirror app release into `aurora` bucket
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
const APP_CACHE_KEY = "app_release";
const LSP_CACHE_KEY = "lsp_release";

type Package = { name: string; arch: string; url: string };
// One row in `release_cache` per release family: `app_release` or `lsp_release`.
// LSP rows keep `version` null (rolling release). `download_url` is always the
// Supabase bucket link (app) or the GitHub manifest URL (LSP).
type ReleaseRow = {
  version: string | null;
  url: string | null;
  download_url: string | null;
  notes: string | null;
  published_at: string | null;
  packages: Package[] | null;
  mirrored_at: string | null;
};

// App (Microsoft Store) mirrors only installers.
function isAppAsset(name: string): boolean {
  return name.endsWith(".exe") || name.endsWith(".msi");
}

// LSP bundles: mirror the binary assets, skip GitHub's auto-generated source
// archives, the manifest, and checksum/signature files.
function isLspAsset(name: string): boolean {
  const n = name.toLowerCase();
  if (n === "manifest.json") return false;
  if (n.startsWith("source code")) return false;
  if (
    n.endsWith(".sha256") || n.endsWith(".sha512") ||
    n.endsWith(".sig") || n.endsWith(".asc")
  ) return false;
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

// Downloads the matching release assets and re-hosts them in the `aurora`
// bucket under a versioned, permanent path. `want` selects which assets to
// mirror (app installers vs. LSP bundles).
// Supabase Storage rejects objects above a plan-specific size. Read from env
// (AURORA_MAX_ASSET_BYTES) so it can be raised per project; default 50 MiB.
const MAX_ASSET_BYTES = (() => {
  const v = Number(Deno.env.get("AURORA_MAX_ASSET_BYTES") ?? "");
  return Number.isFinite(v) && v > 0 ? v : 50 * 1024 * 1024;
})();

async function mirrorPackages(
  folder: string,
  assets: any[],
  want: (name: string) => boolean,
): Promise<{ packages: Package[]; mirroredAt: string; skipped: string[] }> {
  await ensureStoreBucket();
  const safeFolder = sanitizeSegment(folder);
  const binaries = (assets ?? []).filter((a) => want(String(a.name ?? "").toLowerCase()));
  const packages: Package[] = [];
  const skipped: string[] = [];
  for (const a of binaries) {
    const name = String(a.name ?? "");
    // Skip anything above the storage limit before wasting a download.
    const size = Number(a.size ?? 0);
    if (size > MAX_ASSET_BYTES) {
      skipped.push(`${name} (${size} bytes)`);
      console.warn(
        `aurora-api: skipping ${name}, exceeds ${MAX_ASSET_BYTES}-byte limit`,
      );
      continue;
    }
    try {
      const dl = await fetch(String(a.browser_download_url), {
        headers: GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {},
      });
      if (!dl.ok) {
        throw new Error(`download failed ${a.browser_download_url}: ${dl.status}`);
      }
      const bytes = await dl.arrayBuffer();
      if (bytes.byteLength > MAX_ASSET_BYTES) {
        skipped.push(`${name} (${bytes.byteLength} bytes)`);
        console.warn(
          `aurora-api: skipped ${name}, exceeds ${MAX_ASSET_BYTES}-byte limit`,
        );
        continue;
      }
      const safeName = sanitizeSegment(name);
      const url = await uploadBinary(
        `${safeFolder}/${safeName}`,
        bytes,
        contentTypeFor(safeName),
      );
      packages.push({ name: safeName, arch: archFor(safeName), url });
    } catch (e) {
      // One bad/failed asset must not abort the whole batch — skip and continue.
      console.error(`aurora-api: asset ${name} skipped:`, (e as Error).message);
      skipped.push(name);
    }
  }
  return { packages, mirroredAt: new Date().toISOString(), skipped };
}

// Picks the primary installer from a mirrored package list (prefer Windows .exe).
function primaryPackageUrl(packages: Package[]): string | null {
  if (!packages.length) return null;
  const exe = packages.find((p) => p.name.toLowerCase().endsWith(".exe"));
  return (exe ?? packages[0]).url;
}

// Builds a package list straight from GitHub release assets (no bucket mirror),
// used for LSP where binaries stay on GitHub.
function githubPackages(release: any, want: (name: string) => boolean): Package[] {
  return (release?.assets ?? [])
    .filter((a: any) => want(String(a.name ?? "").toLowerCase()))
    .map((a: any) => ({
      name: sanitizeSegment(String(a.name)),
      arch: archFor(String(a.name)),
      url: String(a.browser_download_url),
    }));
}

// Mirrors only when the cache is stale. `sourceVersion` is the upstream tag used
// for change detection: for app it is the semver (null when unchanged -> skip);
// for LSP it is null, so LSP relies purely on the TTL.
async function maybeMirror(
  cacheKey: string,
  sourceVersion: string | null,
  folder: string,
  assets: any[],
  want: (name: string) => boolean,
): Promise<{ packages: Package[]; mirroredAt: string; skipped: string[] }> {
  const cached = await getCached(cacheKey);
  if (cached && (sourceVersion === null || cached.version === sourceVersion)) {
    return {
      packages: cached.packages ?? [],
      mirroredAt: cached.mirrored_at ?? "",
      skipped: [],
    };
  }
  const result = await mirrorPackages(folder, assets, want);
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

function findLspRelease(releases: any[]): any | null {
  for (const r of releases) {
    if (r.draft || r.prerelease) continue;
    if (isLspTag(String(r.tag_name ?? ""))) return r;
  }
  return null;
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

async function getStoredRow(key: string): Promise<ReleaseRow | null> {
  const { status, data } = await pg(
    `release_cache?select=version,url,download_url,notes,published_at,packages,mirrored_at,fetched_at&key=eq.${key}`,
  );
  if (status !== 200 || !Array.isArray(data) || !data.length) return null;
  return data[0];
}

// Same as getStoredRow but enforces the TTL: returns null once the row is older
// than CACHE_TTL_MS, so callers know they must re-check upstream.
async function getCached(key: string): Promise<ReleaseRow | null> {
  const row = await getStoredRow(key);
  if (!row) return null;
  if (Date.now() - new Date(row.fetched_at).getTime() > CACHE_TTL_MS) return null;
  return row;
}

// Resets only the TTL marker without rewriting the cached payload.
async function touchRow(key: string) {
  await pg(`release_cache?key=eq.${key}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: { fetched_at: new Date().toISOString() },
  });
}

async function cacheRelease(key: string, row: ReleaseRow) {
  await pg("release_cache", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: { key, ...row, fetched_at: new Date().toISOString() },
  });
}

// Resolves one release family into a single `release_cache` row.
//  - app: mirrors installers into the Supabase bucket; download_url = bucket link.
//  - lsp: NOT uploaded to Supabase (size limits). The row just caches the GitHub
//        release metadata; download_url = GitHub manifest URL. The cache is only
//        rewritten when the upstream release is newer than what we already hold.
async function resolveRelease(kind: "app" | "lsp", force = false): Promise<ReleaseRow | null> {
  const key = kind === "app" ? APP_CACHE_KEY : LSP_CACHE_KEY;
  if (!force) {
    const cached = await getCached(key);
    if (cached) return cached;
  }
  const releases = await fetchReleasesList();
  if (!releases) return null;
  const { app, lsp } = classify(releases);
  const doc = kind === "app" ? app : lsp;
  if (!doc) return null;
  const release = kind === "app" ? findAppRelease(releases) : findLspRelease(releases);
  const tag = String(release?.tag_name ?? "");

  // ---- LSP: GitHub-only, refresh only when upstream is newer ----
  if (kind === "lsp") {
    const stored = await getStoredRow(key);
    const ghPub = doc.publishedAt;
    const storedPub = stored?.published_at ?? null;
    if (
      !force && storedPub && ghPub &&
      new Date(ghPub).getTime() <= new Date(storedPub).getTime()
    ) {
      // Upstream unchanged within the TTL window — just reset the 3h window.
      await touchRow(key);
      return stored;
    }
    const row: ReleaseRow = {
      version: null,
      url: doc.url,
      download_url: doc.download_url,
      notes: doc.notes,
      published_at: doc.publishedAt,
      packages: githubPackages(release, isLspAsset),
      mirrored_at: null,
    };
    await cacheRelease(key, row);
    return row;
  }

  // ---- App: mirror installers to the Supabase bucket ----
  const folder = sanitizeSegment(doc.version ?? tag);
  const mirrored = force
    ? await mirrorPackages(folder, release?.assets ?? [], isAppAsset).catch(() => ({
        packages: [] as Package[],
        mirroredAt: "",
        skipped: [] as string[],
      }))
    : await maybeMirror(key, doc.version, folder, release?.assets ?? [], isAppAsset)
      .catch(() => ({
        packages: [] as Package[],
        mirroredAt: "",
        skipped: [] as string[],
      }));

  // download_url is ALWAYS the Supabase bucket link — never the GitHub URL.
  // Use the mirrored installer when available; if mirroring produced no package
  // (e.g. a transient upload failure), derive the expected bucket path from the
  // release assets so the cached row still points at the bucket.
  let download_url: string | null = null;
  if (mirrored.packages.length > 0) {
    download_url = primaryPackageUrl(mirrored.packages);
  }
  if (!download_url && release) {
    const assets = (release.assets ?? []).filter((a: any) =>
      isAppAsset(String(a.name ?? ""))
    );
    const primary = assets.find((a: any) =>
      String(a.name).toLowerCase().endsWith(".exe")
    ) ?? assets[0];
    if (primary) {
      download_url =
        `${SUPABASE_URL}/storage/v1/object/public/${STORE_BUCKET}/${folder}/${sanitizeSegment(String(primary.name))}`;
    }
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
  await cacheRelease(key, row);
  return row;
}

app.get("/v1/health", (c) => c.json({ ok: true }));

app.get("/v1/update/latest", async (c) => {
  const r = await resolveRelease("app");
  if (!r) return c.json({ error: "not found" }, 404);
  return c.json(r);
});

app.get("/v1/update/lsp", async (c) => {
  const r = await resolveRelease("lsp");
  if (!r) return c.json({ error: "not found" }, 404);
  return c.json(r);
});

// Read the cached `app_release` row (metadata + mirrored package URLs).
// Force a re-mirror of the latest app release into the `aurora` bucket and
// refresh the `app_release` row. Guarded by AURORA_DEPLOY_TOKEN when set.
app.post("/v1/update/store", async (c) => {
  if (DEPLOY_TOKEN) {
    const auth = c.req.header("authorization") ?? "";
    if (auth !== `Bearer ${DEPLOY_TOKEN}`) {
      return c.json({ error: "unauthorized" }, 401);
    }
  }
  try {
    const r = await resolveRelease("app", true);
    if (!r) return c.json({ error: "no app release" }, 404);
    return c.json(r);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

Deno.serve(app.fetch);
