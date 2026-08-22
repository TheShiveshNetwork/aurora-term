# site/web — Aurora web companion

Standalone web app that handles GitHub/Google OAuth and hands the resulting
Supabase session back to the desktop app via the `aurora://auth/callback` deep
link. (See `site/README.md` for how this fits with the rest of the repo.)

## Environment & auth configuration

The OAuth redirect target is configured in
[`src/lib/appConfig.ts`](src/lib/appConfig.ts):

| Variable | Used by | Default (production) | Dev fallback |
|---|---|---|---|
| `VITE_WEB_URL` | `WEB_URL` | `https://aurora.shitworks.co` | `location.origin` (the Vite dev server, e.g. `http://localhost:5175`); override explicitly with `VITE_WEB_URL` |

In production `WEB_URL` is the fixed production domain, so the OAuth
`redirectTo` always points back to `https://aurora.shitworks.co/auth/callback`.
In development it resolves to the running dev server so local sign-in works.

The dev fallback is gated by `import.meta.env.DEV` (Vite dev mode /
`NODE_ENV=development`), which is statically replaced at build time — a
production build always uses the production domain.

### Required Supabase dashboard configuration

The code above only *builds* the redirect URL. What actually prevents the
post-OAuth **localhost redirect** is the Supabase project's URL allowlist
(Authentication → URL Configuration):

- **Site URL** → `https://aurora.shitworks.co`
- **Redirect URLs** → add `https://aurora.shitworks.co/auth/callback`
  (and `http://localhost:5175/auth/callback` for local dev).

If the production callback URL is not in Supabase's Redirect URLs allowlist,
Supabase falls back to its Site URL (which defaults to `localhost`). That
mismatch — not the app code — is the usual cause of landing on `localhost`
after signing in.
