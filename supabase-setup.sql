-- budget-app cloud sync: one JSON blob per user, protected by Row Level Security.
-- Run this once in the Supabase dashboard: SQL Editor -> paste -> Run.

create table if not exists public.budget_state (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- RLS: every user can only read/write their own row.
alter table public.budget_state enable row level security;

drop policy if exists "own row select" on public.budget_state;
create policy "own row select" on public.budget_state
  for select using (auth.uid() = user_id);

drop policy if exists "own row insert" on public.budget_state;
create policy "own row insert" on public.budget_state
  for insert with check (auth.uid() = user_id);

drop policy if exists "own row update" on public.budget_state;
create policy "own row update" on public.budget_state
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
