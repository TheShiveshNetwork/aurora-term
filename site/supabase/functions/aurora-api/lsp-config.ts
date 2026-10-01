// LSP bundle storage policy.
//
// To keep the app's installs away from GitHub's rate limits on the rolling
// `lsp-bundles` release, frequently-downloaded bundles are mirrored into the
// Supabase Storage bucket and served from there. The languages below are
// deliberately NOT stored in Supabase — they are large, rarely installed
// bundles that stay on GitHub and are fetched on demand. Edit this list
// directly when a language should start/stop being mirrored to Supabase.
export const LSP_EXCLUDED_FROM_STORAGE = ["csharp", "cpp", "c", "php"];
