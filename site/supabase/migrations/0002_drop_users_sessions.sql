-- 0002: drop the legacy custom-auth tables (users, sessions) and key
-- configs directly off Supabase Auth (auth.users) instead.
-- Idempotent: safe to re-run and safe alongside the corrected 0001_init.sql.

-- 1. Repoint configs.user_id from public.users -> auth.users
alter table public.configs drop constraint if exists configs_user_id_fkey;
alter table public.configs add constraint configs_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;

-- 2. Drop the unused custom-auth tables (cascade removes their policies/indexes)
drop table if exists public.sessions;
drop table if exists public.users;
