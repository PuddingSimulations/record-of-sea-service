-- Privacy: employers see a progress summary (name, tickets, signed days), never raw entries or phone numbers.
drop policy if exists entries_admin_read on public.entries;
drop policy if exists profiles_admin_read on public.profiles;
drop view if exists public.company_crew;

create table public.progress_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  snapshot jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.progress_snapshots enable row level security;
create policy snap_own on public.progress_snapshots for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Employer roster: runs with the view owner's rights, but only returns crew of companies the caller administers.
create view public.company_crew as
  select m.company_id, m.user_id, p.full_name, s.snapshot, s.updated_at
  from public.company_members m
  join public.profiles p on p.id = m.user_id
  left join public.progress_snapshots s on s.user_id = m.user_id
  where m.role = 'crew' and public.is_company_admin(m.company_id);
revoke all on public.company_crew from anon;
grant select on public.company_crew to authenticated;

-- Companies a user belongs to, with their role (for the app's "Join your company" card).
create or replace function public.my_companies() returns table(id uuid, name text, role text, join_code text)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, m.role, case when m.role in ('owner','admin') then c.join_code end
  from company_members m join companies c on c.id = m.company_id where m.user_id = auth.uid();
$$;
grant execute on function public.my_companies to authenticated;
