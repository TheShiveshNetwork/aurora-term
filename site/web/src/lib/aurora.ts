// Aurora web → desktop auth handoff helpers.
// The web never holds Supabase keys; it only talks to the aurora-api edge
// function, which mints the opaque session token the desktop app stores.

export const AURORA_API_URL =
  (import.meta.env.VITE_AURORA_API_URL as string | undefined)?.replace(/\/+$/, "") ??
  "http://127.0.0.1:54321/functions/v1/aurora-api";

const DEEP_LINK = "aurora://auth/callback";

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}

export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

export async function startOAuth(provider: "google" | "github"): Promise<string> {
  const verifier = randomVerifier();
  const challenge = await codeChallenge(verifier);
  sessionStorage.setItem("aurora_oauth_verifier", verifier);

  const redirectUri = `${location.origin}/auth/callback`;
  const res = await fetch(`${AURORA_API_URL}/v1/auth/start-oauth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, redirect_uri: redirectUri, code_challenge: challenge }),
  });
  if (!res.ok) throw new Error("Failed to start sign-in");
  const data = await res.json();
  return data.authorizeUrl as string;
}

export async function exchangeOAuth(code: string): Promise<string> {
  const verifier = sessionStorage.getItem("aurora_oauth_verifier") ?? "";
  const redirectUri = `${location.origin}/auth/callback`;
  const res = await fetch(`${AURORA_API_URL}/v1/auth/oauth-exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: redirectUri }),
  });
  if (!res.ok) throw new Error("Sign-in exchange failed");
  const data = await res.json();
  return data.token as string;
}

export function handoffToApp(token: string): void {
  const scheme = new URLSearchParams(location.search).get("scheme") ?? DEEP_LINK;
  const base = scheme.split("?")[0];
  location.href = `${base}?token=${encodeURIComponent(token)}`;
}
