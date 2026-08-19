// Single source of truth for the `aurora-lsp-bundles` CI build.
//
// Mirrors the 32-language registry. The four ecosystem kinds below are the ONLY
// place the old `InstallMethod` branching survives — at build time, not runtime.
// Every language resolves to a versioned, per-platform tarball plus a recorded
// sha256, which `build.mjs` assembles into the published `manifest.json`.

/** @typedef {"npm" | "github" | "go" | "gem"} Ecosystem */

/**
 * @typedef {Object} LangSpec
 * @property {string} id
 * @property {string} version            Pinned upstream version.
 * @property {Ecosystem} eco
 * @property {string} entry_relative     Path of the executable inside the bundle (upstream layout).
 * @property {string[]} args             Args passed before the server's own protocol args.
 * @property {string} [package]          npm package (npm)
 * @property {string[]} [extra]          Extra npm packages installed alongside (npm)
 * @property {string} [repo]             owner/repo (github)
 * @property {string} [asset]            Upstream asset pattern; `{os}`/`{target}`/`{arch}` substituted (github)
 * @property {string} [module]           `go install` module path (go)
 */

/** @type {LangSpec[]} */
export const REGISTRY = [
  // ---- npm (node) ----
  // `bin` is the key in the installed package's own `bin` map; the entry path is
  // resolved from that value at build time (so it tracks upstream renames). The
  // tarball contains the whole `node_modules/` tree, so `entry_relative` is the
  // path inside it: `node_modules/<package>/<binValue>`.
  { id: "typescript", version: "8.0.3", eco: "npm", package: "typescript-language-server", bin: "typescript-language-server", extra: ["typescript"], entry_relative: "node_modules/typescript-language-server/lib/cli.mjs", args: ["--stdio"] },
  { id: "javascript", version: "8.0.3", eco: "npm", package: "typescript-language-server", bin: "typescript-language-server", extra: ["typescript"], entry_relative: "node_modules/typescript-language-server/lib/cli.mjs", args: ["--stdio"] },
  { id: "python", version: "1.1.401", eco: "npm", package: "pyright", bin: "pyright-langserver", entry_relative: "node_modules/pyright/langserver.index.js", args: ["--stdio"] },
  { id: "html", version: "5.4.0", eco: "npm", package: "vscode-langservers-extracted", bin: "vscode-html-language-server", entry_relative: "node_modules/vscode-langservers-extracted/bin/vscode-html-language-server", args: ["--stdio"] },
  { id: "css", version: "5.4.0", eco: "npm", package: "vscode-langservers-extracted", bin: "vscode-css-language-server", entry_relative: "node_modules/vscode-langservers-extracted/bin/vscode-css-language-server", args: ["--stdio"] },
  { id: "json", version: "5.4.0", eco: "npm", package: "vscode-langservers-extracted", bin: "vscode-json-language-server", entry_relative: "node_modules/vscode-langservers-extracted/bin/vscode-json-language-server", args: ["--stdio"] },
  { id: "yaml", version: "1.15.0", eco: "npm", package: "yaml-language-server", bin: "yaml-language-server", entry_relative: "node_modules/yaml-language-server/bin/yaml-language-server", args: ["--stdio"] },
  { id: "bash", version: "5.3.0", eco: "npm", package: "bash-language-server", bin: "bash-language-server", entry_relative: "node_modules/bash-language-server/out/cli.js", args: ["start"] },
  { id: "dockerfile", version: "0.13.0", eco: "npm", package: "dockerfile-language-server-nodejs", bin: "docker-langserver", entry_relative: "node_modules/dockerfile-language-server-nodejs/bin/docker-langserver", args: ["--stdio"] },
  { id: "php", version: "1.13.0", eco: "npm", package: "intelephense", bin: "intelephense", entry_relative: "node_modules/intelephense/lib/intelephense.js", args: ["--stdio"] },
  { id: "vue", version: "2.1.0", eco: "npm", package: "@vue/language-server", bin: "vue-language-server", entry_relative: "node_modules/@vue/language-server/bin/vue-language-server.js", args: ["--stdio"] },
  { id: "svelte", version: "0.16.0", eco: "npm", package: "svelte-language-server", bin: "svelteserver", entry_relative: "node_modules/svelte-language-server/bin/server.js", args: ["--stdio"] },
  { id: "graphql", version: "6.2.0", eco: "npm", package: "graphql-language-service-cli", bin: "graphql-lsp", entry_relative: "node_modules/graphql-language-service-cli/bin/graphql.js", args: ["server", "--method", "stream"] },

  // ---- github (native) ----
  { id: "rust", version: "2026.08.11", eco: "github", repo: "rust-lang/rust-analyzer", asset: "rust-analyzer-{target}", entry_relative: "rust-analyzer", args: [] },
  { id: "c", version: "19.0.0", eco: "github", repo: "clangd/clangd", asset: "clangd-{target}.zip", entry_relative: "clangd", args: [] },
  { id: "cpp", version: "19.0.0", eco: "github", repo: "clangd/clangd", asset: "clangd-{target}.zip", entry_relative: "clangd", args: [] },
  { id: "java", version: "1.41.0", eco: "github", repo: "eclipse-jdtls/eclipse.jdt.ls", asset: "jdt-language-server-{version}.tar.gz", entry_relative: "bin/jdtls", args: [] },
  { id: "csharp", version: "1.40.0", eco: "github", repo: "OmniSharp/omnisharp-roslyn", asset: "omnisharp-{target}.zip", entry_relative: "OmniSharp", args: ["-lsp"] },
  { id: "markdown", version: "0.10.0", eco: "github", repo: "artempyanykh/marksman", asset: "marksman-{os}", entry_relative: "marksman", args: ["server"] },
  { id: "lua", version: "3.13.0", eco: "github", repo: "LuaLS/lua-language-server", asset: "lua-language-server-{version}-{target}.tar.gz", entry_relative: "bin/lua-language-server", args: [] },
  { id: "kotlin", version: "1.3.13", eco: "github", repo: "fwcd/kotlin-language-server", asset: "server.zip", entry_relative: "bin/kotlin-language-server", args: [] },
  { id: "toml", version: "0.9.3", eco: "github", repo: "tamasfe/taplo", asset: "taplo-{target}.gz", entry_relative: "taplo", args: ["lsp", "stdio"] },
  { id: "zig", version: "0.14.0", eco: "github", repo: "zigtools/zls", asset: "zls-{target}", entry_relative: "zls", args: [] },
  { id: "terraform", version: "0.36.0", eco: "github", repo: "hashicorp/terraform-ls", asset: "terraform-ls_{version}_{target}.zip", entry_relative: "terraform-ls", args: ["serve"] },
  { id: "elixir", version: "0.24.0", eco: "github", repo: "elixir-lsp/elixir-ls", asset: "elixir-ls.zip", entry_relative: "language_server.sh", args: [] },
  { id: "haskell", version: "2.10.0", eco: "github", repo: "haskell/haskell-language-server", asset: "haskell-language-server-{target}.tar.gz", entry_relative: "haskell-language-server-wrapper", args: ["--lsp"] },
  { id: "clojure", version: "2025.07.0", eco: "github", repo: "clojure-lsp/clojure-lsp", asset: "clojure-lsp-native-{target}.zip", entry_relative: "clojure-lsp", args: [] },
  { id: "nix", version: "2024.12.0", eco: "github", repo: "oxalica/nil", asset: "nil-{target}", entry_relative: "nil", args: [] },

  // ---- go (native) ----
  { id: "go", version: "0.18.1", eco: "go", module: "golang.org/x/tools/gopls", entry_relative: "gopls", args: [] },
  { id: "sql", version: "1.5.0", eco: "go", module: "github.com/sqls-server/sqls", entry_relative: "sqls", args: [] },
];

// Languages resolved from the host PATH at runtime (no bundle is built).
// swift/scala/r need their own toolchain; ruby-lsp needs a Ruby interpreter —
// neither can be expressed as a `node`/`native` bundle.
export const HOST_TOOLCHAIN = ["swift", "scala", "r", "ruby"];

// Per-platform build tokens.
export const PLATFORMS = [
  { key: "win-x64", os: "windows", target: "x86_64-pc-windows-msvc", arch: "x86_64", goos: "windows", goarch: "amd64" },
  { key: "darwin-x64", os: "macos", target: "x86_64-apple-darwin", arch: "x86_64", goos: "darwin", goarch: "amd64" },
  { key: "darwin-arm64", os: "macos", target: "aarch64-apple-darwin", arch: "aarch64", goos: "darwin", goarch: "arm64" },
  { key: "linux-x64", os: "linux", target: "x86_64-unknown-linux-gnu", arch: "x86_64", goos: "linux", goarch: "amd64" },
];

/**
 * Substitute `{os}`/`{target}`/`{arch}`/`{version}` in an asset pattern.
 * @param {string} pattern
 * @param {typeof PLATFORMS[number]} plat
 * @param {string} version
 */
export function substitute(pattern, plat, version) {
  return pattern
    .replaceAll("{target}", plat.target)
    .replaceAll("{os}", plat.os)
    .replaceAll("{arch}", plat.arch)
    .replaceAll("{version}", version);
}
