//! `aurora-lsp-fetch` — first-party language server acquisition only.
//!
//! This crate resolves an [`InstallMethod`] for a language, downloads (if
//! needed), verifies, unpacks, and caches the server binary. It never spawns a
//! long-lived server process — it hands `aurora-lsp` a resolved executable
//! path. Keeping acquisition separate from lifecycle means the marketplace
//! work later only touches this crate.

use std::path::{Path, PathBuf};

use aurora_core::AppError;

/// How a server binary is obtained.
#[derive(Debug, Clone)]
pub enum InstallMethod {
    /// Download a release asset from GitHub.
    GithubRelease {
        repo: &'static str,
        asset_pattern: &'static str,
    },
    /// Install an npm package and run its bin through the Node runtime.
    Npm { package: &'static str, bin: &'static str },
    /// `go install <module>` (requires the Go toolchain on PATH).
    GoInstall { module: &'static str },
    /// `gem install <package>` (requires Ruby on PATH).
    Gem { package: &'static str },
    /// Binary already on PATH (JVM/.NET/toolchain-bundled servers).
    RequireOnPath { binary_name: &'static str },
}

/// Rough memory weight class of a server. Drives idle-eviction timing and the
/// concurrent-heavy-server cap in `aurora-lsp`.
pub use aurora_core::{ServerWeight, ServerRuntime};

impl LspServerSpec {
    /// Classify this server as Light or Heavy. Heavy = servers known to use
    /// large amounts of memory on real codebases.
    pub fn weight(&self) -> ServerWeight {
        const HEAVY: &[&str] = &[
            "rust", "go", "c", "cpp", "java", "csharp", "haskell", "scala", "clojure",
            "kotlin", "lua", "swift", "elixir", "r",
        ];
        if HEAVY.contains(&self.language_id) {
            ServerWeight::Heavy
        } else {
            ServerWeight::Light
        }
    }

    /// Classify the runtime a server executes on, for memory limiting.
    pub fn runtime(&self) -> ServerRuntime {
        match self.install {
            InstallMethod::Npm { .. } => ServerRuntime::Node,
            _ => match self.language_id {
                "java" | "kotlin" | "scala" | "clojure" => ServerRuntime::Jvm,
                _ => ServerRuntime::Native,
            },
        }
    }
}

/// A description of one built-in language server.
#[derive(Debug, Clone)]
pub struct LspServerSpec {
    pub language_id: &'static str,
    pub display_name: &'static str,
    pub install: InstallMethod,
    /// Path of the executable relative to the install/cache directory.
    pub exec_relative: &'static str,
    pub args: &'static [&'static str],
}

/// The built-in registry of ~32 languages. Adding a language is one line here.
pub const REGISTRY: &[LspServerSpec] = &[
    // ---- Tier 1 ----
    LspServerSpec { language_id: "typescript", display_name: "typescript-language-server",
        install: InstallMethod::Npm { package: "typescript-language-server", bin: "typescript-language-server" },
        exec_relative: "typescript-language-server", args: &["--stdio"] },
    LspServerSpec { language_id: "javascript", display_name: "typescript-language-server",
        install: InstallMethod::Npm { package: "typescript-language-server", bin: "typescript-language-server" },
        exec_relative: "typescript-language-server", args: &["--stdio"] },
    LspServerSpec { language_id: "python", display_name: "pyright",
        install: InstallMethod::Npm { package: "pyright", bin: "pyright-langserver" },
        exec_relative: "pyright-langserver", args: &["--stdio"] },
    LspServerSpec { language_id: "rust", display_name: "rust-analyzer",
        install: InstallMethod::GithubRelease { repo: "rust-lang/rust-analyzer", asset_pattern: "rust-analyzer-{target}" },
        exec_relative: "rust-analyzer", args: &[] },
    LspServerSpec { language_id: "go", display_name: "gopls",
        install: InstallMethod::GoInstall { module: "golang.org/x/tools/gopls@latest" },
        exec_relative: "gopls", args: &[] },
    LspServerSpec { language_id: "c", display_name: "clangd",
        install: InstallMethod::GithubRelease { repo: "clangd/clangd", asset_pattern: "clangd-{target}.zip" },
        exec_relative: "clangd", args: &[] },
    LspServerSpec { language_id: "cpp", display_name: "clangd",
        install: InstallMethod::GithubRelease { repo: "clangd/clangd", asset_pattern: "clangd-{target}.zip" },
        exec_relative: "clangd", args: &[] },
    LspServerSpec { language_id: "java", display_name: "jdtls",
        install: InstallMethod::GithubRelease { repo: "eclipse-jdtls/eclipse.jdt.ls", asset_pattern: "jdt-language-server-{version}.tar.gz" },
        exec_relative: "bin/jdtls", args: &[] },
    LspServerSpec { language_id: "csharp", display_name: "OmniSharp",
        install: InstallMethod::GithubRelease { repo: "OmniSharp/omnisharp-roslyn", asset_pattern: "omnisharp-{target}.zip" },
        exec_relative: "OmniSharp", args: &["-lsp"] },
    LspServerSpec { language_id: "html", display_name: "vscode-html-language-server",
        install: InstallMethod::Npm { package: "vscode-langservers-extracted", bin: "vscode-html-language-server" },
        exec_relative: "vscode-html-language-server", args: &["--stdio"] },
    LspServerSpec { language_id: "css", display_name: "vscode-css-language-server",
        install: InstallMethod::Npm { package: "vscode-langservers-extracted", bin: "vscode-css-language-server" },
        exec_relative: "vscode-css-language-server", args: &["--stdio"] },
    LspServerSpec { language_id: "json", display_name: "vscode-json-language-server",
        install: InstallMethod::Npm { package: "vscode-langservers-extracted", bin: "vscode-json-language-server" },
        exec_relative: "vscode-json-language-server", args: &["--stdio"] },
    LspServerSpec { language_id: "yaml", display_name: "yaml-language-server",
        install: InstallMethod::Npm { package: "yaml-language-server", bin: "yaml-language-server" },
        exec_relative: "yaml-language-server", args: &["--stdio"] },
    LspServerSpec { language_id: "bash", display_name: "bash-language-server",
        install: InstallMethod::Npm { package: "bash-language-server", bin: "bash-language-server" },
        exec_relative: "bash-language-server", args: &["start"] },

    // ---- Tier 2 ----
    LspServerSpec { language_id: "markdown", display_name: "marksman",
        install: InstallMethod::GithubRelease { repo: "artempyanykh/marksman", asset_pattern: "marksman-{os};marksman.exe" },
        exec_relative: "marksman", args: &["server"] },
    LspServerSpec { language_id: "dockerfile", display_name: "docker-langserver",
        install: InstallMethod::Npm { package: "dockerfile-language-server-nodejs", bin: "docker-langserver" },
        exec_relative: "docker-langserver", args: &["--stdio"] },
    LspServerSpec { language_id: "lua", display_name: "lua-language-server",
        install: InstallMethod::GithubRelease { repo: "LuaLS/lua-language-server", asset_pattern: "lua-language-server-{version}-{target}.tar.gz" },
        exec_relative: "bin/lua-language-server", args: &[] },
    LspServerSpec { language_id: "php", display_name: "intelephense",
        install: InstallMethod::Npm { package: "intelephense", bin: "intelephense" },
        exec_relative: "intelephense", args: &["--stdio"] },
    LspServerSpec { language_id: "ruby", display_name: "ruby-lsp",
        install: InstallMethod::Gem { package: "ruby-lsp" },
        exec_relative: "ruby-lsp", args: &[] },
    LspServerSpec { language_id: "swift", display_name: "sourcekit-lsp",
        install: InstallMethod::RequireOnPath { binary_name: "sourcekit-lsp" },
        exec_relative: "sourcekit-lsp", args: &[] },
    LspServerSpec { language_id: "kotlin", display_name: "kotlin-language-server",
        install: InstallMethod::GithubRelease { repo: "fwcd/kotlin-language-server", asset_pattern: "server.zip" },
        exec_relative: "bin/kotlin-language-server", args: &[] },
    LspServerSpec { language_id: "toml", display_name: "taplo",
        install: InstallMethod::GithubRelease { repo: "tamasfe/taplo", asset_pattern: "taplo-{target}.gz" },
        exec_relative: "taplo", args: &["lsp", "stdio"] },
    LspServerSpec { language_id: "vue", display_name: "vue-language-server",
        install: InstallMethod::Npm { package: "@vue/language-server", bin: "vue-language-server" },
        exec_relative: "vue-language-server", args: &["--stdio"] },
    LspServerSpec { language_id: "svelte", display_name: "svelte-language-server",
        install: InstallMethod::Npm { package: "svelte-language-server", bin: "svelteserver" },
        exec_relative: "svelteserver", args: &["--stdio"] },

    // ---- Tier 3 ----
    LspServerSpec { language_id: "zig", display_name: "zls",
        install: InstallMethod::GithubRelease { repo: "zigtools/zls", asset_pattern: "zls-{target}.tar.gz" },
        exec_relative: "zls", args: &[] },
    LspServerSpec { language_id: "terraform", display_name: "terraform-ls",
        install: InstallMethod::GithubRelease { repo: "hashicorp/terraform-ls", asset_pattern: "terraform-ls_{version}_{target}.zip" },
        exec_relative: "terraform-ls", args: &["serve"] },
    LspServerSpec { language_id: "graphql", display_name: "graphql-lsp",
        install: InstallMethod::Npm { package: "graphql-language-service-cli", bin: "graphql-lsp" },
        exec_relative: "graphql-lsp", args: &["server", "--method", "stream"] },
    LspServerSpec { language_id: "sql", display_name: "sqls",
        install: InstallMethod::GoInstall { module: "github.com/sqls-server/sqls@latest" },
        exec_relative: "sqls", args: &[] },
    LspServerSpec { language_id: "elixir", display_name: "elixir-ls",
        install: InstallMethod::GithubRelease { repo: "elixir-lsp/elixir-ls", asset_pattern: "elixir-ls.zip" },
        exec_relative: "language_server.sh", args: &[] },
    LspServerSpec { language_id: "haskell", display_name: "haskell-language-server",
        install: InstallMethod::GithubRelease { repo: "haskell/haskell-language-server", asset_pattern: "haskell-language-server-{target}.tar.gz" },
        exec_relative: "haskell-language-server-wrapper", args: &["--lsp"] },
    LspServerSpec { language_id: "scala", display_name: "metals",
        install: InstallMethod::RequireOnPath { binary_name: "metals" },
        exec_relative: "metals", args: &[] },
    LspServerSpec { language_id: "clojure", display_name: "clojure-lsp",
        install: InstallMethod::GithubRelease { repo: "clojure-lsp/clojure-lsp", asset_pattern: "clojure-lsp-native-{target}.zip" },
        exec_relative: "clojure-lsp", args: &[] },
    LspServerSpec { language_id: "nix", display_name: "nil",
        install: InstallMethod::GithubRelease { repo: "oxalica/nil", asset_pattern: "nil-{target}" },
        exec_relative: "nil", args: &[] },
    LspServerSpec { language_id: "r", display_name: "r-languageserver",
        install: InstallMethod::RequireOnPath { binary_name: "R" },
        exec_relative: "R", args: &["--slave", "-e", "languageserver::run()"] },
];

/// Look up a registry spec by `language_id`.
pub fn spec_for(language_id: &str) -> Option<&'static LspServerSpec> {
    REGISTRY.iter().find(|s| s.language_id == language_id)
}

/// A resolved executable the LSP manager can spawn.
#[derive(Debug, Clone)]
pub struct ResolvedExec {
    /// The program to execute.
    pub program: PathBuf,
    /// Arguments to prepend before the server's own `args`.
    pub base_args: Vec<String>,
}

/// Ensure the server for `spec` is installed in `cache_dir`, returning the
/// path to the executable. Network/toolchain access only happens on a cache miss.
pub async fn ensure_installed(spec: &LspServerSpec, cache_dir: &Path) -> Result<ResolvedExec, AppError> {
    // Cheap first probe: if the server is already on PATH (from `cargo install`,
    // `npm i -g`, Homebrew, pip, mason.nvim, a VS Code global CLI, etc.) we skip
    // any download entirely. This is strictly better than only probing for
    // `RequireOnPath` entries — it reuses whatever the user's system already has,
    // from any source. Consistent with how VS Code/Zed/Neovim converge.
    if let Ok(path) = which::which(spec.exec_relative) {
        tracing::info!(
            "LSP '{}' found on PATH at {}, skipping acquisition",
            spec.exec_relative,
            path.display()
        );
        return Ok(ResolvedExec { program: path, base_args: vec![] });
    }

    let install_dir = cache_dir.join("servers").join(spec.language_id);
    std::fs::create_dir_all(&install_dir)
        .map_err(|e| AppError::Lsp(format!("failed to create cache dir: {}", e)))?;

    match &spec.install {
        InstallMethod::RequireOnPath { binary_name } => {
            let path = which::which(binary_name)
                .map_err(|_| AppError::Lsp(format!("{} not found on PATH", binary_name)))?;
            Ok(ResolvedExec { program: path, base_args: vec![] })
        }
        InstallMethod::Npm { package, bin } => install_npm(package, bin, &install_dir).await,
        InstallMethod::GoInstall { module } => install_go(spec, module, &install_dir).await,
        InstallMethod::Gem { package } => install_gem(spec, package, &install_dir).await,
        InstallMethod::GithubRelease { repo, asset_pattern } => {
            install_github(spec, repo, asset_pattern, &install_dir).await
        }
    }
}

/// Resolve the current target triple to a short platform token used in asset
/// names. This is intentionally permissive — multiple candidate tokens are
/// tried downstream.
fn target_triple() -> &'static str {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    return "x86_64-pc-windows-msvc";
    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    return "aarch64-pc-windows-msvc";
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    return "x86_64-apple-darwin";
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return "aarch64-apple-darwin";
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    return "x86_64-unknown-linux-gnu";
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    return "aarch64-unknown-linux-gnu";
    #[allow(unreachable_code)]
    {
        "unknown"
    }
}

/// The short OS keywords that appear in release asset names for the current
/// platform. Used for OS-aware matching when exact substitution misses.
fn os_keywords() -> Vec<&'static str> {
    let triple = target_triple();
    if triple.contains("windows") {
        vec!["windows", "win32"]
    } else if triple.contains("apple") {
        vec!["mac", "macos", "darwin"]
    } else if triple.contains("linux") {
        vec!["linux"]
    } else {
        vec![]
    }
}

/// The short OS token used to substitute `{os}` in asset/exec patterns.
fn os_token() -> &'static str {
    let triple = target_triple();
    if triple.contains("windows") {
        "windows"
    } else if triple.contains("apple") {
        "mac"
    } else {
        "linux"
    }
}

/// Substitute the `{os}`/`{target}`/`{arch}`/`{musl}`/`{version}` placeholders
/// used in asset and exec patterns for the current platform.
fn substitute_platform(pattern: &str) -> String {
    let triple = target_triple();
    let os = os_token();
    let arch = if triple.starts_with("x86_64") {
        "x86_64"
    } else if triple.starts_with("aarch64") {
        "aarch64"
    } else if triple.starts_with("arm") {
        "arm"
    } else {
        ""
    };
    let musl = if triple.contains("musl") { "musl" } else { "" };
    pattern
        .replace("{target}", triple)
        .replace("{os}", os)
        .replace("{arch}", arch)
        .replace("{musl}", musl)
        // Version is left open — drop the literal "{version}" segment.
        .replace("{version}", "")
}

/// Build the set of exact candidate asset names. A pattern may list several
/// alternatives separated by `;`, each with platform placeholders substituted.
fn candidate_asset_names(pattern: &str) -> Vec<String> {
    let mut out = Vec::new();
    for sub in pattern.split(';') {
        let sub = sub.trim();
        if sub.is_empty() {
            continue;
        }
        out.push(substitute_platform(sub));
    }
    out
}

/// Pick the best matching asset name from the release's asset list. `bin_stem`
/// is the server binary name (sans path/extension) used for prefix matching.
/// Strip a known archive suffix so an asset name can be compared against a bare
/// candidate (e.g. `rust-analyzer-x86_64-pc-windows-msvc.zip` ->
/// `rust-analyzer-x86_64-pc-windows-msvc`).
fn asset_stem(name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    for ext in ["tar.gz", "tgz", "tar", "gz", "zip"] {
        if let Some(stripped) = lower.strip_suffix(ext) {
            return stripped.to_string();
        }
    }
    lower
}

/// Pick the best matching asset name from the release's asset list. `bin_stem`
/// is the server binary name (sans path/extension) used only as a last resort.
fn match_asset(assets: &[String], pattern: &str, bin_stem: &str) -> Option<String> {
    let candidates = candidate_asset_names(pattern);
    let norm_candidates: Vec<String> = candidates.iter().map(|c| asset_stem(c)).collect();

    // 1. Exact (extension-normalized) match against a substituted candidate.
    for asset in assets {
        let na = asset_stem(asset);
        if norm_candidates.iter().any(|c| c == &na) {
            return Some(asset.clone());
        }
    }
    // 2. The asset's stem starts with a full substituted candidate. Because the
    //    candidate already embeds the target triple, this keeps arch-specific
    //    assets from cross-matching (e.g. x86_64 vs aarch64).
    for asset in assets {
        let na = asset_stem(asset);
        if norm_candidates.iter().any(|c| na.starts_with(c)) {
            return Some(asset.clone());
        }
    }
    // 3. OS-aware prefix match: the asset references our OS and starts with the
    //    binary stem.
    let os_kw = os_keywords();
    let lower_stem = bin_stem.to_lowercase();
    let mut stem_fallback: Option<String> = None;
    for asset in assets {
        let lower = asset.to_lowercase();
        let os_ok = os_kw.iter().any(|k| lower.contains(k));
        if os_ok && lower.starts_with(&lower_stem) {
            return Some(asset.clone());
        }
        if stem_fallback.is_none() && lower.starts_with(&lower_stem) {
            stem_fallback = Some(asset.clone());
        }
    }
    // 4. Last resort: any asset that begins with the binary stem.
    stem_fallback
}

// ─── Npm ───────────────────────────────────────────────────────────────────

async fn install_npm(
    package: &str,
    bin: &str,
    install_dir: &Path,
) -> Result<ResolvedExec, AppError> {
    let bin_dir = install_dir.join("node_modules").join(".bin");

    if which::which("npm").is_err() {
        return Err(AppError::Lsp(
            "npm not found on PATH (Node.js is required for npm-based language servers)"
                .to_string(),
        ));
    }

    // On Windows the .bin shim is a `.cmd`; on Unix it is an executable script.
    #[cfg(windows)]
    let shim = bin_dir.join(format!("{}.cmd", bin));
    #[cfg(not(windows))]
    let shim = bin_dir.join(bin);

    if !shim.exists() {
        tracing::info!("LSP npm install: {} -> {}", package, install_dir.display());
        if let Err(e) = run_npm_install(package, install_dir).await {
            return Err(AppError::Lsp(format!("npm install of {} failed: {}", package, e)));
        }
    }

    if !shim.exists() {
        return Err(AppError::Lsp(format!(
            "npm bin {} not found after install (expected at {})",
            bin,
            shim.display()
        )));
    }

    #[cfg(windows)]
    {
        // Run the .cmd shim via cmd.exe.
        Ok(ResolvedExec {
            program: std::path::Path::new("cmd").to_path_buf(),
            base_args: vec!["/c".to_string(), shim.to_string_lossy().to_string()],
        })
    }
    #[cfg(not(windows))]
    {
        let node = which::which("node").map_err(|_| {
            AppError::Lsp(
                "Node.js runtime not found on PATH (required for npm-based language servers)"
                    .to_string(),
            )
        })?;
        Ok(ResolvedExec {
            program: node,
            base_args: vec![shim.to_string_lossy().to_string()],
        })
    }
}

// Run `npm install` for a package into `install_dir`. On Windows `npm` is a
// `.cmd` shim that `CreateProcess` cannot launch directly, so we go through
// `cmd /c npm`.
#[cfg(windows)]
async fn run_npm_install(package: &str, install_dir: &Path) -> Result<(), AppError> {
    let output = tokio::process::Command::new("cmd")
        .args([
            "/c",
            "npm",
            "install",
            "--no-save",
            "--prefix",
            &install_dir.to_string_lossy(),
            package,
        ])
        .output()
        .await
        .map_err(|e| AppError::Lsp(format!("npm install failed to launch: {}", e)))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::Lsp(if stderr.is_empty() {
            format!("npm install of {} failed (exit {})", package, output.status)
        } else {
            format!("npm install of {} failed: {}", package, stderr)
        }));
    }
    Ok(())
}

#[cfg(not(windows))]
async fn run_npm_install(package: &str, install_dir: &Path) -> Result<(), AppError> {
    let output = tokio::process::Command::new("npm")
        .args(["install", "--no-save", "--prefix", &install_dir.to_string_lossy(), package])
        .output()
        .await
        .map_err(|e| AppError::Lsp(format!("npm install failed to launch: {}", e)))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::Lsp(if stderr.is_empty() {
            format!("npm install of {} failed (exit {})", package, output.status)
        } else {
            format!("npm install of {} failed: {}", package, stderr)
        }));
    }
    Ok(())
}

// ─── Go ────────────────────────────────────────────────────────────────────

async fn install_go(
    spec: &LspServerSpec,
    module: &str,
    _install_dir: &Path,
) -> Result<ResolvedExec, AppError> {
    let go = which::which("go")
        .map_err(|_| AppError::Lsp("Go toolchain not found on PATH (required for go-based language servers)".to_string()))?;
    let bin = spec.exec_relative;
    if which::which(bin).is_err() {
        tracing::info!("LSP go install: {}", module);
        let status = tokio::process::Command::new(go)
            .args(["install", module])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await
            .map_err(|e| AppError::Lsp(format!("go install failed: {}", e)))?;
        if !status.success() {
            return Err(AppError::Lsp(format!("go install of {} failed", module)));
        }
    }
    let path = which::which(bin)
        .map_err(|_| AppError::Lsp(format!("{} not found on PATH after go install", bin)))?;
    Ok(ResolvedExec { program: path, base_args: vec![] })
}

// ─── Gem ───────────────────────────────────────────────────────────────────

async fn install_gem(
    spec: &LspServerSpec,
    package: &str,
    _install_dir: &Path,
) -> Result<ResolvedExec, AppError> {
    let gem = which::which("gem")
        .map_err(|_| AppError::Lsp("RubyGems not found on PATH (required for gem-based language servers)".to_string()))?;
    let bin = spec.exec_relative;
    if which::which(bin).is_err() {
        tracing::info!("LSP gem install: {}", package);
        let status = tokio::process::Command::new(gem)
            .args(["install", package])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await
            .map_err(|e| AppError::Lsp(format!("gem install failed: {}", e)))?;
        if !status.success() {
            return Err(AppError::Lsp(format!("gem install of {} failed", package)));
        }
    }
    let path = which::which(bin)
        .map_err(|_| AppError::Lsp(format!("{} not found on PATH after gem install", bin)))?;
    Ok(ResolvedExec { program: path, base_args: vec![] })
}

// ─── GitHub release ──────────────────────────────────────────────────────────

/// Substitute platform placeholders inside an `exec_relative` path.
fn substitute_exec(exec_relative: &str) -> String {
    substitute_platform(exec_relative)
}

/// Whether an asset name refers to a supported archive format. Assets that are
/// already raw executables (e.g. `marksman.exe`, `marksman-linux`) are not
/// archives and should be used directly.
fn is_archive_name(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n.ends_with(".zip")
        || n.ends_with(".tar.gz")
        || n.ends_with(".tgz")
        || n.ends_with(".tar")
        || n.ends_with(".gz")
}

/// Resolve the on-disk executable path inside `extract_dir`, applying a Windows
/// `.exe` fallback when the bare name does not exist.
fn resolve_exec(extract_dir: &Path, exec: &str) -> PathBuf {
    let p = extract_dir.join(exec);
    #[cfg(windows)]
    {
        if !p.exists() {
            let alt = p.with_extension("exe");
            if alt.exists() {
                return alt;
            }
        }
    }
    p
}

async fn install_github(
    spec: &LspServerSpec,
    repo: &str,
    asset_pattern: &str,
    install_dir: &Path,
) -> Result<ResolvedExec, AppError> {
    let asset_name = resolve_asset_name(spec, repo, asset_pattern).await?;

    let downloaded = install_dir.join(&asset_name);
    if !downloaded.exists() {
        let url = format!("https://github.com/{}/releases/latest/download/{}", repo, asset_name);
        tracing::info!("LSP download: {}", url);
        download_file(&url, &downloaded).await?;
    }

    // Extract into a clean subdir keyed by asset name (sans extension).
    let stem = asset_name.rsplit_once('.').map(|(s, _)| s).unwrap_or(&asset_name);
    let extract_dir = install_dir.join(stem);
    let exec = substitute_exec(spec.exec_relative);
    let exec_path = resolve_exec(&extract_dir, &exec);
    if !exec_path.exists() {
        std::fs::create_dir_all(&extract_dir)
            .map_err(|e| AppError::Lsp(format!("extract dir create failed: {}", e)))?;
        if is_archive_name(&asset_name) {
            extract_archive(&downloaded, &extract_dir, &exec).await?;
        } else {
            // The downloaded asset is already the executable. Place it at the
            // resolved exec path (applying the Windows `.exe` fallback).
            let target = resolve_exec(&extract_dir, &exec);
            std::fs::copy(&downloaded, &target)
                .map_err(|e| AppError::Lsp(format!("failed to place executable: {}", e)))?;
        }
    }

    let program = resolve_exec(&extract_dir, &exec);
    if !program.exists() {
        return Err(AppError::Lsp(format!(
            "server executable {} not found after extraction (looked in {})",
            exec,
            extract_dir.display()
        )));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&program)
            .map_err(|e| AppError::Lsp(e.to_string()))?
            .permissions();
        perms.set_mode(0o755);
        let _ = std::fs::set_permissions(&program, perms);
    }

    Ok(ResolvedExec { program, base_args: vec![] })
}

/// Query the GitHub API for the latest release and pick the asset whose name
/// matches `asset_pattern`.
async fn resolve_asset_name(
    spec: &LspServerSpec,
    repo: &str,
    asset_pattern: &str,
) -> Result<String, AppError> {
    let api = format!("https://api.github.com/repos/{}/releases/latest", repo);
    let client = reqwest::Client::builder()
        .user_agent("aurora-term")
        .build()
        .map_err(|e| AppError::Lsp(e.to_string()))?;
    let resp = client
        .get(&api)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| AppError::Lsp(format!("github api request failed: {}", e)))?;
    if !resp.status().is_success() {
        return Err(AppError::Lsp(format!(
            "github api returned {} for {}",
            resp.status(),
            repo
        )));
    }
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::Lsp(format!("github api parse failed: {}", e)))?;
    let assets = json
        .get("assets")
        .and_then(|a| a.as_array())
        .ok_or_else(|| AppError::Lsp("github api: no assets array".to_string()))?;

    let names: Vec<String> = assets
        .iter()
        .filter_map(|a| a.get("name").and_then(|n| n.as_str()).map(String::from))
        .collect();

    let bin_stem = spec
        .exec_relative
        .rsplit('/')
        .next()
        .unwrap_or(spec.exec_relative)
        .split('.')
        .next()
        .unwrap_or(spec.exec_relative)
        // Strip any platform placeholders left in the path so the stem matches
        // the real on-disk binary name (e.g. `rust-analyzer-{os}` -> `rust-analyzer`).
        .replace("{os}", "")
        .replace("{target}", "")
        .replace("{arch}", "")
        .replace("{version}", "")
        .replace("{musl}", "")
        .trim_end_matches('-')
        .to_string();

    if let Some(matched) = match_asset(&names, asset_pattern, &bin_stem) {
        Ok(matched)
    } else {
        Err(AppError::Lsp(format!(
            "no asset matched pattern '{}' for {}; available: {}",
            asset_pattern,
            repo,
            names.join(", ")
        )))
    }
}

async fn download_file(url: &str, dest: &Path) -> Result<(), AppError> {
    let client = reqwest::Client::builder()
        .user_agent("aurora-term")
        .build()
        .map_err(|e| AppError::Lsp(e.to_string()))?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| AppError::Lsp(format!("download failed: {}", e)))?;
    if !resp.status().is_success() {
        return Err(AppError::Lsp(format!("download returned {} for {}", resp.status(), url)));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::Lsp(format!("download read failed: {}", e)))?;
    std::fs::write(dest, &bytes)
        .map_err(|e| AppError::Lsp(format!("write download failed: {}", e)))?;
    Ok(())
}

/// Extract an archive, supporting `.tar.gz`/`.tgz`/`.tar`, single `.gz`, and
/// `.zip` (via the system `unzip`/`Expand-Archive`).
async fn extract_archive(archive: &Path, dest: &Path, exec_relative: &str) -> Result<(), AppError> {
    let name = archive.to_string_lossy().to_lowercase();
    if name.ends_with(".tar.gz") || name.ends_with(".tgz") {
        extract_tar_gz(archive, dest)
    } else if name.ends_with(".tar") {
        extract_tar(archive, dest)
    } else if name.ends_with(".gz") {
        extract_gz(archive, dest, exec_relative)
    } else if name.ends_with(".zip") {
        extract_zip_system(archive, dest)
    } else {
        Err(AppError::Lsp(format!(
            "unsupported archive type: {}",
            archive.display()
        )))
    }
}

fn extract_tar_gz(archive: &Path, dest: &Path) -> Result<(), AppError> {
    let file = std::fs::File::open(archive).map_err(|e| AppError::Lsp(e.to_string()))?;
    let dec = flate2::read::GzDecoder::new(file);
    let mut ar = tar::Archive::new(dec);
    ar.unpack(dest).map_err(|e| AppError::Lsp(format!("tar.gz extract failed: {}", e)))?;
    Ok(())
}

fn extract_tar(archive: &Path, dest: &Path) -> Result<(), AppError> {
    let file = std::fs::File::open(archive).map_err(|e| AppError::Lsp(e.to_string()))?;
    let mut ar = tar::Archive::new(file);
    ar.unpack(dest).map_err(|e| AppError::Lsp(format!("tar extract failed: {}", e)))?;
    Ok(())
}

fn extract_gz(archive: &Path, dest: &Path, exec_relative: &str) -> Result<(), AppError> {
    let file = std::fs::File::open(archive).map_err(|e| AppError::Lsp(e.to_string()))?;
    let mut dec = flate2::read::GzDecoder::new(file);
    let out_name = exec_relative.rsplit('/').next().unwrap_or(exec_relative);
    let out_path = dest.join(out_name);
    let mut out = std::fs::File::create(&out_path).map_err(|e| AppError::Lsp(e.to_string()))?;
    std::io::copy(&mut dec, &mut out).map_err(|e| AppError::Lsp(format!("gz extract failed: {}", e)))?;
    Ok(())
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
