# site/ — Aurora companion (web + Cloudflare Worker)

This directory is the **web + backend companion** for Aurora. It is intentionally
separate from the Tauri desktop app (`app/`, `tauri/`, `crates/`) and must never
be bundled into the desktop build.

## Packages

| Path | Type | Package | In pnpm workspace? | Notes |
|---|---|---|---|---|
| `site/web` | Node (Vite/React) | `@aurora/site-web` | **yes** | Standalone web app. Its `node_modules` are isolated from `app/` by pnpm. |
| `site/cloudflare/aurora-api` | **Worker** (TypeScript, no framework) | — | **no** | Deployed to Cloudflare. It has its own `wrangler.toml` and dev deps (wrangler, typescript) — nothing shared with the app. |

## Dependency isolation

- `site/web` depends only on its own `package.json`. It imports nothing from
  `app/`, `packages/*`, or Tauri. pnpm gives each workspace package its own
  isolated dependency tree, so versions cannot collide with the desktop app.
- `site/cloudflare/aurora-api` is a **Cloudflare Worker** project. It is
  excluded from the pnpm workspace on purpose. It only uses platform features
  (Fetch, D1, R2) plus Web Platform APIs — no runtime npm deps — and is never
  packaged.

## Never packed into the desktop build

The Tauri build (`tauri/tauri.conf.json`) only bundles:

- `../app/dist` (the desktop frontend)
- `binaries/aurora-agent` (the Rust/TS sidecar)
- `../static/aurora-icon.png`

Nothing under `site/` is referenced, so the web app, its `node_modules`, and the
Cloudflare Worker are **never** included in the installer.

## Commands

```bash
# Web app
pnpm dev:site        # vite dev server on :5175
pnpm build:site      # build site/web -> site/web/dist
pnpm typecheck:site  # tsc --noEmit

# Cloudflare Worker (run from site/cloudflare/aurora-api)
pnpm dev             # wrangler dev (local emulation of D1/R2)
pnpm deploy          # wrangler deploy
pnpm typecheck       # tsc --noEmit
pnpm d1:migrate      # apply D1 migrations to remote
```