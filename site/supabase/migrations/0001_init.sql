-- Aurora backend schema (Supabase / Postgres)
-- Apply via: supabase db push  (or run in the SQL editor)

-- One sync document per user (aurora.json payload with LWW version).
-- Keyed directly off Supabase Auth (auth.users); no separate user/session
-- tables — the edge function and clients authenticate with the user's
-- Supabase Auth JWT (auth.uid()).
create table if not exists public.configs (
  user_id uuid primary key references auth.users (id) on delete cascade,
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

create index if not exists idx_configs_updated on public.configs (updated_at desc);

-- ── Row Level Security ──────────────────────────────────────────────────
-- The aurora-api edge function talks to PostgREST with the service-role key,
-- which bypasses RLS entirely. RLS is enabled so that the anon/authenticated
-- keys can never read or write these tables directly. Owner-scoped policies
-- ensure each user can only touch their own row via their Supabase Auth JWT.

alter table public.configs        enable row level security;
alter table public.release_cache enable row level security;

drop policy if exists configs_owner on public.configs;
create policy configs_owner on public.configs
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- release_cache is backend-only: never exposed to anon/authenticated keys.
-- The edge function accesses it via the service-role key (bypasses RLS).
drop policy if exists release_cache_no_public on public.release_cache;
create policy release_cache_no_public on public.release_cache
  for all to anon, authenticated
  using (false) with check (false);
