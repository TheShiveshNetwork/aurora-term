// Build orchestrator for `aurora-lsp-bundles`.
//
// For every language in `registry.mjs` it produces one versioned tarball per
// platform, computes their sha256, and regenerates `manifest.json`. Tarballs are
// uploaded to a GitHub Release so the app's `aurora-lsp-fetch` can download them.
//
// Run in CI (see .github/workflows/build.yml). Locally: `node scripts/build.mjs`.
//
// Env:
//   GITHUB_TOKEN   required for release upload + private registry access
//   NODE_AUTH_TOKEN optional for npm installs
//   SKIP_UPLOAD=1  build + write manifest.json but do not upload

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync, cpSync, existsSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { REGISTRY, HOST_TOOLCHAIN, PLATFORMS, substitute } from "./registry.mjs";

const ROOT = process.cwd();
const DIST = join(ROOT, "dist");
const SKIP_UPLOAD = process.env.SKIP_UPLOAD === "1";

// All bundles + manifest.json live in ONE rolling GitHub release so we never
// accumulate releases. Asset names are deterministic (<lang>-<ver>-<plat>),
// so clients cache by version and only re-download when the manifest changes.
const REPO = "TheShiveshNetwork/aurora-term";
const RELEASE_TAG = "lsp-bundles";
const RAW_BASE = `https://github.com/${REPO}/releases/download/${RELEASE_TAG}`;
// `gh` reads GH_TOKEN; mirror GITHUB_TOKEN so CI secrets work transparently.
if (process.env.GITHUB_TOKEN && !process.env.GH_TOKEN) process.env.GH_TOKEN = process.env.GITHUB_TOKEN;

function sh(cmd, args, cwd, opts = {}) {
  console.log("+", cmd, args.join(" "));
  execFileSync(cmd, args, { cwd, stdio: "inherit", env: process.env, ...opts });
}

// On Windows `npm` is a `npm.cmd` shim that `execFileSync` cannot launch
// directly; it must run through the command interpreter (`shell: true`).
function npmOpts() {
  return process.platform === "win32" ? { shell: true } : {};
}

function sha256File(p) {
  const h = createHash("sha256");
  h.update(readFileSync(p));
  return h.digest("hex");
}

function tmp() {
  return mkdtempSync(join(tmpdir(), "aurora-bundle-"));
}

// Normalize an upstream asset into a `.tar.gz` (or pass-through `.zip`) whose
// internal layout is preserved; returns the local bundle path + ext.
function repackage(assetPath, work) {
  const lower = basename(assetPath).toLowerCase();
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz") || lower.endsWith(".tar")) {
    return { path: assetPath, ext: "tar.gz" };
  }
  if (lower.endsWith(".zip")) {
    return { path: assetPath, ext: "zip" };
  }
  // Raw executable (e.g. marksman, zls, nil): wrap it in a tar.gz.
  const out = join(work, "raw.tar.gz");
  sh("tar", ["-czf", out, "-C", work, basename(assetPath)]);
  return { path: out, ext: "tar.gz" };
}

async function latestReleaseAsset(repo, pattern, version, plat) {
  // Use the upstream's actual latest release tag, not a hardcoded guess.
  const rel = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json" },
  });
  if (!rel.ok) throw new Error(`github latest release for ${repo}: ${rel.status}`);
  const json = await rel.json();
  const tag = String(json.tag_name || "").replace(/^v/, "");
  const want = substitute(pattern, plat, tag);
  const assets = json.assets || [];
  const name = assets.find((a) => a.name === want || a.name.toLowerCase() === want.toLowerCase())?.name
    || assets.find((a) => a.name.toLowerCase().includes(substitute(pattern.split(/[{}]/)[0], plat, tag).toLowerCase().replace(".zip", "").replace(".tar.gz", "")))?.name;
  if (!name) throw new Error(`no asset '${want}' in ${repo}@${tag}; have: ${assets.map((a) => a.name).join(", ")}`);
  const a = assets.find((x) => x.name === name);
  const dl = join(work, name);
  const r2 = await fetch(a.browser_download_url, { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } });
  if (!r2.ok) throw new Error(`download ${a.browser_download_url} failed: ${r2.status}`);
  writeFileSync(dl, Buffer.from(await r2.arrayBuffer()));
  return { dl, version: tag };
}

async function buildNpm(spec, plat, work) {
  // Install latest (no pin) and derive the real resolved version afterward.
  const pkgs = [spec.package, ...(spec.extra || [])];
  sh("npm", ["install", "--no-save", "--prefix", work, ...pkgs], work, npmOpts());
  // Read the real bin entry from the installed package's own package.json.
  const pkgJson = JSON.parse(readFileSync(join(work, "node_modules", spec.package, "package.json"), "utf8"));
  const version = pkgJson.version;
  const bins = pkgJson.bin;
  const binVal = typeof bins === "string" ? bins : bins?.[spec.bin || spec.package];
  if (!binVal) throw new Error(`npm bin '${spec.bin || spec.package}' not found in ${spec.package}`);
  const entry = `node_modules/${spec.package}/${binVal}`;
  if (!existsSync(join(work, entry))) throw new Error(`npm bin missing: ${entry}`);
  const out = join(work, "bundle.tar.gz");
  sh("tar", ["-czf", out, "-C", work, "node_modules"]);
  return { bundle: out, ext: "tar.gz", entry_relative: entry, kind: "node", version };
}

async function buildGithub(spec, plat, work) {
  const { dl, version } = await latestReleaseAsset(spec.repo, spec.asset, spec.version, plat);
  const { path, ext } = repackage(dl, work);
  return { bundle: path, ext, entry_relative: spec.entry_relative, kind: "native", version };
}

async function buildGo(spec, plat, work) {
  const gobin = join(work, "gobin");
  mkdirSync(gobin, { recursive: true });
  sh(process.platform === "win32" ? "go.exe" : "go", ["install", `${spec.module}@${spec.version}`], { ...process.env, GOOS: plat.goos, GOARCH: plat.goarch, GOBIN: gobin });
  const binName = basename(spec.entry_relative);
  const built = join(gobin, binName);
  if (!existsSync(built)) throw new Error(`go install produced no ${binName}`);
  const out = join(work, "bundle.tar.gz");
  sh("tar", ["-czf", out, "-C", gobin, binName]);
  return { bundle: out, ext: "tar.gz", entry_relative: spec.entry_relative, kind: "native" };
}

async function buildOne(spec, plat) {
  const work = tmp();
  let result;
  if (spec.eco === "npm") result = await buildNpm(spec, plat, work);
  else if (spec.eco === "github") result = await buildGithub(spec, plat, work);
  else if (spec.eco === "go") result = await buildGo(spec, plat, work);
  else throw new Error(`unsupported eco ${spec.eco}`);

  const sha = sha256File(result.bundle);
  const version = result.version || spec.version;
  const assetName = `${spec.id}-${version}-${plat.key}.${result.ext}`;
  const dst = join(DIST, spec.id, plat.key, assetName);
  mkdirSync(join(DIST, spec.id, plat.key), { recursive: true });
  cpSync(result.bundle, dst);
  rmSync(work, { recursive: true, force: true });
  console.log(`built ${assetName} (${result.kind}) sha256=${sha}`);
  return { assetName, sha, kind: result.kind, entry_relative: result.entry_relative };
}

// Publish every bundle (plus manifest.json) to a single rolling release. We
// delete the previous release + tag first so the same stable tag/URL is reused
// every run — no release accumulation, CDN-backed downloads, nothing in git.
async function publishRollingRelease(files) {
  if (SKIP_UPLOAD) { console.log("SKIP_UPLOAD set; not publishing"); return; }
  if (!process.env.GITHUB_TOKEN && !process.env.GH_TOKEN) throw new Error("GITHUB_TOKEN required to publish bundles");
  // Best-effort teardown of any prior rolling release + its tag.
  sh("gh", ["release", "delete", RELEASE_TAG, "--repo", REPO, "--yes"], ROOT, { stdio: "ignore" }).catch(() => {});
  sh("gh", ["api", "-X", "DELETE", `/repos/${REPO}/git/refs/tags/${RELEASE_TAG}`], ROOT, { stdio: "ignore" }).catch(() => {});
  sh("gh", ["release", "create", RELEASE_TAG, "--repo", REPO, "--title", "LSP Bundles", "--notes", `Automated prebuilt LSP bundles @ ${new Date().toISOString()}`, ...files], ROOT);
  console.log(`published ${files.length} assets to rolling release ${RELEASE_TAG}`);
}

// Regenerate manifest.json from already-built `dist/` artifacts without any
// network access. Used when the build was killed mid-run (e.g. CI/network) and
// the successfully produced bundles should still be published.
async function manifestFromDist() {
  const manifest = {};
  for (const spec of REGISTRY) {
    if (HOST_TOOLCHAIN.includes(spec.id)) continue;
    const platforms = {};
    let langVersion, langKind, langEntry;
    for (const plat of PLATFORMS) {
      const dir = join(DIST, spec.id, plat.key);
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir).filter((f) => /\.(tar\.gz|zip)$/i.test(f));
      if (files.length === 0) continue;
      const assetName = files[0];
      const sha = sha256File(join(dir, assetName));
      const ext = assetName.endsWith(".zip") ? "zip" : "tar.gz";
      const base = assetName.slice(0, assetName.length - (ext.length + 1));
      // assetName = "<id>-<version>-<plat>.<ext>" -> recover the real version.
      langVersion = base.slice(spec.id.length + 1, base.length - (plat.key.length + 1));
      langKind = spec.eco === "npm" ? "node" : "native";
      langEntry = spec.entry_relative;
      const url = `${RAW_BASE}/${assetName}`;
      platforms[plat.key] = { url, sha256: sha };
    }
    if (Object.keys(platforms).length === 0) continue;
    manifest[spec.id] = { version: langVersion, entry_kind: langKind, entry_relative: langEntry, args: spec.args, platforms };
  }
  writeFileSync(join(ROOT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`manifest.json regenerated from dist/ (${Object.keys(manifest).length} languages)`);
}

async function main() {
  if (process.env.FROM_DIST === "1") { await manifestFromDist(); return; }
  mkdirSync(DIST, { recursive: true });
  const manifest = {};
  const toUpload = [];
  for (const spec of REGISTRY) {
    const platforms = {};
    let langVersion, langKind, langEntry;
    for (const plat of PLATFORMS) {
      const r = await buildOne(spec, plat);
      langVersion = spec.version;
      langKind = r.kind;
      langEntry = r.entry_relative;
      const url = `${RAW_BASE}/${r.assetName}`;
      platforms[plat.key] = { url, sha256: r.sha };
      toUpload.push(join(DIST, spec.id, plat.key, r.assetName));
    }
    manifest[spec.id] = {
      version: langVersion,
      entry_kind: langKind,
      entry_relative: langEntry,
      args: spec.args,
      platforms,
    };
  }
  // Host-toolchain languages are intentionally absent from the manifest.
  for (const id of HOST_TOOLCHAIN) {
    if (manifest[id]) delete manifest[id];
  }
  writeFileSync(join(ROOT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  // The manifest is a release asset too, so the app fetches it from the same
  // stable URL as the bundles (no need to commit it back into the repo).
  toUpload.push(join(ROOT, "manifest.json"));
  await publishRollingRelease(toUpload);
  console.log("manifest.json written; uploaded", toUpload.length, "assets");
}

main().catch((e) => { console.error(e); process.exit(1); });
