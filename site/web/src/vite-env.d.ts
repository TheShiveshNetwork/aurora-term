/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_AURORA_API_URL?: string;
  readonly VITE_WEB_AUTH_URL?: string;
  readonly VITE_WEB_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
