-- One row of app settings per user (held tickets, goals, task book choices, checklist, profile, passport options).
-- Private to the user; employers never read this table.
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  constraint settings_size check (length(data::text) < 600000)
);
alter table public.user_settings enable row level security;
create policy settings_own on public.user_settings for all using (user_id = auth.uid()) with check (user_id = auth.uid());
