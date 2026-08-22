# app/ — Aurora desktop frontend

The desktop (Tauri) frontend. See the repo root `README.md` for overall architecture.

## Environment & auth configuration

Authentication against the web companion is configured in
[`configs/appConfig.ts`](configs/appConfig.ts):

| Variable | Used by | Default (production) | Dev override |
|---|---|---|---|
| `VITE_WEB_AUTH_URL` | `WEB_AUTH_URL` | `https://aurora.shitworks.co/signin` | only when running in dev (`NODE_ENV=development`, i.e. `vite dev`) |

The production value is hard-coded as the default, so packaged builds always
point at the production domain. The previous `localhost` test value has been
removed on purpose.

### How the dev override is gated

The override is controlled by `import.meta.env.DEV`, which **Vite statically
replaces at build time**. A packaged/production build (`vite build`) always
compiles `DEV` to `false`, so even if `NODE_ENV=development` happens to be set in
the environment, it **cannot** leak the localhost URL into the shipped app. The
only ways to use a non-production auth URL are:

- running `vite dev` (the normal dev workflow), or
- explicitly running `vite build --mode development` (not the normal packaging flow).

### Local development against a local web companion

Set the following in `app/.env.local` (or export it in your shell) before
running `pnpm tauri dev`:

```bash
VITE_WEB_AUTH_URL=http://localhost:5175/signin
```

Without it, a dev build still uses the production `aurora.shitworks.co/signin`
endpoint.
