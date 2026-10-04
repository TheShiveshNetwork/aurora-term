import { Hono } from "npm:hono@4";
import { LSP_EXCLUDED_FROM_STORAGE } from "./lsp-config.ts";

/**
 * Aurora backend — Supabase Edge Function (Deno).
 *
 * Server-side only. Holds the Supabase service-role key to read/write the
 * `release_cache` table (which has no authenticated policy) and to proxy the
 * GitHub Releases API. All user/auth and settings-sync traffic goes directly
 * from the apps to Supabase under RLS — this function only serves updates.
 *
 * One row per release family is cached in `release_cache`:
 *   - app_release : newest app release (tag vX.Y.Z) + installers
 *   - lsp_release : newest LSP build (rolling, no version) + mirrored bundles
 * Each row carries version, url, download_url (Supabase bucket link, else
 * GitHub fallback), notes, published_at, packages[], mirrored_at.
 *
 * `packages` lists every downloadable asset with its name, arch, byte size and
 * a working `url`: the Supabase object when the mirror stored it, otherwise the
 * GitHub asset URL. Assets above the storage per-object cap (the AppImage, and
 * anything past `AURORA_MAX_ASSET_BYTES`) therefore still resolve, just not
 * from Supabase.
 *
 * Supabase Storage only holds the LSP bundles that are downloaded most often.
 * Mirroring them into the public `aurora` bucket keeps repeated installs off
 * GitHub's rate-limited rolling `lsp-bundles` release while freeing us from
 * serving huge, rarely-used bundles from Supabase (which would waste quota).
 * Which languages are mirrored is decided by `lsp-config.ts`; set
 * `AURORA_MAX_ASSET_BYTES` to raise the per-asset cap on that bucket.
 *
 * Endpoints:
 *   GET /v1/health         -> { ok: true }
 *   GET /v1/update/latest -> app_release row
 *   GET /v1/update/lsp    -> lsp_release row
 *   POST /v1/update/store -> force re-mirror app release into `aurora` bucket.
 *     Accepts optional `repo` and `tag` query parameters to mirror one
 *     release directly instead of inferring the latest release.
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
const APP_CACHE_TTL_MS = 3 * 60 * 60 * 1000;
const LSP_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
// Binary mirror (Supabase Storage `aurora` bucket)
//
// GitHub release asset URLs 302-redirect to objects.githubusercontent.com,
// which some fetchers reject. We download the built artifacts and re-host
// them in the public bucket:
//
//   https://<project>/storage/v1/object/public/aurora/<version>/<asset>  (app)
//   https://<project>/storage/v1/object/public/aurora/lsp-bundles/<asset> (lsp)
//
// Only the latest version is kept: after a new app release is mirrored the
// previous version folder(s) are deleted. LSP `lsp-bundles/` is pruned to
// the current asset set (orphans deleted). This keeps the free-tier bucket
// (~1 GiB) from accumulating every historic release.
// ---------------------------------------------------------------------------

const STORE_BUCKET = "aurora";
const STORE_PUBLIC_PREFIX =
  `${SUPABASE_URL}/storage/v1/object/public/${STORE_BUCKET}/`;
const APP_CACHE_KEY = "app_release";
const LSP_CACHE_KEY = "lsp_release";

type Package = { name: string; arch: string; size: number; url: string };
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

// Every installer format the release workflow publishes. Anything outside this
// set (checksums, signatures, GitHub's source archives) is not a download the
// site can offer.
const APP_ASSET_SUFFIXES = [
  ".exe",
  ".msi",
  ".dmg",
  ".app.tar.gz",
  ".appimage",
  ".deb",
  ".rpm",
];

function isAppAsset(name: string): boolean {
  const n = name.toLowerCase();
  return APP_ASSET_SUFFIXES.some((suffix) => n.endsWith(suffix));
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

// Bundle assets are named `<language>-<version>-<platform>.<ext>` — the language
// id is always the first dash-delimited segment (`c`, `cpp`, `rust`, …).
function lspLanguageOf(name: string): string {
  return name.toLowerCase().split("-")[0] ?? "";
}

// LSP assets that go into Supabase Storage: anything that qualifies as an LSP
// asset except languages configured in `lsp-config.ts` to stay on GitHub.
function isLspStoredAsset(name: string): boolean {
  return isLspAsset(name) && !LSP_EXCLUDED_FROM_STORAGE.includes(lspLanguageOf(name));
}

// LSP assets of the languages kept out of Supabase Storage — they stay on the
// GitHub rolling release and are fetched on demand.
function isLspGithubOnlyAsset(name: string): boolean {
  return isLspAsset(name) && LSP_EXCLUDED_FROM_STORAGE.includes(lspLanguageOf(name));
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

function storeObjectUrl(path: string): string {
  return `${STORE_PUBLIC_PREFIX}${path}`;
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
  return storeObjectUrl(path);
}

async function listStorageObjects(prefix: string, limit = 1000): Promise<string[]> {
  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${STORE_BUCKET}`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefix, limit, sortBy: { column: "name", order: "asc" } }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map((o: any) => String(o.name ?? "")).filter(Boolean);
  } catch {
    return [];
  }
}

async function deleteStorageObjects(paths: string[]): Promise<void> {
  if (!paths.length) return;
  // Try bulk delete first (supabase-js uses DELETE /object/<bucket> with JSON array)
  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${STORE_BUCKET}`, {
      method: "DELETE",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(paths),
    });
    if (res.ok) return;
  } catch { /* fallback to single deletes */ }
  for (const p of paths) {
    try {
      await fetch(`${SUPABASE_URL}/storage/v1/object/${STORE_BUCKET}/${p}`, {
        method: "DELETE",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
      });
    } catch { /* ignore per-file failures */ }
  }
}

// Delete every app version folder except `keepFolder`.
// Version folders are `X.Y.Z` (e.g. `0.1.0`); `lsp-bundles` and stray files are never deleted here.
async function pruneOldAppVersions(keepFolder: string): Promise<void> {
  const all = await listStorageObjects("", 1000);
  const folders = new Set<string>();
  for (const name of all) {
    const seg = name.split("/")[0] ?? "";
    if (!seg || seg === "lsp-bundles" || seg === keepFolder) continue;
    if (/^\d+\.\d+\.\d+$/.test(seg)) folders.add(seg);
  }
  for (const folder of folders) {
    const objs = await listStorageObjects(`${folder}/`, 1000);
    // Storage list returns names relative to the prefix; reconstruct full paths
    const fullPaths = objs.map((n) => (n.includes("/") ? n : `${folder}/${n}`));
    // Fallback: if list returned full paths already, use as-is; if empty try prefix-less scan
    const toDelete = fullPaths.length ? fullPaths : all.filter((n) => n.startsWith(`${folder}/`));
    if (toDelete.length) {
      await deleteStorageObjects(toDelete);
      console.log(`aurora-api: pruned old app version ${folder} (${toDelete.length} objects)`);
    }
  }
}

// Delete orphaned files in `lsp-bundles/` that are not part of the current release.
async function pruneOrphanedLspBundles(keepNames: Set<string>): Promise<void> {
  const objs = await listStorageObjects("lsp-bundles/", 1000);
  const fullPaths = objs.map((n) => (n.includes("/") ? n : `lsp-bundles/${n}`));
  const toDelete = fullPaths.filter((p) => {
    const base = p.split("/").pop() ?? "";
    return base && !keepNames.has(base);
  });
  if (toDelete.length) {
    await deleteStorageObjects(toDelete);
    console.log(`aurora-api: pruned ${toDelete.length} orphaned lsp-bundles`);
  }
}

// Downloads the matching release assets and re-hosts them in the `aurora`
// bucket under a versioned, permanent path. `want` selects which assets to
// mirror (app installers vs. LSP bundles).
// Supabase Storage rejects objects above a plan-specific size. Read from env
// (AURORA_MAX_ASSET_BYTES) so it can be raised per project; default 50 MiB.
// Every wanted asset yields a package: assets that cannot be stored keep their
// GitHub URL so callers never lose a download.
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
    const githubUrl = String(a.browser_download_url ?? "");
    const safeName = sanitizeSegment(name);
    const size = Number(a.size ?? 0);
    const fallBack = () =>
      packages.push({ name: safeName, arch: archFor(safeName), size, url: githubUrl });
    // Skip anything above the storage limit before wasting a download.
    if (size > MAX_ASSET_BYTES) {
      skipped.push(`${name} (${size} bytes)`);
      console.warn(
        `aurora-api: keeping ${name} on GitHub, exceeds ${MAX_ASSET_BYTES}-byte limit`,
      );
      fallBack();
      continue;
    }
    try {
      const dl = await fetch(githubUrl, {
        headers: GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {},
      });
      if (!dl.ok) {
        throw new Error(`download failed ${githubUrl}: ${dl.status}`);
      }
      const bytes = await dl.arrayBuffer();
      if (bytes.byteLength > MAX_ASSET_BYTES) {
        skipped.push(`${name} (${bytes.byteLength} bytes)`);
        console.warn(
          `aurora-api: keeping ${name} on GitHub, exceeds ${MAX_ASSET_BYTES}-byte limit`,
        );
        fallBack();
        continue;
      }
      const url = await uploadBinary(
        `${safeFolder}/${safeName}`,
        bytes,
        contentTypeFor(safeName),
      );
      packages.push({
        name: safeName,
        arch: archFor(safeName),
        size: bytes.byteLength,
        url,
      });
    } catch (e) {
      // One bad/failed asset must not abort the whole batch — keep its GitHub
      // URL and continue.
      console.error(`aurora-api: asset ${name} not mirrored:`, (e as Error).message);
      skipped.push(name);
      fallBack();
    }
  }
  return { packages, mirroredAt: new Date().toISOString(), skipped };
}

// Packages that actually landed in the bucket. Entries that kept their GitHub
// URL (over the storage cap, or a failed upload) are excluded.
function hostedPackages(packages: Package[]): Package[] {
  return packages.filter((p) => p.url.startsWith(STORE_PUBLIC_PREFIX));
}

// Picks the primary installer from a mirrored package list (prefer Windows .exe).
// Only Supabase-hosted entries qualify: `download_url` must stay a direct bucket
// link and never point back at GitHub.
function primaryPackageUrl(packages: Package[]): string | null {
  const hosted = hostedPackages(packages);
  if (!hosted.length) return null;
  const exe = hosted.find((p) => p.name.toLowerCase().endsWith(".exe"));
  return (exe ?? hosted[0]).url;
}

// Builds a package list straight from GitHub release assets (no bucket mirror),
// used for LSP where binaries stay on GitHub.
function githubPackages(release: any, want: (name: string) => boolean): Package[] {
  return (release?.assets ?? [])
    .filter((a: any) => want(String(a.name ?? "").toLowerCase()))
    .map((a: any) => ({
      name: sanitizeSegment(String(a.name)),
      arch: archFor(String(a.name)),
      size: Number(a.size ?? 0),
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

function appDocForRelease(release: any): ReleaseDoc | null {
  if (!release || release.draft || release.prerelease) return null;
  const tag = String(release.tag_name ?? "");
  if (!isAppTag(tag)) return null;
  return {
    version: tag.startsWith("v") ? tag.slice(1) : tag,
    url: release.html_url ?? null,
    notes: release.body ?? null,
    publishedAt: release.published_at ?? null,
    download_url: null,
  };
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "aurora-update-check",
  };
  if (GITHUB_TOKEN) headers["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
  return headers;
}

async function fetchReleasesList(repo: string = GITHUB_REPO): Promise<any[] | null> {
  if (!repo) {
    console.error(
      "aurora-api: AURORA_GITHUB_REPO is unset, release lookups are disabled",
    );
    return null;
  }
  const res = await fetch(
    `https://api.github.com/repos/${repo}/releases?per_page=100`,
    { headers: githubHeaders() },
  );
  if (!res.ok) {
    console.error(
      `aurora-api: GitHub releases request failed (${res.status}${
        res.status === 403 ? ", likely rate limited" : ""
      })`,
    );
    return null;
  }
  return await res.json();
}

type StoreTarget = { repo: string; tag: string } | null;

function parseStoreTarget(
  repoParam: string | undefined,
  tagParam: string | undefined,
): StoreTarget {
  const repo = (repoParam ?? "").trim();
  const tag = (tagParam ?? "").trim();
  if (!repo && !tag) return null;
  if (!repo || !tag) throw new Error("Store target requires both repo and tag");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error("Invalid store repo");
  }
  if (!isAppTag(tag)) throw new Error("Invalid store tag");
  return { repo, tag };
}

async function fetchAppReleaseByTag(repo: string, tag: string): Promise<any | null> {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`,
    { headers: githubHeaders() },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`GitHub release lookup failed: ${res.status}`);
  }
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
    if (!app) app = appDocForRelease(r);
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

// Same as getStoredRow but enforces a per-family TTL: returns null once the row
// is older than the family window, so callers know they must re-check upstream.
// App checks every 3h, LSP only once per week (mirrored only on new release).
async function getCached(key: string): Promise<ReleaseRow | null> {
  const row = await getStoredRow(key);
  if (!row) return null;
  const ttl = key === LSP_CACHE_KEY ? LSP_CACHE_TTL_MS : APP_CACHE_TTL_MS;
  if (Date.now() - new Date((row as any).fetched_at).getTime() > ttl) return null;
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

async function storeAppRelease(
  release: any,
  force: boolean,
): Promise<ReleaseRow | null> {
  const doc = appDocForRelease(release);
  if (!doc) return null;
  const tag = String(release?.tag_name ?? "");
  const folder = sanitizeSegment(doc.version ?? tag);
  const mirrored = force
    ? await mirrorPackages(folder, release?.assets ?? [], isAppAsset).catch(() => ({
        packages: [] as Package[],
        mirroredAt: "",
        skipped: [] as string[],
      }))
    : await maybeMirror(APP_CACHE_KEY, doc.version, folder, release?.assets ?? [], isAppAsset)
      .catch(() => ({
        packages: [] as Package[],
        mirroredAt: "",
        skipped: [] as string[],
      }));

  // Prune previous version folders so only `folder` remains. Only prune after a
  // successful mirror (prevents deleting the current version on failure).
  if (hostedPackages(mirrored.packages).length > 0) {
    await pruneOldAppVersions(folder).catch(() => {});
  }

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
      download_url = storeObjectUrl(
        `${folder}/${sanitizeSegment(String(primary.name))}`,
      );
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
  await cacheRelease(APP_CACHE_KEY, row);
  return row;
}

// Resolves one release family into a single `release_cache` row.
//  - app: mirrors installers into the Supabase bucket; download_url = bucket link.
//  - lsp: mirrors the frequently-downloaded bundles into the `lsp-bundles/`
//        bucket path (languages in LSP_EXCLUDED_FROM_STORAGE stay on GitHub).
//        The row caches the release metadata; download_url = GitHub manifest
//        URL. The cache is only rewritten when the upstream release is newer
//        than what we already hold.
async function resolveRelease(
  kind: "app" | "lsp",
  force = false,
  target: StoreTarget = null,
): Promise<ReleaseRow | null> {
  const key = kind === "app" ? APP_CACHE_KEY : LSP_CACHE_KEY;
  if (!force) {
    const cached = await getCached(key);
    if (cached) return cached;
  }
  if (kind === "app" && target) {
    const release = await fetchAppReleaseByTag(target.repo, target.tag);
    return await storeAppRelease(release, force);
  }
  const stored = await getStoredRow(key);
  const releases = await fetchReleasesList();
  if (!releases) {
    // GitHub is unreachable or unconfigured. A stale row still points at real,
    // downloadable assets, so serve it rather than 404 and take the download
    // page offline. `force` (the CI mirror trigger) must fail loudly instead,
    // because its caller verifies the mirror actually happened.
    if (force || !stored) return null;
    console.warn(
      `aurora-api: serving stale ${key} cache (v${stored.version ?? "unknown"})`,
    );
    return stored;
  }
  const { app, lsp } = classify(releases);
  const doc = kind === "app" ? app : lsp;
  if (!doc) return null;
  const release = kind === "app" ? findAppRelease(releases) : findLspRelease(releases);

  // ---- LSP: mirror frequently-downloaded bundles, refresh only when upstream is newer ----
  if (kind === "lsp") {
    const stored = await getStoredRow(key);
    const ghPub = doc.publishedAt;
    const storedPub = stored?.published_at ?? null;
    if (
      !force && storedPub && ghPub &&
      new Date(ghPub).getTime() <= new Date(storedPub).getTime()
    ) {
      // Upstream unchanged within the TTL window — just reset the weekly window.
      await touchRow(key);
      return stored;
    }
    // Mirror into `lsp-bundles/` so frequently-used servers are served from
    // Supabase instead of GitHub. Languages excluded from storage stay on the
    // GitHub release; their package entries point at GitHub URLs below.
    // Throttled to weekly via LSP_CACHE_TTL_MS; mirroring only runs when
    // `published_at` is newer than the cached row (or `force=true`).
    const mirrored = await mirrorPackages(
      "lsp-bundles",
      release?.assets ?? [],
      isLspStoredAsset,
    ).catch(() => ({
      packages: [] as Package[],
      mirroredAt: "",
      skipped: [] as string[],
    }));
    // Prune orphaned bundles from previous lsp-bundles releases so only the
    // latest asset set remains in the bucket (keeps free-tier usage bounded).
    const hosted = hostedPackages(mirrored.packages);
    if (hosted.length > 0) {
      const keepNames = new Set(hosted.map((p) => p.name));
      await pruneOrphanedLspBundles(keepNames).catch(() => {});
    }
    // Mirrored bundles are served from Supabase; excluded-language bundles keep
    // their GitHub URLs. If mirroring failed outright, fall back to the full
    // GitHub listing so the cached row still points at every asset.
    const packages = hosted.length > 0
      ? [...hosted, ...githubPackages(release, isLspGithubOnlyAsset)]
      : githubPackages(release, isLspAsset);
    const row: ReleaseRow = {
      version: null,
      url: doc.url,
      download_url: doc.download_url,
      notes: doc.notes,
      published_at: doc.publishedAt,
      packages,
      mirrored_at: mirrored.mirroredAt || null,
    };
    await cacheRelease(key, row);
    return row;
  }

  // ---- App: mirror installers to the Supabase bucket ----
  // Only the latest version is retained: after a successful mirror we delete
  // every other `X.Y.Z` folder in the bucket.
  return await storeAppRelease(findAppRelease(releases), force);
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

// Force a re-mirror of one app release into the `aurora` bucket and refresh
// the `app_release` row. Guarded by AURORA_DEPLOY_TOKEN when set.
app.post("/v1/update/store", async (c) => {
  if (DEPLOY_TOKEN) {
    const auth = c.req.header("authorization") ?? "";
    if (auth !== `Bearer ${DEPLOY_TOKEN}`) {
      return c.json({ error: "unauthorized" }, 401);
    }
  }
  let target: StoreTarget;
  try {
    target = parseStoreTarget(c.req.query("repo"), c.req.query("tag"));
  } catch {
    return c.json({ error: "invalid store target" }, 400);
  }
  try {
    const r = await resolveRelease("app", true, target);
    if (!r) return c.json({ error: "no app release" }, 404);
    return c.json(r);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

Deno.serve(app.fetch);
