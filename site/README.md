# site/ — Aurora companion (web + Supabase)

This directory is the **web + backend companion** for Aurora. It is intentionally
separate from the Tauri desktop app (`app/`, `tauri/`, `crates/`) and must never
be bundled into the desktop build.

## Packages

| Path | Type | Package | In pnpm workspace? | Notes |
|---|---|---|---|---|
| `site/web` | Node (Vite/React) | `@aurora/site-web` | **yes** | Standalone web app. Its `node_modules` are isolated from `app/` by pnpm. |
| `site/supabase` | **Deno** (Edge Function) | — | **no** | Deployed to Supabase. Runtime deps (e.g. `hono`) are pinned via Deno `npm:` import specifiers in the source, resolved by Supabase's Deno runtime — never npm. |

## Dependency isolation

- `site/web` depends only on its own `package.json`. It imports nothing from
  `app/`, `packages/*`, or Tauri. pnpm gives each workspace package its own
  isolated dependency tree, so versions cannot collide with the desktop app.
- `site/supabase` is a **Deno** project. It is excluded from the pnpm workspace
  on purpose. Its runtime dependency (`hono`) is imported via the pinned
  `npm:hono@4` specifier directly in the source and is fetched by Supabase's
  Deno runtime — it never touches `node_modules` and is never packaged.

## Never packed into the desktop build

The Tauri build (`tauri/tauri.conf.json`) only bundles:

- `../app/dist` (the desktop frontend)
- `binaries/aurora-agent` (the Rust/TS sidecar)
- `../static/aurora-icon.png`

Nothing under `site/` is referenced, so the web app, its `node_modules`, and the
Supabase Edge Function are **never** included in the installer.

## Commands

```bash
# Web app
pnpm dev:site        # vite dev server on :5175
pnpm build:site      # build site/web -> site/web/dist
pnpm typecheck:site  # tsc --noEmit

# Supabase (run from site/supabase, or pass --project-ref)
supabase db push                              # apply migrations
supabase secrets set SUPABASE_URL=... SUPABASE_SECRET_KEY=... SUPABASE_PUBLISHABLE_KEY=...
supabase functions deploy aurora-api --no-verify-jwt
```
