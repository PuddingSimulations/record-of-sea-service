-- Licences: every company starts on a trial (changed to 30 days in 0008); after that it needs a "paid until" date.
-- When a company is expired its employer dashboard locks (the roster view returns nothing).
-- Crew keep full use of their own app and records either way.

alter table public.companies add column if not exists trial_ends_at timestamptz not null default (now() + interval '90 days');
alter table public.companies add column if not exists paid_until timestamptz;
alter table public.companies add column if not exists band text not null default 'small' check (band in ('small', 'medium', 'large'));
alter table public.companies add column if not exists note text not null default '';

-- Employers must not be able to extend their own licence: only the name and the creator can be written directly.
revoke insert, update on public.companies from anon, authenticated;
grant insert (name, created_by) on public.companies to authenticated;
grant update (name) on public.companies to authenticated;

create table if not exists public.platform_admins (user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.platform_admins enable row level security;   -- no policies: only the security definer functions below read it

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

create or replace function public.company_state(cid uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when c.paid_until is not null and c.paid_until > now() then 'active'
              when c.trial_ends_at > now() then 'trial' else 'expired' end
  from companies c where c.id = cid;
$$;

-- Roster view: crew of companies the caller administers, and only while the licence is live.
create or replace view public.company_crew as
  select m.company_id, m.user_id, p.full_name, s.snapshot, s.updated_at
  from public.company_members m
  join public.profiles p on p.id = m.user_id
  left join public.progress_snapshots s on s.user_id = m.user_id
  where m.role = 'crew' and public.is_company_admin(m.company_id) and public.company_state(m.company_id) <> 'expired';

drop function if exists public.my_companies();
create or replace function public.my_companies()
returns table(id uuid, name text, role text, join_code text, state text, trial_ends_at timestamptz, paid_until timestamptz, crew_count bigint)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, m.role,
         case when m.role in ('owner', 'admin') then c.join_code end,
         public.company_state(c.id),
         case when m.role in ('owner', 'admin') then c.trial_ends_at end,
         case when m.role in ('owner', 'admin') then c.paid_until end,
         case when m.role in ('owner', 'admin') then (select count(*) from company_members x where x.company_id = c.id and x.role = 'crew') end
  from company_members m join companies c on c.id = m.company_id where m.user_id = auth.uid();
$$;
grant execute on function public.my_companies to authenticated;

-- A manager can replace the company code (for example if it was shared too widely).
create or replace function public.regenerate_join_code(cid uuid) returns text
language plpgsql security definer set search_path = public as $$
declare n text;
begin
  if not public.is_company_admin(cid) then raise exception 'Not allowed'; end if;
  n := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  update companies set join_code = n where id = cid;
  return n;
end $$;
grant execute on function public.regenerate_join_code to authenticated;

-- Platform admin (you): list every company and set licence dates.
create or replace function public.admin_companies()
returns table(id uuid, name text, band text, note text, join_code text, state text, trial_ends_at timestamptz, paid_until timestamptz, crew_count bigint, created_at timestamptz, owner_email text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed'; end if;
  return query
    select c.id, c.name, c.band, c.note, c.join_code, public.company_state(c.id), c.trial_ends_at, c.paid_until,
           (select count(*) from company_members x where x.company_id = c.id and x.role = 'crew'), c.created_at,
           (select u.email::text from auth.users u where u.id = c.created_by)
    from companies c order by c.created_at desc;
end $$;
grant execute on function public.admin_companies to authenticated;

create or replace function public.admin_set_company(cid uuid, p_paid_until timestamptz, p_trial_ends timestamptz, p_band text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed'; end if;
  update companies set paid_until = p_paid_until, trial_ends_at = coalesce(p_trial_ends, trial_ends_at), band = coalesce(p_band, band), note = coalesce(p_note, note) where id = cid;
end $$;
grant execute on function public.admin_set_company to authenticated;
revoke execute on function public.admin_companies, public.admin_set_company, public.regenerate_join_code from anon, public;
