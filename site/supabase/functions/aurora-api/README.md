# aurora-api

Supabase Edge Function (Deno + Hono) backing the Aurora desktop app. The app
holds only an opaque session token + the function's public base URL; all
Supabase keys are server-side secrets here.

## Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| `POST` | `/v1/auth/password` | — | `{ email, password }` → `{ token, email }` |
| `POST` | `/v1/auth/start-oauth` | — | `{ provider, redirect_uri, code_challenge, … }` → `{ authorizeUrl }` |
| `POST` | `/v1/auth/oauth-exchange` | — | `{ code, code_verifier, redirect_uri }` → `{ token, email }` |
| `POST` | `/v1/auth/logout` | Bearer | revokes the session |
| `GET` | `/v1/auth/me` | Bearer | `{ email }` |
| `GET` | `/v1/sync` | Bearer | `{ version, updatedAt, payload }` or `404` |
| `POST` | `/v1/sync` | Bearer | CAS push `{ payload, version, base_version }` → `200` / `409` (conflict carries current doc) |
| `GET` | `/v1/update/latest` | — | **App update check** → `app_release` row (GitHub, cached ~3 h) |
| `GET` | `/v1/update/lsp` | — | **LSP update check** → `lsp_release` row (GitHub, cached ~3 h, `version: null`) |
| `POST` | `/v1/update/store` | Bearer¹ | **CI upload** — re-mirrors latest app release `.exe`/`.msi` into the public `aurora` Storage bucket and refreshes the `app_release` row |

¹ Requires `Authorization: Bearer <AURORA_DEPLOY_TOKEN>` when that secret is set.
Called by `.github/workflows/mirror-store.yml` on `release: published`. The
mirror re-hosts installers as direct (non-redirecting) URLs for the Microsoft
Store; it skips any asset over `AURORA_MAX_ASSET_BYTES` (default 50 MB).

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | yes | Supabase project URL |
| `SUPABASE_SECRET_KEY` | yes | Admin key (bypasses RLS); server-only |
| `SUPABASE_PUBLISHABLE_KEY` | yes | Used for the Auth REST token exchange |
| `AURORA_GITHUB_REPO` | no | `owner/repo` for update checks (endpoint 404s if empty) |
| `AURORA_GITHUB_TOKEN` | no | Lifts GitHub API rate limits |
| `AURORA_DEPLOY_TOKEN` | recommended | Guards `POST /v1/update/store` |
| `AURORA_MAX_ASSET_BYTES` | no | Per-asset size cap for bucket mirroring (default 50 MB) |

## Deploy

```bash
supabase login
supabase link --project-ref <ref>
supabase db push
supabase secrets set SUPABASE_URL=... SUPABASE_SECRET_KEY=... SUPABASE_PUBLISHABLE_KEY=...
supabase secrets set AURORA_GITHUB_REPO=owner/repo
supabase secrets set AURORA_DEPLOY_TOKEN=$(openssl rand -hex 24)
supabase functions deploy aurora-api --no-verify-jwt
```

`--no-verify-jwt` is required: the function implements its own auth in code.
