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
| `POST` | `/v1/update/store?repo=<owner>/<repo>&tag=<tag>` | Bearer¹ | **CI upload** — mirrors one app release's installers into the public `aurora` Storage bucket and refreshes the `app_release` row |

¹ Requires `Authorization: Bearer <AURORA_DEPLOY_TOKEN>` when that secret is set.
Called by `.github/workflows/mirror-store.yml`, which `release.yml` dispatches after all platform builds finish. The `repo` and `tag` parameters are optional; without them the function mirrors the newest release found through `AURORA_GITHUB_REPO`. An invalid target returns `400`; a missing release returns `404`.

## App installer packages

`packages` on the `app_release` row lists every installer the release workflow
publishes (`.exe`, `.msi`, `.dmg`, `.app.tar.gz`, `.AppImage`, `.deb`, `.rpm`),
each with its `name`, `arch`, byte `size`, and a `url` that always works:

- the Supabase object when the asset was mirrored, or
- the GitHub asset URL when the asset exceeded `AURORA_MAX_ASSET_BYTES`
  (default 50 MiB) or its upload failed.

At that cap everything mirrors except `Aurora_<version>_amd64.AppImage`
(~122 MiB), which stays on GitHub. Raise `AURORA_MAX_ASSET_BYTES` to lift the
cap, but Supabase's own per-object ceiling applies on top of it.

`download_url` is different: it is the primary Windows installer and is always
the direct Supabase bucket link, never a GitHub URL. That is what the desktop
updater follows, so it must stay redirect-free.

## LSP bundle storage

Supabase Storage only holds the LSP bundles that are downloaded most often.
Mirroring them into the public `aurora` bucket (`lsp-bundles/` path) keeps
repeated installs off GitHub's rate-limited rolling `lsp-bundles` release,
while huge, rarely-used bundles stay on GitHub and are fetched on demand.

Which languages are mirrored is configured in `lsp-config.ts`
(`LSP_EXCLUDED_FROM_STORAGE`) — edit that list to add/remove a language from
the bucket mirror. Excluded-language bundle URLs in the `lsp_release` row point
back at GitHub; on a total mirror failure the row falls back to the full
GitHub package list.

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | yes | Supabase project URL |
| `SUPABASE_SECRET_KEY` | yes | Admin key (bypasses RLS); server-only |
| `SUPABASE_PUBLISHABLE_KEY` | yes | Used for the Auth REST token exchange |
| `AURORA_GITHUB_REPO` | no | `owner/repo` fallback when `/v1/update/store` omits `repo` (update endpoints 404 without either source) |
| `AURORA_GITHUB_TOKEN` | no | Lifts GitHub API rate limits |
| `AURORA_DEPLOY_TOKEN` | recommended | Guards `POST /v1/update/store` |
| `AURORA_MAX_ASSET_BYTES` | no | Per-asset size cap for bucket mirroring (default 50 MiB) |

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

## Verify deployment

Replace `<project-url>` with the Supabase project root, such as
`https://xyzcompany.supabase.co`, and `<version>` with the release version
without its leading `v`. Do not include `/functions/v1/aurora-api` in the
project URL; the workflow appends that path.

```bash
curl -fsS "<project-url>/functions/v1/aurora-api/v1/health"
curl -fsS "<project-url>/functions/v1/aurora-api/v1/update/latest"
```

A healthy deployment returns `{"ok":true}` from health. `update/latest` reports
the mirrored `version`; after a successful store it should match `<version>`.
A `404` there means the latest cached release is unavailable or the function
cannot reach GitHub. `POST /v1/update/store` also requires the bearer token
configured as `AURORA_DEPLOY_TOKEN`.
