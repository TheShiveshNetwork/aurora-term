// Web → desktop auth handoff helpers.
//
// The web app authenticates the user with Supabase directly, then hands the
// resulting session tokens to the desktop app via a deep link
// (`aurora://auth/callback#access_token=...&refresh_token=...`). The desktop
// imports them with `supabase.auth.setSession` and syncs settings under RLS.

import { supabase } from "./supabaseClient";
import type { Session } from "@supabase/supabase-js";

const DEEP_LINK = "aurora://auth/callback";

// Supabase may return the auth response either in the query string (PKCE
// authorization-code flow) or in the URL hash (implicit/token flow), depending
// on project/provider configuration. Read both.
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
export function getScheme(): string {
  const scheme = urlParams().get("scheme");
  return scheme ?? DEEP_LINK;
}

export async function startOAuth(provider: "google" | "github"): Promise<string> {
  const scheme = getScheme();
  const redirectTo = `${location.origin}/auth/callback?scheme=${encodeURIComponent(scheme)}`;
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo },
  });
  if (error) throw new Error(error.message);
  if (!data.url) throw new Error("No authorize URL returned");
  return data.url;
}

export async function handleCallback(): Promise<Session | null> {
  const params = urlParams();
  const error = params.get("error");
  if (error) throw new Error(params.get("error_description") ?? error);

  // PKCE authorization-code flow: a `code` in the URL, exchanged for a session.
  const code = params.get("code");
  if (code) {
    const { data, error: exchErr } = await supabase.auth.exchangeCodeForSession(code);
    if (exchErr) throw new Error(exchErr.message);
    return data.session;
  }

  // Implicit/token flow: access + refresh tokens directly in the URL.
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (accessToken && refreshToken) {
    const { data, error: sessErr } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (sessErr) throw new Error(sessErr.message);
    return data.session;
  }

  throw new Error("Missing authorization code");
}

export function handoffToApp(session: {
  access_token: string;
  refresh_token: string;
}): void {
  const scheme = getScheme();
  const base = scheme.split("?")[0];
  const hash = new URLSearchParams({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  }).toString();
  location.href = `${base}#${hash}`;
}
