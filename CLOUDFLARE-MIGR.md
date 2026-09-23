# Aurora → Cloudflare Migration Plan (`CLOUDFLARE-MIGR.md`)

Abstract migration plan for replacing the web/back-end companion of Aurora.
This document deliberately contains no code or config — it records the rules,
steps, and procedural notes, and points at the authoritative Cloudflare
documentation. The actual implementation lives next to this file (see the
"Working state" section at the bottom).

## Goal

Move all of Aurora's server-side functionality from the old hosted backend to
Cloudflare, keeping the exact same API contract so every existing client (the
web companion, the Tauri desktop app, the release-mirror GitHub Action) remains
a drop-in swap of the API base URL:

- Authentication: GitHub OAuth (PKCE), opaque per-user session tokens.
- Settings sync: per-user config read/write with compare-and-swap on a version.
- Update API: release metadata + permanent installer download URLs.
- Storage: user rows, sessions, sync docs, and release cache in D1; installer
  binaries mirrored to R2; LSP bundles stay on GitHub Releases (too large).

## Architecture rules

- One self-contained Worker (`site/cloudflare/aurora-api`): a plain `fetch`
  router with no runtime dependencies. No framework is required; the surface is
  small. Any dependency would have to be vendored or imported via package
  manager, which this project deliberately avoids.
- D1 holds relational state; R2 holds byte blobs. Nothing else.
- Clients only ever know their own scoped bearer token — no shared credential
  ever reaches an end user. Secrets live in `wrangler secret put`.
- Web)desktop handoff stays a deep link (`aurora://auth/callback`), now carrying
  only the opaque token, never refresh/expiry fields.
- The GitHub `redirect_uri` is always a plain registered callback (no query).
  The desktop deep-link scheme is carried in sessionStorage so the handoff
  target survives the GitHub redirect.

## Design decisions (recorded)

- Hand-rolled GitHub OAuth on the Worker, copying the old flow 1:1, chosen
  because the existing Rust and TypeScript clients already match that contract.
  Alternative auth stacks (Better Auth, Clerk) are valid replacements later;
  they would sit in front of the same D1 tables and the same `/v1/auth/*` verbs.
- Session tokens are opaque 32-byte hex values in D1 (no JWTs); the user's
  identity is always resolved server-side from the token.
- PKCE is generated client-side and forwarded to GitHub by the Worker; state is
  HMAC-signed so redirect_uri and code_challenge are reused exactly once.
- `POST /v1/sync` is compare-and-swap: the client sends the content hash of the
  config it is based on; a newer remote version returns 409 and the client
  re-reads and retries. This matches the manual "Update/Revert" UI.
- Installers are re-hosted from GitHub Releases into R2 at versioned, permanent
  paths, served through an R2 custom domain so clients get stable URLs and
  caching behaviors, not r2.dev ephemeral URLs (see R2 docs below).
- LSP bundles intentionally stay GitHub-only; only metadata is cached.

## Provisioning procedure (run once, in order — see docs below)

1. Create the D1 database with the same `database_id` recorded into the Worker's
   `wrangler.toml`, then apply the migration (D1 schema: users, sessions,
   configs, release_cache, oauth_state).
2. Create the R2 bucket, attach a custom domain for the bucket, and set a cache
   rule for the bucket domain (long max-age on `/v{version}/` installer paths).
3. Register a GitHub OAuth App for the Worker (callback URLs: the web callback
   and the desktop loopback for local dev/desktop flow). Registering is a GitHub
   step — see GitHub's OAuth app docs.
4. Set Worker secrets (`wrangler secret put`) for every value that must not be
   readable in repository files: GitHub client id/secret, the release-store
   deployment token, an optional higher-rate-limit GitHub token. Non-secret
   tunables (asset size cap, cache TTL, bucket public URL, CORS allowlist) are
   plain vars.
5. Publish DNS for the API hostname (Worker custom domain) and the R2 bucket
   hostname (bucket custom domain), plus the web callback (already exists for
   the web app).
6. Update the release-mirror GitHub Action to the new API hostname and secrets.
   GitHub Actions continues to be the trigger that copies release assets into R2
   (its S3-compatible storage endpoint is an acceptable alternative; see the R2
   docs). No paid plan is required on the GitHub side for this path.
7. Delete the old backend project and its local metadata once all the above is
   live and verified.

## Go-live verification procedure

- Sign in from the web companion in production, confirm the deep-link handoff
  lands on a fresh desktop install that has never run (tests the NSIS / OS
  scheme registration).
- Publish a fake app release and confirm the workflow mirrors it into R2, that
  `GET /v1/update/latest` returns the R2 `download_url`, and that the desktop
  update prompt points at it.
- Sync settings from two machines with the same account: change one, upload,
  change the other, verify the 409 + refetch path surfaces and resolves instead
  of silently clobbering.
- Grep the whole repository (including built bundles) for the old provider's
  names, project ref, and old key formats — none may remain. Neither the app nor
  the web bundle may contain the old SDK.

## Maintenance rules

- Schema changes go through D1 migrations applied with `wrangler d1 migrations
  apply`; keep `<db>/migrations` the single source of truth and never edit D1 by
  hand.
- Do not deploy SDK-bottled logic; the Worker is small and auditable by design.
- Rotate the deployment token and the GitHub client secret on a schedule; the
  OAuth client secret is the root credential (access-token exchange).
- Cost model: D1 and R2 bill on usage; installers are the main egress driver.
  Review R2 pricing before large mirror refreshes.

## Authoritative references (fetch these)

- Workers: get started and the TypeScript/wrangler workflow:
  https://developers.cloudflare.com/workers/get-started/guide/
  https://developers.cloudflare.com/workers/languages/typescript/
- D1: schema/migration workflow and the Worker binding API:
  https://developers.cloudflare.com/d1/
  https://developers.cloudflare.com/d1/worker-api/
- R2: buckets, custom domains for public reads, binding usage from Workers, and
  pricing:
  https://developers.cloudflare.com/r2/buckets/public-buckets/
  https://developers.cloudflare.com/r2/api/workers/workers-api-usage/
  https://developers.cloudflare.com/r2/pricing/
- GitHub OAuth: authorization with PKCE and loopback redirects:
  https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps

## Working state (implementation in this repo)

- Backend: `site/cloudflare/aurora-api` (Worker, D1 migration, wrangler/ts
  scaffolding) implements the full `/v1/*` surface; type-checks clean.
- Web: `site/web` authenticates via the Worker with PKCE and hands the session
  to the desktop by deep link; all old SDK references removed.
- Desktop: `app` and the Rust crates talk to the Worker; the previous direct
  cloud calls were replaced; default API URL points at the new hostname.
- Cleanup: old backend directory, lockfile entries, configs, MCP entry, agent
  skills, docs, and CI workflow all updated; the repositories grep clean and
  neither production bundle contains remnants.
- Remaining manual steps for the owner: the Cloudflare account provisioning in
  the "Provisioning procedure" section (D1/R2/DNS/GitHub App/secrets), then the
  verification procedure.