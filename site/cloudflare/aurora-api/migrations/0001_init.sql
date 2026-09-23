-- Aurora backend schema — Cloudflare D1.
-- Apply: npx wrangler d1 migrations apply aurora-db --remote

-- One GitHub account per user row. `id` is the GitHub user id (string).
create table if not exists users (
  id         text primary key,
  github_id  integer not null unique,
  login      text not null,
  name       text,
  email      text,
  avatar_url text,
  created_at integer not null default (unixepoch())
);

-- Opaque bearer sessions bound to a user. Expired rows are pruned on sign-in.
create table if not exists sessions (
  token      text primary key,
  user_id    text not null references users (id) on delete cascade,
  expires_at integer not null,
  created_at integer not null default (unixepoch())
);
create index if not exists idx_sessions_expires on sessions (expires_at);
create index if not exists idx_sessions_user on sessions (user_id);

-- One sync document per user (aurora.json payload with LWW version).
-- `payload` is stored as TEXT (the canonical-JSON serialization of AppConfig).
create table if not exists configs (
  user_key   text primary key references users (id) on delete cascade,
  version    text not null,
  payload    text not null,
  updated_at text not null
);
create index if not exists idx_configs_updated on configs (updated_at);

-- Cache for the GitHub Releases proxy. One row per release family, keyed by
-- `app_release` or `lsp_release`. `packages` is a TEXT-encoded JSON array of
-- { name, arch, url }. Mirrored installers live in R2 (`aurora` bucket);
-- `download_url` points at the R2 custom-domain permalink (app) or the GitHub
-- manifest URL (LSP).
create table if not exists release_cache (
  key         text primary key check (key in ('app_release', 'lsp_release')),
  version     text,
  url         text,
  download_url text,
  notes       text,
  published_at text,
  packages    text,
  mirrored_at text,
  fetched_at  integer not null
);