# site/web — Aurora web companion

Standalone web app that handles GitHub OAuth and hands the resulting backend
session back to the desktop app via the `aurora://auth/callback` deep link.
(See `site/README.md` for how this fits with the rest of the repo.)

## Environment & auth configuration

| Variable | Used by | Default (production) | Dev fallback |
|---|---|---|---|
| `VITE_WEB_URL` | `WEB_URL` (OAuth `redirect_uri` origin) | `https://aurora.shitworks.co` | `location.origin` (the Vite dev server, e.g. `http://localhost:5175`); override explicitly with `VITE_WEB_URL` |
| `VITE_AURORA_API_URL` | `AURORA_API_URL` (Worker `/v1/...` base) | `https://api.aurora.shitworks.co` | `http://127.0.0.1:8787` (local `wrangler dev`) |

In production `WEB_URL` is the fixed production domain, so the OAuth
`redirect_uri` always points back to `https://aurora.shitworks.co/auth/callback`.
In development it resolves to the running dev server so local sign-in works.

The dev fallback is gated by `import.meta.env.DEV` (Vite dev mode /
`NODE_ENV=development`), which is statically replaced at build time — a
production build always uses the production domain.

### Required GitHub OAuth App configuration

The web code only *builds* the redirect URL. The OAuth App registered for the
Aurora Worker must accept it:

- **Callback URL** → `https://aurora.shitworks.co/auth/callback`
  (and `http://localhost:5175/auth/callback` for local dev).
- The desktop Rust client additionally uses the loopback callback
  `http://127.0.0.1/oauth/callback`.

### Sign-in flow

1. `SignInPage` calls the Worker's `/v1/auth/start-oauth` with a PKCE challenge
   and the plain callback URL as `redirect_uri`.
2. GitHub authorizes and returns `?code=...&state=...` to `AuthCallbackPage`.
3. The page exchanges the code at `/v1/auth/oauth-exchange` for a scoped
   session token and redirects the desktop app via `aurora://auth/callback#token=...`.

The desktop's deep-link scheme travels through sessionStorage
(`aurora_oauth_scheme`) so the handoff target survives the GitHub redirect.