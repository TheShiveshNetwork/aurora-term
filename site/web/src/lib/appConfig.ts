// Central, app-wide configuration for the web companion (auth) app.
//
// The deployed URL is used to build the OAuth `redirectTo` so the user is sent
// back here after authenticating with GitHub/Google. It defaults to the
// production domain; during local development it falls back to the current
// origin (the Vite dev server, e.g. http://localhost:5175) unless an explicit
// VITE_WEB_URL override is supplied.

const PRODUCTION_WEB_URL = "https://aurora.shitworks.co";
const PRODUCTION_API_URL =
  "https://yybxsggbvuzjzlwlwbtv.supabase.co/functions/v1/aurora-api";

export const WEB_URL = import.meta.env.DEV
  ? (import.meta.env.VITE_WEB_URL as string | undefined) ?? location.origin
  : PRODUCTION_WEB_URL;

export const AURORA_API_URL =
  (import.meta.env.VITE_AURORA_API_URL as string | undefined) ?? PRODUCTION_API_URL;
