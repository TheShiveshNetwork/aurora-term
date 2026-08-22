# aurora-lsp-bundles

Prebuilt, versioned language-server bundles for [Aurora](https://github.com/aurora-term/aurora-term).

This directory lives **inside** the Aurora app repo (at `aurora-lsp-bundles/`),
built by the app's root `.github/workflows/lsp-bundles-build.yml`. It builds each
language server once, in CI, and hosts the resulting tarballs **plus `manifest.json`**
in a **single rolling GitHub release** (tag `lsp-bundles`) of the app repo. The
release is recreated on every publish so the same stable URLs are reused and no
releases accumulate. The Aurora app's `aurora-lsp-fetch` crate downloads from this
manifest at runtime — it never runs `npm install`, `go install`, `gem install`,
or guesses GitHub asset names on the user's machine.

## How it fits together

```
aurora-lsp-bundles (this repo)
  ├── scripts/registry.mjs   single source of truth: 32 languages → version + ecosystem
  ├── scripts/build.mjs      builds every (language × platform) tarball, writes manifest.json, publishes rolling release
  ├── scripts/check-updates.mjs  weekly bot that opens one version-bump PR per language
  └── manifest.json          regenerated artifact (also published as a release asset)

aurora (app)
  └── crates/aurora-lsp-fetch   fetch manifest → version check → download → sha256 verify → extract → spawn
```

The app fetches `manifest.json` from the rolling release
(`.../releases/download/lsp-bundles/manifest.json`; override with the
`AURORA_LSP_BUNDLES_MANIFEST` env var for self-hosting). Bundle updates ship
independently of app releases: when a new version lands in the rolling release,
already-cached users keep working and simply pick up the new bundle on next
manifest validation.

## Ecosystems (build-time branching only)

| Source | Handled in `build.mjs` |
|---|---|
| npm (TS, Python, HTML/CSS/JSON, YAML, Bash, Vue, Svelte, PHP, GraphQL, Dockerfile) | `npm install --prefix` of the pinned package (+ `typescript` alongside `typescript-language-server`); entry read from the installed package's own `bin` field |
| GitHub release (rust-analyzer, clangd, jdtls, OmniSharp, marksman, lua-language-server, kotlin, taplo, zls, terraform-ls, elixir-ls, haskell-language-server, clojure-lsp, nil) | download the pinned upstream asset per platform, re-host |
| `go install` (gopls, sqls) | `GOOS`/`GOARCH` `go install` per platform, package the binary |
| Host toolchain (swift→sourcekit-lsp, scala→metals, r→R, ruby→ruby-lsp) | **not bundled** — resolved from the user's PATH at runtime because they require their own toolchain/Ruby interpreter |

## Local build

```bash
GITHUB_TOKEN=ghp_xxx node scripts/build.mjs        # writes manifest.json + publishes rolling release
SKIP_UPLOAD=1 node scripts/build.mjs              # build + write manifest only, no upload
node scripts/check-updates.mjs                    # open version-bump PRs
```

## Notes / deviations from a naive "bundle everything" plan

- `ruby-lsp` is **RequireOnPath**, not a bundle: it is a Ruby script and needs a
  `ruby` interpreter, which the app's `node`/`native` runtime model can't supply.
- `java`/`kotlin`/`scala`/`clojure`/`elixir` bundles are `entry_kind: "native"` but
  still need a JVM/BEAM on PATH at runtime; the app applies `JAVA_TOOL_OPTIONS`
  caps for those.
- The committed `manifest.json` carries real `sha256` values for the languages
  built in CI; `build.mjs` regenerates it (and the rolling release) on every run.
