// Web → desktop auth handoff helpers.
//
// The web app authenticates the user through the Aurora backend (a Cloudflare
// Worker) using GitHub OAuth, then hands the resulting session token to the
// desktop app via a deep link (`aurora://auth/callback#token=...`). The desktop
// stores it locally and syncs settings under the same bearer token. Only the
// token transport differs from the account flow both clients used before.

import { WEB_URL } from "./appConfig";

const DEEP_LINK = "aurora://auth/callback";

// The hostname of the Aurora API Worker (/v1/...). The desktop app reads the
// same value for its own client.
export const AURORA_API_URL =
  (import.meta.env.VITE_AURORA_API_URL as string | undefined) ??
  "https://api.aurora.shitworks.co";

// The GitHub OAuth callback always lands in the query string; keep reading
// both search and hash for safety.
function urlParams(): URLSearchParams {
  const merged = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  for (const [k, v] of hash.entries()) {
    if (!merged.has(k)) merged.set(k, v);
  }
  return merged;
}

// The desktop passes its deep-link scheme through `?scheme=` (or `#scheme=`)
// so the handoff targets the right app (defaults to the canonical aurora://).
// We also remember it in sessionStorage (survives the GitHub redirect) because
// the OAuth `redirect_uri` itself must stay a plain callback URL.
export function getScheme(): string {
  const fromUrl = urlParams().get("scheme");
  if (fromUrl) return fromUrl;
  const stored = sessionStorage.getItem("aurora_oauth_scheme");
  return stored ?? DEEP_LINK;
}

export type AuthResult = {
  token: string;
  email: string;
  username: string;
};

// ── PKCE (Proof Key for Code Exchange) ───────────────────────────────────
// The backend forwards the challenge to GitHub and the verifier is exchanged
// for the code, binding the OAuth code to this browser session.

function base64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(buf);
}

function randomBytes(n: number): Uint8Array {
  const arr = new Uint8Array(n);
  crypto.getRandomValues(arr);
  return arr;
}

async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64Url(randomBytes(48));
  const challenge = base64Url(await sha256Hex(new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${AURORA_API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export async function startOAuth(provider: "github"): Promise<string> {
  const scheme = getScheme();
  sessionStorage.setItem("aurora_oauth_scheme", scheme);
  // Keep `redirect_uri` a plain registered callback — GitHub matches it
  // against the OAuth App's configured callback URLs verbatim.
  const redirectUri = `${WEB_URL}/auth/callback`;
  const { verifier, challenge } = await generatePkce();
  sessionStorage.setItem("aurora_oauth_verifier", verifier);
  sessionStorage.setItem("aurora_oauth_redirect_uri", redirectUri);

  const { authorize_url } = await apiPost<{ authorize_url: string }>(
    "/v1/auth/start-oauth",
    {
      provider,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
    },
  );
  return authorize_url;
}

export async function handleCallback(): Promise<AuthResult> {
  const params = urlParams();
  const error = params.get("error");
  if (error) throw new Error(params.get("error_description") ?? error);

  // GitHub OAuth authorization-code flow: `/auth/callback?code=...&state=...`.
  const code = params.get("code");
  if (!code) throw new Error("Missing authorization code");

  const verifier = sessionStorage.getItem("aurora_oauth_verifier") ?? "";
  const redirectUri =
    sessionStorage.getItem("aurora_oauth_redirect_uri") ?? `${WEB_URL}/auth/callback`;

  const result = await apiPost<AuthResult>("/v1/auth/oauth-exchange", {
    code,
    state: params.get("state"),
    code_verifier: verifier,
    redirect_uri: redirectUri,
  });
  sessionStorage.removeItem("aurora_oauth_verifier");
  sessionStorage.removeItem("aurora_oauth_redirect_uri");
  return result;
}

export function handoffToApp(session: AuthResult): void {
  const scheme = getScheme();
  const base = scheme.split("?")[0];
  const hash = new URLSearchParams({
    token: session.token,
    email: session.email,
    username: session.username,
  }).toString();
  location.href = `${base}#${hash}`;
}