# LSP Bundle Pipeline — Prebuilt, GitHub-Hosted, Auto-Updating (Option B)

Supersedes the "download at runtime via npm/GitHub/go/gem" approach. Instead of `aurora-lsp-fetch` hitting npm/GitHub/Go proxy/RubyGems live on the user's machine, every server (all 32 registry entries, regardless of upstream ecosystem) gets pre-built once in CI, hosted as versioned tarballs **in this repo under `aurora-lsp-bundles/`**, and fetched by a single uniform runtime path. This removes the Windows npm-shim bug, the live-dependency-resolution fragility, and the `{target}` asset-pattern guessing — without bundling anything in the installer.

---

## 1. Architecture at a glance

```
aurora-lsp-bundles/ (in-repo — lives in this app repo, built by root .github/workflows/lsp-bundles-*.yml)
  ├── scripts/registry.mjs     — single source of truth: 32 languages → version + ecosystem
  ├── scripts/build.mjs        — CI builds each language × platform, writes manifest.json, uploads release
  ├── scripts/check-updates.mjs— weekly bot that opens one version-bump PR per language
  └── manifest.json            — published at aurora-lsp-bundles/manifest.json
                                   (language_id → version → per-platform asset URL + sha256)

aurora (this app)
  ├── crates/aurora-lsp        — process lifecycle only (unchanged)
  ├── crates/aurora-lsp-fetch  — acquisition, now ONE code path for all 32 languages:
  │                              fetch manifest → compare cached version → download tarball → verify → extract
  └── frontend activation      — per-language, per-project-root, on file open (unchanged)
```

The key separation this buys you: **bundle building is isolated from app release
tooling.** Pyright bumping a patch version doesn't require touching app code — the
bot opens a PR against `aurora-lsp-bundles/`, CI rebuilds, and `aurora-lsp-fetch`
just notices the manifest changed. The bundles live in this repo (same cadence as
the app) rather than a separate repository.

---

## 2. `aurora-lsp-bundles/` (in-repo)

Lives inside this app repo at `aurora-lsp-bundles/`, built by the root
`.github/workflows/lsp-bundles-build.yml` and bumped by
`.github/workflows/lsp-bundles-check-updates.yml`. Bundles are published as GitHub
Releases of **this** repo (tagged per build), so the app's runtime can fetch them
without a second repository.

### `manifest.json` (published at `aurora-lsp-bundles/manifest.json`, one file, always reflects latest)
```json
{
  "typescript": {
    "version": "5.3.0",
    "entry_kind": "node",
    "platforms": {
      "win-x64":     { "url": ".../typescript-5.3.0-win-x64.tar.gz",     "sha256": "..." },
      "darwin-x64":  { "url": ".../typescript-5.3.0-darwin-x64.tar.gz",  "sha256": "..." },
      "darwin-arm64":{ "url": ".../typescript-5.3.0-darwin-arm64.tar.gz","sha256": "..." },
      "linux-x64":   { "url": ".../typescript-5.3.0-linux-x64.tar.gz",   "sha256": "..." }
    },
    "entry_relative": "server/typescript-language-server.js",
    "args": ["--stdio"]
  },
  "rust": {
    "version": "2026.08.11",
    "entry_kind": "native",
    "platforms": { "win-x64": { "url": "...", "sha256": "..." }, "...": {} },
    "entry_relative": "rust-analyzer.exe",
    "args": []
  }
  // ... one entry per registry language, same shape regardless of upstream source
}
```
`entry_kind: "node"` tells the runtime to invoke via the bundled Node runtime; `"native"` means spawn the binary directly. This is the one field that replaces the old `InstallMethod` enum's branching — CI already resolved everything else.

### CI build matrix (per language, per platform — this is where the old `InstallMethod` distinctions still live, just at build time instead of runtime)

| Source ecosystem | CI step |
|---|---|
| npm (TS, Python, YAML, HTML/CSS/JSON, Bash, Vue, Svelte, PHP, GraphQL, Dockerfile...) | `npm install --prefix build/<lang> <package>@<pinned-version>`, then **read the installed package's own `package.json` `bin` field programmatically** to record the real entry `.js` file (don't hardcode it — it varies per package and can change between versions). For `typescript-language-server` specifically, also install `typescript` alongside it into the same bundle, matching its documented `npm install -g typescript-language-server typescript` pairing. |
| GitHub release (rust-analyzer, clangd, gopls-alt, jdtls, marksman, lua-language-server, taplo, zls, terraform-ls, haskell-language-server, clojure-lsp, nil...) | Download the specific upstream release asset for each target platform at the pinned version, verify against upstream's published checksum if present, re-host as our own asset. We now control exactly which build users get — no more guessing `{target}` naming per platform at runtime. |
| `go install` (gopls, sqls) | Run `go install <module>@<pinned-version>` per `GOOS`/`GOARCH` in the build matrix, package the resulting binary. |
| `gem install` (ruby-lsp) | Run `gem install ruby-lsp -v <pinned-version> --install-dir build/ruby`, package. |
| Requires host toolchain (sourcekit-lsp, metals, R) | Not bundled at all — stays `RequireOnPath` at runtime, no CI step. |

Output of every job: `dist/<language_id>/<platform>/bundle.tar.gz`, plus a manifest-entry fragment merged into the published `manifest.json`.

### Bot-driven update workflow
1. Scheduled Action (weekly) checks each pinned source (npm registry API / GitHub releases API / Go proxy / RubyGems API) against the version currently in `aurora-lsp-bundles/manifest.json`.
2. New version found → bot opens a PR bumping just that one language's pinned version (in `aurora-lsp-bundles/scripts/registry.mjs`), which triggers the CI matrix as a required check (build must succeed before merge).
3. Maintainer reviews, merges.
4. Merge to default branch triggers the publish job: uploads new tarballs as a GitHub Release of this repo, regenerates `aurora-lsp-bundles/manifest.json`.
5. Users' apps pick it up next time `aurora-lsp-fetch` revalidates the manifest — no app update required. A bad bundle just doesn't get merged; already-cached users are unaffected either way.

This is the same shape as Homebrew formula bumps or `mason.nvim`'s registry — one bot PR per version bump, reviewed, low ongoing effort, fully contained in this repo.

---

## 3. Runtime: `aurora-lsp-fetch` (single uniform path now)

```rust
// crates/aurora-lsp-fetch/src/lib.rs
pub async fn ensure_installed(
    language_id: &str,
    cache_dir: &Path,
    node_dir: &Path, // portable Node, lazily fetched once — see §4
) -> Result<ResolvedServer> {
    if let Some(path) = find_on_path(language_id) {
        return Ok(ResolvedServer::native(path));
    }

    let manifest = get_manifest(cache_dir).await?; // cached locally, revalidated periodically (ETag/If-Modified-Since)
    let entry = manifest.get(language_id)
        .ok_or_else(|| AppError::Lsp(format!("no bundle for {language_id}")))?;
    let platform = current_platform(); // "win-x64" | "darwin-arm64" | "linux-x64" | ...
    let asset = entry.platforms.get(platform)
        .ok_or_else(|| AppError::Lsp(format!("{language_id} not available for {platform}")))?;

    let target_dir = cache_dir.join(language_id);
    let local_version_file = target_dir.join(".version");
    if local_version_file.exists() && std::fs::read_to_string(&local_version_file)? == entry.version {
        return resolve_from_cache(&target_dir, entry); // already up to date
    }

    download_verify_extract(&asset.url, &asset.sha256, &target_dir).await?;
    std::fs::write(&local_version_file, &entry.version)?;
    finalize_downloaded_binary(&target_dir.join(&entry.entry_relative))?; // quarantine/exec-bit fixes, §5

    Ok(ResolvedServer {
        kind: entry.entry_kind.clone(), // "node" | "native"
        path: target_dir.join(&entry.entry_relative),
        args: entry.args.clone(),
    })
}
```

One function, one code path, works identically for every one of the 32 languages — the old per-ecosystem branching (`GithubRelease`/`Npm`/`GoInstall`/`Gem`) is gone from the runtime entirely; it only exists in the bundle repo's CI now.

Invocation differs only by `entry_kind`:
```rust
match resolved.kind.as_str() {
    "node" => Command::new(bundled_node_exe(node_dir)).arg(&resolved.path).args(&resolved.args),
    "native" | _ => Command::new(&resolved.path).args(&resolved.args),
};
```

---

## 4. Portable Node runtime — still needed, still lazy, still not in the installer

Any `entry_kind: "node"` bundle needs an interpreter. Same as before: check PATH first, else fetch a portable Node build once (~15–25 MB), cache it, reuse for every node-based language. Not bundled in the installer; not re-fetched per language.

```rust
pub async fn ensure_node_runtime(cache_dir: &Path) -> Result<PathBuf> {
    if let Some(existing) = find_on_path("node") {
        return Ok(existing.parent().unwrap().to_path_buf());
    }
    let node_dir = cache_dir.join("runtime/node");
    if node_dir.join(node_exe_name()).exists() { return Ok(node_dir); }
    download_and_extract_node(target_platform(), &node_dir).await?; // official nodejs.org dist artifact
    Ok(node_dir)
}
```

Because CI already resolved each npm package's real entry file and bundled `node_modules`, the runtime never invokes `npm`/`npx` at all anymore — just `node <entry.js>`. This is what eliminates the Windows npm-shim spawn bug from earlier, not a workaround around it.

---

## 5. Cross-platform post-download fixes (unchanged from before, still required)

Downloaded binaries are still downloaded binaries — OS trust mechanisms don't care that the source is now our own repo instead of npm/GitHub directly.

```rust
pub fn finalize_downloaded_binary(exec_path: &Path) -> Result<()> {
    #[cfg(target_os = "windows")]
    { let _ = std::fs::remove_file(format!("{}:Zone.Identifier", exec_path.display())); }

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
        let mut perms = std::fs::metadata(exec_path)?.permissions();
        perms.set_mode(perms.mode() | 0o111);
        std::fs::set_permissions(exec_path, perms)?;
    }
    Ok(())
}
```

Call at the end of every `ensure_installed` extraction, regardless of `entry_kind`.

---

## 6. Full registry — all 32 languages, uniform at runtime

Every language below now resolves through the single `ensure_installed` path in §3. The "source" column only matters to `aurora-lsp-bundles`' CI, never to the running app.

**Tier 1:** typescript, javascript, python, rust, go, c, cpp, java*, csharp*, html, css, json, yaml, bash
**Tier 2:** markdown, dockerfile, lua, php, ruby, swift†, kotlin*, toml, vue, svelte
**Tier 3:** zig, terraform, graphql, sql, elixir*, haskell, scala†, clojure, nix, r†

`*` = binary is bundled, but still needs a JVM/.NET runtime on the user's PATH to execute (jdtls, OmniSharp, kotlin-language-server, elixir-ls run on BEAM/JVM). `†` = `RequireOnPath` only, not bundled (sourcekit-lsp ships with Swift toolchain, metals via Coursier, R via its own package manager) — CI has nothing to build for these.

---

## 7. Separation of concerns, reaffirmed

- **`aurora-lsp`** — process lifecycle only. Spawn, stdio framing, idle-timeout kill. Keyed by `(language_id, project_root)`, one process per pair, never per file/tab. Unaffected by any of the above — it just receives a resolved path + args from `aurora-lsp-fetch` and runs it.
- **`aurora-lsp-fetch`** — acquisition only. Now a single uniform code path instead of four branching install methods. Depends on `reqwest` + a hasher, nothing else.
- **`aurora-lsp-bundles/`** — in-repo at `aurora-lsp-bundles/`, not a crate. Its only job is CI-building (root `.github/workflows/lsp-bundles-build.yml`) and publishing versioned bundles + the manifest as GitHub Releases of this repo. Bump PRs are bot-opened (`lsp-bundles-check-updates.yml`), human-reviewed, on the app's cadence.

---

## 8. Lazy per-language activation — unchanged, still the trigger point

```ts
async function activateForLanguage(languageId: string, projectRoot: string) {
  if (activeClients.has(languageId)) return activeClients.get(languageId);
  const client = await connectLanguage(languageId, projectRoot); // -> invoke("lsp_ensure_and_start", ...) -> ensure_installed
  activeClients.set(languageId, client);
  return client;
}
```
Called from the same spot `getLanguageExtension`/`getLinterSource` are resolved today. Nothing spawns, downloads, or runs until a file of that language is actually opened; idle-timeout in `aurora-lsp` kills it later if unused.

---

## 9. Testing checklist

- [ ] Fresh Windows/macOS/Linux VMs, nothing preinstalled — confirm bundle download, verify, extract, and spawn succeed for a Tier 1 language on each OS.
- [ ] macOS Gatekeeper default settings — confirm quarantine strip prevents the "unidentified developer" block.
- [ ] Kill network after first successful fetch — confirm cached version still spawns with zero network calls.
- [ ] Corrupt/mismatched sha256 on a test asset — confirm `ensure_installed` rejects it instead of running unverified code.
- [ ] Bot-opened version-bump PR — confirm CI matrix actually fails the PR if a build breaks, before it can merge.
- [ ] Two different projects, same language, different roots open at once — confirm `aurora-lsp` spawns two independent processes (or correctly shares if you intend one per root, not per app) rather than colliding.