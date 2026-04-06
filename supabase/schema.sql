-- Project Finance Tracker — cloud payload (run in Supabase SQL Editor)
-- One JSON document per authenticated user; RLS restricts access to own row.

create table if not exists public.pft_user_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists pft_user_data_updated_at_idx on public.pft_user_data (updated_at desc);

alter table public.pft_user_data enable row level security;

-- Safe to re-run: drop then create (Postgres has no CREATE OR REPLACE for policies)
drop policy if exists "pft_select_own" on public.pft_user_data;
create policy "pft_select_own"
  on public.pft_user_data for select
  using (auth.uid() = user_id);

drop policy if exists "pft_insert_own" on public.pft_user_data;
create policy "pft_insert_own"
  on public.pft_user_data for insert
  with check (auth.uid() = user_id);

drop policy if exists "pft_update_own" on public.pft_user_data;
create policy "pft_update_own"
  on public.pft_user_data for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "pft_delete_own" on public.pft_user_data;
create policy "pft_delete_own"
  on public.pft_user_data for delete
  using (auth.uid() = user_id);
