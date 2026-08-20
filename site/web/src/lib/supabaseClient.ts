import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ??
  "https://yybxsggbvuzjzlwlwbtv.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ??
  "sb_publishable_RLefJueP40i_3FjO_D_7zw_fBYcAoDb";

// The web app authenticates users directly with Supabase (publishable key
// only — safe in the browser). It never holds the service-role key.
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // We exchange the code manually in AuthCallback so we can hand the
    // resulting session tokens to the desktop app.
    detectSessionInUrl: false,
  },
});

export { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY };
