# aurora-api — Supabase Edge Function

Aurora's backend: an Edge Function (Deno + Hono) deployed on Supabase.

The desktop app only holds an **opaque session token** (OS keychain) plus the
function's public base URL. The Supabase service-role key and anon key live
**only** here as server-side environment variables — never in the app bundle.

## Env vars

| Variable | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | yes | Supabase project URL |
| `SUPABASE_SECRET_KEY` | yes | **Secret** key (`sb_secret_…`) — server/admin only, bypasses RLS. Used for all PostgREST writes. |
| `SUPABASE_PUBLISHABLE_KEY` | yes | **Publishable** key (`sb_publishable_…`) — public, RLS-gated. Used only to call Supabase Auth REST (the OAuth code exchange). |
| `AURORA_GITHUB_REPO` | no | `owner/repo` used by `/v1/update/latest`. When empty the endpoint returns 404. |
| `AURORA_GITHUB_TOKEN` | no | Personal access token to lift GitHub API rate limits. |
| `AURORA_DEPLOY_TOKEN` | recommended | Shared secret guarding `POST /v1/update/store`. When set, the endpoint requires `Authorization: Bearer <token>`. Set it (and keep the same value in your CI secret) to stop anonymous abuse of the write path. |

> **Key model:** these are the new Supabase publishable/secret keys (legacy
> `anon`/`service_role` are deprecated). The secret key is the `service_role`
> equivalent and must never be exposed client-side. The publishable key is the
> `anon` equivalent and is safe in the browser, but here it is only used
> server-side for the GoTrue token endpoint. The `--no-verify-jwt` flag is
> required because Edge Functions cannot JWT-verify the new keys.

## Deploy

```bash
supabase login
supabase link --project-ref <ref>
supabase db push            # applies site/supabase/migrations
supabase secrets set AURORA_GITHUB_REPO=owner/repo
supabase secrets set AURORA_DEPLOY_TOKEN=$(openssl rand -hex 24)   # guards POST /v1/update/store
supabase functions deploy aurora-api --no-verify-jwt

# New key model (publishable + secret):
supabase secrets set SUPABASE_URL=https://yybxsggbvuzjzlwlwbtv.supabase.co ^
  SUPABASE_SECRET_KEY=<sb_secret_… from dashboard> ^
  SUPABASE_PUBLISHABLE_KEY=<sb_publishable_… from dashboard>
supabase functions deploy aurora-api --no-verify-jwt
```

`--no-verify-jwt` is required — the function implements its own opaque-token
auth (`/v1/auth/*`, `/v1/sync`) and JWT enforcement is handled in code.

## OAuth redirect allowlist

In the Supabase dashboard (Auth → URL Configuration), allow:
`http://127.0.0.1:*` — the desktop app completes the PKCE flow against a
loopback server on a random port.

## Endpoints

| Method | Path | Auth | Body / Notes |
|---|---|---|---|
| `POST` | `/v1/auth/password` | — | `{ email, password }` → `{ token, email }` |
| `POST` | `/v1/auth/start-oauth` | — | `{ provider, redirect_uri, code_challenge, code_challenge_method, state }` → `{ authorizeUrl }` |
| `POST` | `/v1/auth/oauth-exchange` | — | `{ code, code_verifier, redirect_uri }` → `{ token, email }` |
| `POST` | `/v1/auth/logout` | Bearer | revokes the session |
| `GET` | `/v1/auth/me` | Bearer | `{ email }` |
| `GET` | `/v1/sync` | Bearer | `{ version, updatedAt, payload }` or 404 |
| `POST` | `/v1/sync` | Bearer | CAS push: `{ payload, version, base_version }` → 200 or 409 (conflict carries current doc) |
| `GET` | `/v1/update/latest` | — | Proxies GitHub Releases, cached ~3 h → `{ version, url, notes, publishedAt }` |
| `GET` | `/v1/update/store` | — | Returns the last mirrored Store package URLs → `{ version, packages:[{name,arch,url}], mirroredAt }` |
| `POST` | `/v1/update/store` | — | Re-mirrors the latest app release's `.exe`/`.msi` into the public `aurora` bucket; returns the versioned URLs |

## Microsoft Store binary mirror

GitHub release asset URLs 302-redirect to `objects.githubusercontent.com`, which the
Microsoft Store submission fetcher rejects. This function re-hosts the built binaries
into a **public** Supabase Storage bucket named `aurora`, keyed by version:

```
https://<project-ref>.supabase.co/storage/v1/object/public/aurora/<version>/aurora-setup.exe
```

These URLs are direct (HTTP 200, no redirect), HTTPS, and versioned — i.e. permanent
permalinks. Submit one **Package URL per architecture** (x86 / x64 / arm64); the binary
name is inspected to set `arch` and the right content-type (`application/x-msdownload`
/ `application/x-msi`).

How it triggers:

- **Automatic (best-effort):** when a new app release is detected during a normal update
  check, the function downloads the binaries in the background and stores them. This does
  not block the update response, but the upload may be cut short if the request finishes
  first, so don't rely on it for large installers.
- **Reliable:** call `POST /v1/update/store` after publishing a GitHub release (e.g. from
  CI, or `curl -X POST <base>/v1/update/store`). It re-uses the result if the version is
  unchanged and skips re-downloading.

> **Auth:** set `AURORA_DEPLOY_TOKEN` (Supabase secret) and the endpoint will reject any
> request without `Authorization: Bearer <token>`. The background auto-mirror in
> `resolveLatest` is unaffected (it runs server-side).

```bash
curl -X POST https://<ref>.supabase.co/functions/v1/aurora-api/v1/update/store \
  -H "Authorization: Bearer $AURORA_DEPLOY_TOKEN"
```

> **Automatic (CI):** `.github/workflows/mirror-store.yml` runs on `release: published`
> (skips drafts/prereleases and non-`vX.Y.Z` tags). It polls until the built
> installer assets are present, then calls `POST /v1/update/store`. It does **not**
> touch the bucket if no `.exe`/`.msi` assets exist. Required GitHub repo secrets:
> `SUPABASE_URL` (e.g. `https://<ref>.supabase.co`) and `SUPABASE_FUNCTION_TOKEN`
> (the **same value** as the `AURORA_DEPLOY_TOKEN` Supabase secret). Also ensure
> `AURORA_GITHUB_REPO` is set on the function.

> **Free-plan limit:** Supabase caps any single file at **50 MB** on the Free plan. If your
> installer is larger, the upload fails — upgrade to the **Pro plan** (raises the limit to
> 500 GB) before mirroring. Egress is negligible (the Store pulls the package once at
> submission and re-hosts it).

## Sync semantics

- Each user has one `configs` row storing the `aurora.json` payload.
- Every successful write stores a new opaque `version` (client-generated UUID).
- `POST /v1/sync` performs compare-and-swap: if the stored version differs
  from the client's `base_version`, it responds `409` with the current doc so
  the client can present the 3-way conflict dialog (Keep local / Keep cloud /
  Merge).

## Local testing

```bash
supabase functions serve aurora-api --env-file .env.local
curl http://127.0.0.1:54321/functions/v1/aurora-api/v1/health
```
