-- Aurora backend schema (Supabase / Postgres)
-- Apply via: supabase db push  (or run in the SQL editor)

create table if not exists public.users (
  id uuid primary key,
  email text not null unique,
  created_at timestamptz not null default now()
);

-- Opaque session tokens issued by the edge function.
-- token_hash = sha256(token); the raw token only ever lives on the client.
create table if not exists public.sessions (
  token_hash text primary key,
  user_id uuid not null references public.users (id) on delete cascade,
  email text not null,
  supabase_refresh_token text,
  supabase_access_token text,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- One sync document per user (aurora.json payload with LWW version).
create table if not exists public.configs (
  user_id uuid primary key references public.users (id) on delete cascade,
  version text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

-- Cache for the GitHub Releases proxy.
create table if not exists public.release_cache (
  key text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);

create index if not exists idx_sessions_user on public.sessions (user_id);
create index if not exists idx_configs_updated on public.configs (updated_at desc);
