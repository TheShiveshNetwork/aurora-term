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
| `GET` | `/v1/update/latest` | — | Proxies GitHub Releases, cached ~30 min → `{ version, url, notes, publishedAt }` |

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
