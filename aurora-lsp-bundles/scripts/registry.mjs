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
 * @property {string} [version]         Optional pin. When omitted the build resolves the latest upstream version.
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
  { id: "typescript", eco: "npm", package: "typescript-language-server", bin: "typescript-language-server", extra: ["typescript@5"], entry_relative: "node_modules/typescript-language-server/lib/cli.mjs", args: ["--stdio"] },
  { id: "javascript", eco: "npm", package: "typescript-language-server", bin: "typescript-language-server", extra: ["typescript@5"], entry_relative: "node_modules/typescript-language-server/lib/cli.mjs", args: ["--stdio"] },
  { id: "python", eco: "npm", package: "pyright", bin: "pyright-langserver", entry_relative: "node_modules/pyright/langserver.index.js", args: ["--stdio"] },
  { id: "html", eco: "npm", package: "vscode-langservers-extracted", bin: "vscode-html-language-server", entry_relative: "node_modules/vscode-langservers-extracted/bin/vscode-html-language-server", args: ["--stdio"] },
  { id: "css", eco: "npm", package: "vscode-langservers-extracted", bin: "vscode-css-language-server", entry_relative: "node_modules/vscode-langservers-extracted/bin/vscode-css-language-server", args: ["--stdio"] },
  { id: "json", eco: "npm", package: "vscode-langservers-extracted", bin: "vscode-json-language-server", entry_relative: "node_modules/vscode-langservers-extracted/bin/vscode-json-language-server", args: ["--stdio"] },
  { id: "yaml", eco: "npm", package: "yaml-language-server", bin: "yaml-language-server", entry_relative: "node_modules/yaml-language-server/bin/yaml-language-server", args: ["--stdio"] },
  { id: "bash", eco: "npm", package: "bash-language-server", bin: "bash-language-server", entry_relative: "node_modules/bash-language-server/out/cli.js", args: ["start"] },
  { id: "dockerfile", eco: "npm", package: "dockerfile-language-server-nodejs", bin: "docker-langserver", entry_relative: "node_modules/dockerfile-language-server-nodejs/bin/docker-langserver", args: ["--stdio"] },
  { id: "php", eco: "npm", package: "intelephense", bin: "intelephense", entry_relative: "node_modules/intelephense/lib/intelephense.js", args: ["--stdio"] },
  { id: "vue", eco: "npm", package: "@vue/language-server", bin: "vue-language-server", entry_relative: "node_modules/@vue/language-server/bin/vue-language-server.js", args: ["--stdio"] },
  { id: "svelte", eco: "npm", package: "svelte-language-server", bin: "svelteserver", entry_relative: "node_modules/svelte-language-server/bin/server.js", args: ["--stdio"] },
  { id: "graphql", eco: "npm", package: "graphql-language-service-cli", bin: "graphql-lsp", entry_relative: "node_modules/graphql-language-service-cli/bin/graphql.js", args: ["server", "--method", "stream"] },

  // ---- github (native) ----
  { id: "rust", eco: "github", repo: "rust-lang/rust-analyzer", asset: "rust-analyzer-{target}", entry_relative: "rust-analyzer", args: [] },
  { id: "c", eco: "github", repo: "clangd/clangd", asset: "clangd-{target}.zip",
    assets: { "win-x64": "clangd-windows-{version}.zip", "linux-x64": "clangd-linux-{version}.zip", "darwin-x64": "clangd-mac-{version}.zip", "darwin-arm64": "clangd-mac-{version}.zip" },
    entry_relative: "clangd", args: [] },
  { id: "cpp", eco: "github", repo: "clangd/clangd", asset: "clangd-{target}.zip",
    assets: { "win-x64": "clangd-windows-{version}.zip", "linux-x64": "clangd-linux-{version}.zip", "darwin-x64": "clangd-mac-{version}.zip", "darwin-arm64": "clangd-mac-{version}.zip" },
    entry_relative: "clangd", args: [] },
  { id: "java", eco: "github", repo: "eclipse-jdtls/eclipse.jdt.ls", asset: "jdt-language-server-{version}.tar.gz", entry_relative: "bin/jdtls", args: [] },
  { id: "csharp", eco: "github", repo: "OmniSharp/omnisharp-roslyn", asset: "omnisharp-{target}.zip",
    assets: { "win-x64": "omnisharp-win-x64-net6.0.zip", "linux-x64": "omnisharp-linux-x64-net6.0.zip", "darwin-x64": "omnisharp-osx-x64-net6.0.zip", "darwin-arm64": "omnisharp-osx-arm64-net6.0.zip" },
    entry_relative: "OmniSharp", args: ["-lsp"] },
  { id: "markdown", eco: "github", repo: "artempyanykh/marksman", asset: "marksman-{os}",
    assets: { "win-x64": "marksman.exe", "linux-x64": "marksman-linux-x64", "darwin-x64": "marksman-macos", "darwin-arm64": "marksman-macos" },
    entry_relative: "marksman", args: ["server"] },
  { id: "lua", eco: "github", repo: "LuaLS/lua-language-server", asset: "lua-language-server-{version}-{target}.tar.gz",
    assets: { "win-x64": "lua-language-server-{version}-win32-x64.zip", "linux-x64": "lua-language-server-{version}-linux-x64.tar.gz", "darwin-x64": "lua-language-server-{version}-darwin-x64.tar.gz", "darwin-arm64": "lua-language-server-{version}-darwin-arm64.tar.gz" },
    entry_relative: "bin/lua-language-server", args: [] },
  { id: "kotlin", eco: "github", repo: "fwcd/kotlin-language-server", asset: "server.zip",
    assets: { "win-x64": "server.zip", "linux-x64": "server.zip", "darwin-x64": "server.zip", "darwin-arm64": "server.zip" },
    entry_relative: "bin/kotlin-language-server", args: [] },
  { id: "toml", eco: "github", repo: "tamasfe/taplo", asset: "taplo-{target}.gz",
    assets: { "win-x64": "taplo-windows-x86_64.gz", "linux-x64": "taplo-linux-x86_64.gz", "darwin-x64": "taplo-darwin-x86_64.gz", "darwin-arm64": "taplo-darwin-aarch64.gz" },
    entry_relative: "taplo", args: ["lsp", "stdio"] },
  { id: "zig", eco: "github", repo: "zigtools/zls", asset: "zls-{target}",
    assets: { "win-x64": "zls-x86_64-windows.zip", "linux-x64": "zls-x86_64-linux.tar.xz", "darwin-x64": "zls-x86_64-macos.tar.xz", "darwin-arm64": "zls-aarch64-macos.tar.xz" },
    entry_relative: "zls", args: [] },
  { id: "terraform", eco: "github", repo: "hashicorp/terraform-ls", asset: "terraform-ls_{version}_{target}.zip", entry_relative: "terraform-ls", args: ["serve"] },
  { id: "elixir", eco: "github", repo: "elixir-lsp/elixir-ls", asset: "elixir-ls.zip",
    assets: { "win-x64": "elixir-ls-v{version}.zip", "linux-x64": "elixir-ls-v{version}.zip", "darwin-x64": "elixir-ls-v{version}.zip", "darwin-arm64": "elixir-ls-v{version}.zip" },
    entry_relative: "language_server.sh", args: [] },
  { id: "haskell", eco: "github", repo: "haskell/haskell-language-server", asset: "haskell-language-server-{target}.tar.gz",
    assets: { "win-x64": "haskell-language-server-{version}-x86_64-mingw64.zip", "linux-x64": "haskell-language-server-{version}-x86_64-linux-unknown.tar.xz", "darwin-x64": "haskell-language-server-{version}-x86_64-apple-darwin.tar.xz", "darwin-arm64": "haskell-language-server-{version}-aarch64-apple-darwin.tar.xz" },
    entry_relative: "haskell-language-server-wrapper", args: ["--lsp"] },
  { id: "clojure", eco: "github", repo: "clojure-lsp/clojure-lsp", asset: "clojure-lsp-native-{target}.zip",
    assets: { "win-x64": "clojure-lsp-native-windows-amd64.zip", "linux-x64": "clojure-lsp-native-linux-amd64.zip", "darwin-x64": "clojure-lsp-native-macos-amd64.zip", "darwin-arm64": "clojure-lsp-native-macos-aarch64.zip" },
    entry_relative: "clojure-lsp", args: [] },
  { id: "nix", eco: "github", repo: "oxalica/nil", asset: "nil-{target}", entry_relative: "nil", args: [] },

  // ---- go (native) ----
  { id: "go", eco: "go", module: "golang.org/x/tools/gopls", entry_relative: "gopls", args: [] },
  { id: "sql", eco: "go", module: "github.com/sqls-server/sqls", entry_relative: "sqls", args: [] },
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
