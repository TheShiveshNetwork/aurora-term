# ADR 0009: Prebuild LSP bundles in a separate repo instead of runtime acquisition

- Status: accepted
- Date: 2026-08-19

## Context

Aurora ships built-in LSP support (formatting, diagnostics, completions,
go-to-definition, and other language features) for 32 languages out of the box,
with the registry designed to be extended over time. The decision is about *how*
those language-server binaries reach the user's machine. The previous approach
resolved each server live, on the user's machine, branching by upstream ecosystem:
`npm install` (on Windows launched via a fragile `.cmd` shim), `go install`,
`gem install`, and guessing GitHub release asset names with `{target}`
placeholders. That requires the host to have `node`/`npm`/`go`/`gem` on `PATH`
plus live network egress to npm/GitHub/Go proxy/RubyGems — assumptions that hold
in a developer shell but not in a packaged release executable launched from an
installer with a default `PATH`. Hence the built-in LSPs worked in dev and
silently failed in release.

## Decision

Move all bundle building out of the app and into an in-repo `aurora-lsp-bundles/`
directory whose CI builds each of the ~32 languages once per platform, hosts the
resulting tarballs (plus `manifest.json`) in a **single rolling GitHub release**
(tag `lsp-bundles`, recreated each publish so URLs stay stable and no releases
accumulate), and serves a `manifest.json` (`language_id` → version →
per-platform `url` + `sha256`, `entry_kind` of `node` | `native`,
`entry_relative`, `args`).

`aurora-lsp-fetch` now has ONE uniform acquisition path: fetch the manifest
(ETag-revalidated, cached locally) → compare cached version → download the
tarball → verify its sha256 → extract → finalize (strip Windows Mark-of-the-Web /
macOS quarantine, set unix exec bit). Node-based bundles run via a lazily fetched
portable Node runtime (downloaded once, cached), never via `npm`/`npx`. The old
`InstallMethod` enum and `REGISTRY`/`spec_for`/`ResolvedExec` API are removed;
that branching lives only in the bundles repo's `build.mjs`.

Host-toolchain languages that need their own runtime (`swift`→sourcekit-lsp,
`scala`→metals, `r`→R, `ruby`→ruby-lsp) are intentionally **not bundled** — they
resolve from the user's `PATH` at runtime.

## Consequences

- Release builds no longer depend on the host's `PATH`, `npm`, `go`, `gem`, or
  live network access to npm/GitHub/Go proxy/RubyGems to start an LSP. This fixes
  the dev-works-in-release regression and removes the Windows npm-shim spawn bug.
- Bundle updates ship independently of app releases: a bump in the bundles repo
  is picked up on the app's next manifest revalidation. A bad bundle simply isn't
  merged (CI is a required check on the version-bump PR); already-cached users
  are unaffected.
- A weekly bot opens one reviewed PR per language version bump, mirroring the
  Homebrew-formula / mason.nvim model.
- New dependency surface in `aurora-lsp-fetch`: `sha2` + `hex` for verification,
  `libc` (macOS quarantine strip). The bundles repo needs its own CI (Node + Go).
- `ruby-lsp` is `RequireOnPath` rather than a bundle, since it is a Ruby script
  needing a `ruby` interpreter the `node`/`native` runtime model cannot supply.
- `aurora-lsp` (process lifecycle) is unchanged: it still receives a resolved
  `program` + `args` + `runtime` and applies memory caps as before.
