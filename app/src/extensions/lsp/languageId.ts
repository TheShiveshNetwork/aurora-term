// Maps a file path to the LSP `language_id` used by the built-in registry.
// Returns null for file types we don't ship a server for yet.

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rs: "rust",
  go: "go",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  java: "java",
  cs: "csharp",
  html: "html",
  htm: "html",
  css: "css",
  scss: "css",
  sass: "css",
  less: "css",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  md: "markdown",
  mdx: "markdown",
  lua: "lua",
  php: "php",
  rb: "ruby",
  swift: "swift",
  kt: "kotlin",
  kts: "kotlin",
  toml: "toml",
  vue: "vue",
  svelte: "svelte",
  zig: "zig",
  tf: "terraform",
  tfvars: "terraform",
  graphql: "graphql",
  gql: "graphql",
  sql: "sql",
  ex: "elixir",
  exs: "elixir",
  hs: "haskell",
  scala: "scala",
  sc: "scala",
  clj: "clojure",
  nix: "nix",
  r: "r",
  dockerfile: "dockerfile",
};

export function languageIdFromPath(filePath: string): string | null {
  const lower = filePath.toLowerCase();
  const base = lower.split(/[\\/]/).pop() ?? "";
  if (base === "dockerfile" || base.endsWith(".dockerfile")) {
    return "dockerfile";
  }
  const ext = base.includes(".") ? base.split(".").pop()! : "";
  return EXT_TO_LANG[ext] ?? null;
}

// On Windows `C:\a\b.ts` -> `file:///c:/a/b.ts`. Posix `/a/b.ts` -> `file:///a/b.ts`.
// The drive letter is lower-cased on purpose: LSP servers normalize document
// URIs via `vscode-uri` (which lower-cases the drive), so a `publishDiagnostics`
// notification comes back as `file:///c:/...`. Matching that exactly is required
// for `@codemirror/lsp-client` to find the open file and render underlines.
export function pathToUri(filePath: string): string {
  const norm = filePath.replace(/\\/g, "/");
  if (/^[a-zA-Z]:/.test(norm)) {
    return "file:///" + norm.replace(/^([a-zA-Z]):/, (_m, d) => d.toLowerCase() + ":");
  }
  if (norm.startsWith("/")) {
    return "file://" + norm;
  }
  return "file:///" + norm;
}

// Inverse of `pathToUri`. `file:///C:/a/b.ts` -> `C:/a/b.ts`.
// Language servers frequently return percent-encoded URIs (e.g.
// `file:///C%3A/a/b.ts`), so decode before parsing the drive letter.
export function uriToPath(uri: string): string {
  if (!uri.startsWith("file://")) return uri;
  let p: string;
  try {
    p = decodeURIComponent(uri.slice("file://".length));
  } catch {
    p = uri.slice("file://".length);
  }
  if (p.startsWith("/") && /^[a-zA-Z]:/.test(p.slice(1))) {
    return p.slice(1);
  }
  return p;
}
