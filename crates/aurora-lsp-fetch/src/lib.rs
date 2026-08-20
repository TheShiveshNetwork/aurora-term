//! `aurora-lsp-fetch` — prebuilt, manifest-driven bundle acquisition.
//!
//! Every language server (regardless of upstream ecosystem) is pre-built once in
//! CI into a separate `aurora-lsp-bundles` repo, hosted as versioned tarballs,
//! and described by a single `manifest.json`. At runtime this crate follows ONE
//! uniform path for all languages:
//!
//! ```text
//! fetch manifest (ETag-revalidated, locally cached)
//!   -> compare cached version
//!   -> download tarball
//!   -> verify sha256
//!   -> extract
//!   -> finalize (quarantine / exec-bit fixes)
//! ```
//!
//! No npm / GitHub-release / Go-proxy / RubyGems live resolution happens on the
//! user's machine anymore — that branching lives only in the bundles repo's CI.
//! The Windows npm-shim spawn bug and the `{target}` asset-pattern guessing are
//! both gone. `aurora-lsp` (lifecycle) is untouched: it just receives a resolved
//! `program` + `args` + `runtime` and runs it.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use aurora_core::{AppError, ServerRuntime, ServerWeight};
use sha2::Digest;

// ─── Manifest types ──────────────────────────────────────────────────────────

/// One platform-specific asset for a bundle.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct PlatformAsset {
    pub url: String,
    pub sha256: String,
}

/// One language's bundle description, as published in `manifest.json`.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct BundleEntry {
    /// Semver-ish version string; CI bumps this per language via bot PRs.
    pub version: String,
    /// `"node"` → invoke via the bundled Node runtime; `"native"` → spawn the
    /// binary directly. This is the one field that replaces the old
    /// `InstallMethod` branching — CI already resolved everything else.
    #[serde(default = "default_entry_kind")]
    pub entry_kind: String,
    /// Path of the executable relative to the extracted bundle dir.
    pub entry_relative: String,
    /// Extra args passed before the server's own protocol args (e.g. `--stdio`).
    #[serde(default)]
    pub args: Vec<String>,
    /// Per-platform asset map. Keys: `win-x64`, `win-arm64`, `darwin-x64`,
    /// `darwin-arm64`, `linux-x64`, `linux-arm64`.
    pub platforms: HashMap<String, PlatformAsset>,
}

fn default_entry_kind() -> String {
    "native".to_string()
}

/// The full manifest: `language_id` → [`BundleEntry`].
pub type Manifest = HashMap<String, BundleEntry>;

// ─── Resolved server ─────────────────────────────────────────────────────────

/// How the resolved entry should be launched.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServerKind {
    Node,
    Native,
}

impl ServerKind {
    fn from_str(s: &str) -> ServerKind {
        match s {
            "node" => ServerKind::Node,
            _ => ServerKind::Native,
        }
    }

    /// Map to the lifecycle crate's runtime classification for memory caps.
    fn runtime(self, language_id: &str) -> ServerRuntime {
        match self {
            ServerKind::Node => ServerRuntime::Node,
            ServerKind::Native => match language_id {
                // Binary is bundled but still needs a JVM/.NET on PATH to run.
                "java" | "kotlin" | "scala" | "clojure" => ServerRuntime::Jvm,
                _ => ServerRuntime::Native,
            },
        }
    }
}

/// A fully resolved server the lifecycle crate can spawn directly.
#[derive(Debug, Clone)]
pub struct ResolvedServer {
    /// The program to execute. For `entry_kind: "node"` this is the bundled
    /// Node interpreter; for `"native"` it is the extracted binary itself.
    pub program: PathBuf,
    /// Full argument list (Node script / entry included where relevant).
    pub args: Vec<String>,
    /// Runtime class, so `aurora-lsp` applies the right memory cap.
    pub runtime: ServerRuntime,
}

// ─── Host-toolchain languages (never bundled) ────────────────────────────────
//
// These require a toolchain the user already has on PATH (Swift toolchain,
// Coursier/metals, R). CI has nothing to build for them, so they stay
// `RequireOnPath` and are resolved directly from PATH at runtime.

const HOST_TOOLCHAIN: &[(&str, &str)] = &[
    ("swift", "sourcekit-lsp"),
    ("scala", "metals"),
    ("r", "R"),
    // ruby-lsp is a Ruby script that requires a `ruby` interpreter on PATH; it
    // cannot be expressed as a `node`/`native` bundle, so it stays RequireOnPath.
    ("ruby", "ruby-lsp"),
];

/// Rough memory weight class for idle-eviction + heavy concurrency cap. Kept as
/// a tiny static list so the runtime needs no spec table per language.
pub fn weight_for(language_id: &str) -> ServerWeight {
    const HEAVY: &[&str] = &[
        "rust", "go", "c", "cpp", "java", "csharp", "haskell", "scala", "clojure", "kotlin",
        "lua", "swift", "elixir", "r",
    ];
    if HEAVY.contains(&language_id) {
        ServerWeight::Heavy
    } else {
        ServerWeight::Light
    }
}

// ─── Platform + manifest source ───────────────────────────────────────────────

/// The platform token used to index `BundleEntry::platforms`.
pub fn current_platform() -> &'static str {
    #[cfg(all(windows, target_arch = "x86_64"))]
    return "win-x64";
    #[cfg(all(windows, target_arch = "aarch64"))]
    return "win-arm64";
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    return "darwin-x64";
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return "darwin-arm64";
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    return "linux-x64";
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    return "linux-arm64";
    #[allow(unreachable_code)]
    {
        "unknown"
    }
}

/// Manifest URL. Overridable via `AURORA_LSP_BUNDLES_MANIFEST` (useful for local
/// dev / self-hosting). Defaults to `aurora-lsp-bundles/manifest.json` in this
/// app repo (built by the root `.github/workflows/lsp-bundles-build.yml`).
fn manifest_url() -> String {
    std::env::var("AURORA_LSP_BUNDLES_MANIFEST").unwrap_or_else(|_| {
        "https://github.com/TheShiveshNetwork/aurora-term/releases/download/lsp-bundles/manifest.json"
            .to_string()
    })
}

/// Ask the Supabase-cached backend for the latest LSP bundle's manifest URL.
/// Returns `None` if the backend is unreachable or has no LSP release cached
/// yet (so the caller falls back to the direct GitHub URL).
async fn fetch_lsp_manifest_url(api_base_url: &str) -> Result<Option<String>, AppError> {
    let url = format!(
        "{}/v1/update/lsp",
        api_base_url.trim_end_matches('/')
    );
    let client = reqwest_client()?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| reqwest_network_err("lsp update check failed", &e))?;
    if !resp.status().is_success() {
        return Ok(None);
    }
    let body = resp
        .text()
        .await
        .map_err(|e| AppError::Lsp(format!("lsp update check read failed: {e}")))?;
    #[derive(serde::Deserialize)]
    struct LspUpdate {
        download_url: Option<String>,
        url: Option<String>,
    }
    let parsed: LspUpdate = serde_json::from_str(&body)
        .map_err(|e| AppError::Lsp(format!("lsp update check parse failed: {e}")))?;
    Ok(parsed.download_url.or(parsed.url))
}

fn reqwest_client() -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .user_agent("aurora-term")
        .build()
        .map_err(|e| AppError::Lsp(e.to_string()))
}

/// Classify a `reqwest` failure. Connection / timeout failures are real network
/// outages (no internet, DNS down, refused) and are tagged with the
/// `Network Error:` prefix so the frontend can surface the offline-install
/// message instead of a cryptic stack.
fn reqwest_network_err(context: &str, e: &reqwest::Error) -> AppError {
    if e.is_connect() || e.is_timeout() {
        AppError::Lsp(format!("Network Error: {context}: {e}"))
    } else {
        AppError::Lsp(format!("{context}: {e}"))
    }
}

// ─── Installed-bundle metadata (offline reuse) ───────────────────────────────
//
// Once a bundle has been downloaded + extracted, we persist its resolved entry
// metadata next to the extracted binary. On every later `ensure_installed` call
// we reuse the on-disk server directly — no manifest fetch, no re-download — so
// language servers are installed exactly once and only re-acquired when the app
// is updated (a future hook that will bump/remove this metadata file).

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct InstalledMeta {
    version: String,
    entry_kind: String,
    entry_relative: String,
    args: Vec<String>,
}

fn installed_meta_path(target_dir: &Path) -> PathBuf {
    target_dir.join(".installed.json")
}

/// Read the cached install metadata, but only if the resolved entry binary is
/// still present on disk (a half-finished extraction is not "installed").
fn read_installed_meta(target_dir: &Path) -> Option<InstalledMeta> {
    let txt = std::fs::read_to_string(installed_meta_path(target_dir)).ok()?;
    let meta: InstalledMeta = serde_json::from_str(&txt).ok()?;
    let mut entry_path = target_dir.join(&meta.entry_relative);
    #[cfg(windows)]
    if !entry_path.exists() {
        let alt = entry_path.with_extension("exe");
        if alt.exists() {
            entry_path = alt;
        }
    }
    entry_path.exists().then_some(meta)
}

fn write_installed_meta(target_dir: &Path, meta: &InstalledMeta) -> Result<(), AppError> {
    std::fs::create_dir_all(target_dir)
        .map_err(|e| AppError::Lsp(format!("failed to create bundle dir: {}", e)))?;
    let txt = serde_json::to_string(meta)
        .map_err(|e| AppError::Lsp(format!("failed to serialize installed meta: {}", e)))?;
    std::fs::write(installed_meta_path(target_dir), txt)
        .map_err(|e| AppError::Lsp(format!("failed to write installed meta: {}", e)))
}

// ─── Manifest fetch (ETag-revalidated, locally cached) ───────────────────────

/// Fetch the manifest, reusing the locally cached copy when the remote has not
/// changed (HTTP 304 via `If-None-Match`). The cache is `cache_dir/manifest.json`
/// plus `cache_dir/manifest.etag`.
pub async fn get_manifest(
    cache_dir: &Path,
    api_base_url: &str,
) -> Result<Manifest, AppError> {
    std::fs::create_dir_all(cache_dir)
        .map_err(|e| AppError::Lsp(format!("failed to create cache dir: {}", e)))?;
    let manifest_path = cache_dir.join("manifest.json");
    let etag_path = cache_dir.join("manifest.etag");

    // Prefer the Supabase-cached LSP bundle discovery; fall back to the
    // hardcoded/env manifest URL if the backend is unreachable or has no
    // LSP release cached yet.
    let manifest_src = if !api_base_url.is_empty() {
        match fetch_lsp_manifest_url(api_base_url).await {
            Ok(Some(u)) => u,
            _ => manifest_url(),
        }
    } else {
        manifest_url()
    };

    let client = reqwest_client()?;
    let mut req = client.get(&manifest_src);
    if let Ok(etag) = std::fs::read_to_string(&etag_path) {
        let etag = etag.trim();
        if !etag.is_empty() {
            req = req.header(reqwest::header::IF_NONE_MATCH, etag);
        }
    }

    let resp = req
        .send()
        .await
        .map_err(|e| reqwest_network_err("manifest request failed", &e))?;

    if resp.status() == reqwest::StatusCode::NOT_MODIFIED {
        let txt = std::fs::read_to_string(&manifest_path)
            .map_err(|e| AppError::Lsp(format!("cached manifest read failed: {}", e)))?;
        return serde_json::from_str(&txt)
            .map_err(|e| AppError::Lsp(format!("cached manifest parse failed: {}", e)));
    }

    if !resp.status().is_success() {
        return Err(AppError::Lsp(format!(
            "manifest returned {} from {}",
            resp.status(),
            manifest_src
        )));
    }

    let etag = resp
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let txt = resp
        .text()
        .await
        .map_err(|e| AppError::Lsp(format!("manifest read failed: {}", e)))?;
    if let Some(etag) = etag {
        let _ = std::fs::write(&etag_path, etag);
    }
    let _ = std::fs::write(&manifest_path, &txt);
    serde_json::from_str(&txt).map_err(|e| AppError::Lsp(format!("manifest parse failed: {}", e)))
}

// ─── Uniform acquisition path ────────────────────────────────────────────────

/// Ensure the server for `language_id` is available on disk, returning a fully
/// resolved command. One code path for every language.
///
/// A bundle is installed exactly once: the first time it is needed we fetch the
/// manifest and download the tarball, then persist its entry metadata. Every
/// subsequent call reuses the on-disk server and never touches the network, so
/// language servers are not re-downloaded on each editor open. Re-acquisition is
/// reserved for app updates (a future hook that will invalidate the cached
/// metadata).
pub async fn ensure_installed(
    language_id: &str,
    cache_dir: &Path,
    api_base_url: &str,
) -> Result<ResolvedServer, AppError> {
    // 1. Host-toolchain languages: resolve directly from PATH (no download).
    if let Some((_, bin)) = HOST_TOOLCHAIN.iter().find(|(l, _)| *l == language_id) {
        let path = which::which(bin)
            .map_err(|_| AppError::Lsp(format!("{} not found on PATH (required for {})", bin, language_id)))?;
        return Ok(ResolvedServer {
            program: path,
            args: vec![],
            runtime: ServerRuntime::Native,
        });
    }

    let target_dir = cache_dir.join(language_id);

    // 2. Already installed locally: reuse the on-disk server, skip all network.
    if let Some(meta) = read_installed_meta(&target_dir) {
        return resolve_from_cache(&target_dir, &meta, language_id, cache_dir).await;
    }

    // 3. Not installed yet: fetch manifest (network) and download/verify/extract.
    let manifest = get_manifest(cache_dir, api_base_url).await?;
    let entry = manifest.get(language_id).ok_or_else(|| {
        AppError::Lsp(format!("no prebuilt bundle registered for '{}'", language_id))
    })?;
    let platform = current_platform();
    let asset = entry.platforms.get(platform).ok_or_else(|| {
        AppError::Lsp(format!("'{}' bundle not available for platform '{}'", language_id, platform))
    })?;

    download_verify_extract(&asset.url, &asset.sha256, &target_dir, language_id).await?;

    let meta = InstalledMeta {
        version: entry.version.clone(),
        entry_kind: entry.entry_kind.clone(),
        entry_relative: entry.entry_relative.clone(),
        args: entry.args.clone(),
    };
    write_installed_meta(&target_dir, &meta)?;

    resolve_from_cache(&target_dir, &meta, language_id, cache_dir).await
}

/// Build the [`ResolvedServer`] from an already-extracted bundle directory.
async fn resolve_from_cache(
    target_dir: &Path,
    meta: &InstalledMeta,
    language_id: &str,
    cache_dir: &Path,
) -> Result<ResolvedServer, AppError> {
    let kind = ServerKind::from_str(&meta.entry_kind);
    let mut entry_path = target_dir.join(&meta.entry_relative);
    // Some upstream bundles ship the binary without the `.exe` suffix on Windows.
    #[cfg(windows)]
    if !entry_path.exists() {
        let alt = entry_path.with_extension("exe");
        if alt.exists() {
            entry_path = alt;
        }
    }
    if !entry_path.exists() {
        return Err(AppError::Lsp(format!(
            "bundle entry '{}' missing after extraction (looked in {})",
            meta.entry_relative,
            target_dir.display()
        )));
    }
    finalize_downloaded_binary(&entry_path)?;

    match kind {
        ServerKind::Node => {
            let node_dir = ensure_node_runtime(cache_dir).await?;
            let node_exe = node_exe_path(&node_dir);
            let mut args = vec![entry_path.to_string_lossy().to_string()];
            args.extend(meta.args.iter().cloned());
            Ok(ResolvedServer {
                program: node_exe,
                args,
                runtime: ServerRuntime::Node,
            })
        }
        ServerKind::Native => Ok(ResolvedServer {
            program: entry_path,
            args: meta.args.clone(),
            runtime: kind.runtime(language_id),
        }),
    }
}

// ─── Download + verify + extract ─────────────────────────────────────────────

/// Download `url` to `dest`, verify its sha256 against `expected`, then extract
/// into `target_dir` (cleared first so a stale prior version can't linger).
async fn download_verify_extract(
    url: &str,
    expected_sha256: &str,
    target_dir: &Path,
    language_id: &str,
) -> Result<(), AppError> {
    let tmp = target_dir
        .parent()
        .unwrap_or(target_dir)
        .join(format!(".lsp-dl-{}{}", language_id, archive_ext_from_url(url)));
    download_file(url, &tmp).await?;

    verify_sha256(&tmp, expected_sha256)
        .await
        .inspect_err(|_| {
            let _ = std::fs::remove_file(&tmp);
        })?;

    clear_dir(target_dir)?;
    extract_into(&tmp, target_dir).await?;
    let _ = std::fs::remove_file(&tmp);
    Ok(())
}

/// Compute the sha256 of `path` and compare against the expected hex string.
async fn verify_sha256(path: &Path, expected: &str) -> Result<(), AppError> {
    let bytes = std::fs::read(path)
        .map_err(|e| AppError::Lsp(format!("failed to read downloaded bundle: {}", e)))?;
    let digest = sha2::Sha256::digest(&bytes);
    let actual = hex::encode(digest);
    if !actual.eq_ignore_ascii_case(expected) {
        return Err(AppError::Lsp(format!(
            "bundle sha256 mismatch: expected {} got {}",
            expected, actual
        )));
    }
    Ok(())
}

/// Remove all entries inside `dir` (but keep `dir` itself).
fn clear_dir(dir: &Path) -> Result<(), AppError> {
    std::fs::create_dir_all(dir)
        .map_err(|e| AppError::Lsp(format!("failed to create bundle dir: {}", e)))?;
    let entries = std::fs::read_dir(dir)
        .map_err(|e| AppError::Lsp(format!("failed to read bundle dir: {}", e)))?;
    for entry in entries {
        let entry = entry.map_err(|e| AppError::Lsp(e.to_string()))?;
        let p = entry.path();
        if p.is_dir() {
            let _ = std::fs::remove_dir_all(&p);
        } else {
            let _ = std::fs::remove_file(&p);
        }
    }
    Ok(())
}

// ─── Cross-platform post-download fixes ──────────────────────────────────────

/// Downloaded binaries are still downloaded binaries — OS trust mechanisms don't
/// care that the source is now our own repo. Strip the quarantine / zone marker
/// and ensure the exec bit is set. Called for every extracted entry.
pub fn finalize_downloaded_binary(exec_path: &Path) -> Result<(), AppError> {
    if !exec_path.exists() {
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        // Strip the Mark-of-the-Web alternate data stream.
        let ads = format!("{}:Zone.Identifier", exec_path.display());
        let _ = std::fs::remove_file(&ads);
    }

    #[cfg(target_os = "macos")]
    unsafe {
        use std::ffi::CString;
        let p = CString::new(exec_path.as_os_str().as_encoded_bytes()).unwrap();
        let a = CString::new("com.apple.quarantine").unwrap();
        libc::removexattr(p.as_ptr(), a.as_ptr(), 0);
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(exec_path)
            .map_err(|e| AppError::Lsp(e.to_string()))?
            .permissions();
        perms.set_mode(perms.mode() | 0o111);
        std::fs::set_permissions(exec_path, perms)
            .map_err(|e| AppError::Lsp(e.to_string()))?;
    }

    Ok(())
}

// ─── Portable Node runtime (lazy, fetched once, cached) ──────────────────────

/// Pinned Node version used to run `entry_kind: "node"` bundles. Bumped via the
/// bundles repo's own release process; never bundled in the app installer.
const NODE_VERSION: &str = "v22.11.0";

/// Ensure a portable Node runtime exists in `cache_dir/runtime/node`, returning
/// its directory. Reuses a Node found on PATH if present; otherwise downloads a
/// portable build once.
pub async fn ensure_node_runtime(cache_dir: &Path) -> Result<PathBuf, AppError> {
    if let Ok(path) = which::which("node") {
        if let Some(dir) = path.parent() {
            return Ok(dir.to_path_buf());
        }
    }

    let runtime_dir = cache_dir.join("runtime");
    std::fs::create_dir_all(&runtime_dir)
        .map_err(|e| AppError::Lsp(format!("failed to create runtime dir: {}", e)))?;
    let node_dir = runtime_dir.join("node");
    let exe = node_exe_path(&node_dir);
    if exe.exists() {
        return Ok(node_dir);
    }

    let (url, _archive_ext) = node_asset_for_platform();
    tracing::info!("LSP: fetching portable Node {} for node-based bundles", NODE_VERSION);
    let node_ext = if url.to_ascii_lowercase().ends_with(".zip") {
        ".zip"
    } else {
        ".tar.gz"
    };
    let tmp = runtime_dir.join(format!(".node-dl{}", node_ext));
    download_file(&url, &tmp).await?;
    extract_into(&tmp, &node_dir).await?;
    let _ = std::fs::remove_file(&tmp);

    // The archive nests a top-level `node-<ver>-<plat>` dir; relocate the binary
    // to the stable `node_dir/node[.exe]` path.
    relocate_node_binary(&node_dir)?;
    if !exe.exists() {
        return Err(AppError::Lsp(
            "portable Node binary missing after extraction".to_string(),
        ));
    }
    finalize_downloaded_binary(&exe)?;
    Ok(node_dir)
}

/// Stable path of the portable Node binary inside `node_dir`.
fn node_exe_path(node_dir: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        node_dir.join("node.exe")
    }
    #[cfg(not(windows))]
    {
        node_dir.join("bin").join("node")
    }
}

/// Map the app platform to a Node.js dist asset name + archive extension.
fn node_asset_for_platform() -> (String, &'static str) {
    let plat = current_platform();
    let (node_plat, ext) = match plat {
        "win-x64" => ("win-x64", "zip"),
        "win-arm64" => ("win-arm64", "zip"),
        "darwin-x64" => ("darwin-x64", "tar.gz"),
        "darwin-arm64" => ("darwin-arm64", "tar.gz"),
        "linux-x64" => ("linux-x64", "tar.gz"),
        "linux-arm64" => ("linux-arm64", "tar.gz"),
        _ => ("linux-x64", "tar.gz"),
    };
    let url = format!(
        "https://nodejs.org/dist/{}/node-{}-{}.{}",
        NODE_VERSION, NODE_VERSION, node_plat, ext
    );
    (url, ext)
}

/// Find the Node binary inside the extracted archive and copy it to the stable
/// `node_dir/node[.exe]` location.
fn relocate_node_binary(node_dir: &Path) -> Result<(), AppError> {
    let wanted = if cfg!(windows) { "node.exe" } else { "node" };
    let found = find_file(node_dir, wanted)
        .ok_or_else(|| AppError::Lsp("portable Node binary not found in archive".to_string()))?;
    let dest = node_exe_path(node_dir);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| AppError::Lsp(e.to_string()))?;
    }
    std::fs::copy(&found, &dest)
        .map_err(|e| AppError::Lsp(format!("failed to relocate Node binary: {}", e)))?;
    Ok(())
}

/// Recursively find a file by name under `dir`.
fn find_file(dir: &Path, name: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            if let Some(found) = find_file(&p, name) {
                return Some(found);
            }
        } else if p.file_name().map(|n| n == name).unwrap_or(false) {
            return Some(p);
        }
    }
    None
}

// ─── Shared download / extraction helpers ────────────────────────────────────

async fn download_file(url: &str, dest: &Path) -> Result<(), AppError> {
    let client = reqwest_client()?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| reqwest_network_err(&format!("download failed for {url}"), &e))?;
    if !resp.status().is_success() {
        return Err(AppError::Lsp(format!(
            "download returned {} for {}",
            resp.status(),
            url
        )));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::Lsp(format!("download read failed: {}", e)))?;
    std::fs::write(dest, &bytes)
        .map_err(|e| AppError::Lsp(format!("write download failed: {}", e)))?;
    Ok(())
}

/// Derive the on-disk archive extension from a download URL's filename so the
/// temp download keeps a real extension and `extract_into` can dispatch on it.
/// The downloaded file is a `.tmp` by default, which would otherwise match no
/// known archive type.
fn archive_ext_from_url(url: &str) -> &'static str {
    let name = url.rsplit('/').next().unwrap_or(url).to_ascii_lowercase();
    if name.ends_with(".tar.gz") || name.ends_with(".tgz") {
        ".tar.gz"
    } else if name.ends_with(".tar") {
        ".tar"
    } else if name.ends_with(".zip") {
        ".zip"
    } else {
        ".bin"
    }
}

/// Extract `archive` into `dest`, dispatching on extension.
async fn extract_into(archive: &Path, dest: &Path) -> Result<(), AppError> {
    std::fs::create_dir_all(dest)
        .map_err(|e| AppError::Lsp(format!("extract dir create failed: {}", e)))?;
    let name = archive.to_string_lossy().to_lowercase();
    if name.ends_with(".tar.gz") || name.ends_with(".tgz") {
        extract_tar_gz(archive, dest)
    } else if name.ends_with(".tar") {
        extract_tar(archive, dest)
    } else if name.ends_with(".zip") {
        extract_zip_system(archive, dest)
    } else {
        Err(AppError::Lsp(format!(
            "unsupported bundle archive type: {}",
            archive.display()
        )))
    }
}

/// Extract a `.tar.gz` archive by streaming each entry manually. We avoid the
/// `tar` crate's `Archive::unpack` because on Windows it aborts the whole
/// extraction on certain real-world npm-tarball entries (deep paths where the
/// `\\?\` long-path prefix interacts badly with directory creation, or symlink
/// permission errors), leaving bundles half-written so the language server can't
/// start. Manual extraction creates parent dirs consistently, prefixes long
/// paths with `\\?\` so Windows accepts them, and skips symlinks (which Windows
/// can't create without elevated rights and which LSP servers don't need). This
/// path is shared by every tar-based language bundle, so a fix here covers all
/// of them.
fn extract_tar_gz(archive: &Path, dest: &Path) -> Result<(), AppError> {
    let file = std::fs::File::open(archive).map_err(|e| AppError::Lsp(e.to_string()))?;
    let dec = flate2::read::GzDecoder::new(file);
    extract_tar_inner(dec, dest)
}

fn extract_tar(archive: &Path, dest: &Path) -> Result<(), AppError> {
    let file = std::fs::File::open(archive).map_err(|e| AppError::Lsp(e.to_string()))?;
    extract_tar_inner(file, dest)
}

fn extract_tar_inner<R: std::io::Read>(reader: R, dest: &Path) -> Result<(), AppError> {
    std::fs::create_dir_all(dest)
        .map_err(|e| AppError::Lsp(format!("extract dir create failed: {}", e)))?;
    let mut ar = tar::Archive::new(reader);
    let entries = ar
        .entries()
        .map_err(|e| AppError::Lsp(format!("tar read failed: {}", e)))?;
    for entry in entries {
        let mut entry = entry.map_err(|e| AppError::Lsp(format!("tar entry failed: {}", e)))?;
        let rel = entry
            .path()
            .map_err(|e| AppError::Lsp(format!("tar path failed: {}", e)))?
            .into_owned();
        // Drop a leading "./" so the join stays inside `dest`.
        let rel = rel.strip_prefix("./").unwrap_or(&rel);
        let header = entry.header();
        let kind = header.entry_type();
        let out = long_path(&dest.join(rel));

        if kind.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| {
                AppError::Lsp(format!("mkdir failed ({}): {}", out.display(), e))
            })?;
        } else if kind.is_symlink() {
            // Symlinks can't be created without elevated rights on Windows and
            // aren't needed by LSP servers, so skip them to keep extraction from
            // aborting.
            continue;
        } else {
            if let Some(parent) = out.parent() {
                std::fs::create_dir_all(parent).map_err(|e| {
                    AppError::Lsp(format!("mkdir failed ({}): {}", parent.display(), e))
                })?;
            }
            let mut f = std::fs::File::create(&out).map_err(|e| {
                AppError::Lsp(format!("create failed ({}): {}", out.display(), e))
            })?;
            std::io::copy(&mut entry, &mut f).map_err(|e| {
                AppError::Lsp(format!("write failed ({}): {}", out.display(), e))
            })?;
        }
    }
    Ok(())
}

/// On Windows, prefix an absolute path with `\\?\` when it exceeds `MAX_PATH`
/// (260) so the OS accepts deep paths inside npm bundles. No-op elsewhere.
#[cfg(windows)]
fn long_path(p: &Path) -> PathBuf {
    let s = p.as_os_str().to_string_lossy();
    if s.len() > 260 && !s.starts_with("\\\\?\\") {
        PathBuf::from(format!("\\\\?\\{}", s))
    } else {
        p.to_path_buf()
    }
}

#[cfg(not(windows))]
fn long_path(p: &Path) -> PathBuf {
    p.to_path_buf()
}

fn extract_zip_system(archive: &Path, dest: &Path) -> Result<(), AppError> {
    #[cfg(windows)]
    {
        let ps = format!(
            "Expand-Archive -Force -Path '{}' -DestinationPath '{}'",
            archive.display(),
            dest.display()
        );
        let status = std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", &ps])
            .status()
            .map_err(|e| AppError::Lsp(format!("Expand-Archive failed: {}", e)))?;
        if !status.success() {
            return Err(AppError::Lsp("Expand-Archive failed".to_string()));
        }
    }
    #[cfg(not(windows))]
    {
        let status = std::process::Command::new("unzip")
            .args(["-o", "-q", &archive.to_string_lossy(), "-d", &dest.to_string_lossy()])
            .status()
            .map_err(|e| AppError::Lsp(format!("unzip failed: {}", e)))?;
        if !status.success() {
            return Err(AppError::Lsp("unzip failed (is unzip installed?)".to_string()));
        }
    }
    Ok(())
}
