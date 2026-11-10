-- Core schema: crew profiles, sea-service entries, companies, membership, sign requests.
-- Row-level security: crew see only their own rows; employers see only crew who joined their company.

create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text,
  created_at timestamptz not null default now()
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  join_code text not null unique default upper(substr(encode(gen_random_bytes(6),'hex'),1,8)),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

-- role: owner/admin manage the company and see crew; crew is a normal member who shares progress.
create table public.company_members (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'crew' check (role in ('owner','admin','crew')),
  joined_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

-- Entries mirror the app's localStorage objects; the app-side id is the client id.
create table public.entries (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  primary key (user_id, id)
);

-- Server-tracked supervisor sign requests (optional alternative to serverless links).
create table public.sign_requests (
  token text primary key default encode(gen_random_bytes(16),'hex'),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_id text not null,
  snapshot jsonb not null,
  status text not null default 'pending' check (status in ('pending','signed','declined','expired')),
  signed jsonb,
  created_at timestamptz not null default now(),
  signed_at timestamptz,
  expires_at timestamptz not null default now() + interval '30 days'
);

alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.entries enable row level security;
alter table public.sign_requests enable row level security;

create or replace function public.is_company_admin(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from company_members where company_id = cid and user_id = auth.uid() and role in ('owner','admin'));
$$;

-- A user may read a crew member's entries only if that member joined a company the user administers.
create or replace function public.can_view_crew(crew uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select crew = auth.uid() or exists (
    select 1 from company_members a join company_members c on a.company_id = c.company_id
    where a.user_id = auth.uid() and a.role in ('owner','admin') and c.user_id = crew);
$$;

create policy profiles_self on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin_read on public.profiles for select using (public.can_view_crew(id));

create policy companies_member_read on public.companies for select
  using (exists (select 1 from company_members m where m.company_id = id and m.user_id = auth.uid()));
create policy companies_create on public.companies for insert with check (created_by = auth.uid());
create policy companies_admin_update on public.companies for update using (public.is_company_admin(id));

create policy members_read on public.company_members for select
  using (user_id = auth.uid() or public.is_company_admin(company_id));
create policy members_leave on public.company_members for delete
  using (user_id = auth.uid() or public.is_company_admin(company_id));
create policy members_admin_manage on public.company_members for update using (public.is_company_admin(company_id));

create policy entries_own on public.entries for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy entries_admin_read on public.entries for select using (public.can_view_crew(user_id) and not deleted);

create policy sign_own on public.sign_requests for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Crew join a company with its code (security definer so they can't enumerate companies).
create or replace function public.join_company(code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  select id into cid from companies where join_code = upper(trim(code));
  if cid is null then raise exception 'Invalid company code'; end if;
  insert into company_members(company_id, user_id, role) values (cid, auth.uid(), 'crew') on conflict do nothing;
  return cid;
end $$;

-- Creating a company makes the creator its owner.
create or replace function public.create_company(cname text) returns public.companies
language plpgsql security definer set search_path = public as $$
declare c companies;
begin
  insert into companies(name, created_by) values (trim(cname), auth.uid()) returning * into c;
  insert into company_members(company_id, user_id, role) values (c.id, auth.uid(), 'owner');
  return c;
end $$;

-- Supervisors have no account: they fetch and answer a request by secret token only.
create or replace function public.get_sign_request(t text) returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object('snapshot', snapshot, 'status', status)
  from sign_requests where token = t and expires_at > now();
$$;
create or replace function public.submit_signature(t text, payload jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update sign_requests set status='signed', signed=payload, signed_at=now()
  where token = t and status='pending' and expires_at > now();
  return found;
end $$;

-- Employer dashboard: per-crew summary rows for companies the caller administers.
create or replace view public.company_crew with (security_invoker = true) as
  select m.company_id, m.user_id, p.full_name, p.phone,
         (select count(*) from entries e where e.user_id = m.user_id and not e.deleted) as entry_count
  from company_members m join profiles p on p.id = m.user_id where m.role = 'crew';

revoke all on function public.join_company, public.create_company from public;
grant execute on function public.join_company, public.create_company to authenticated;
grant execute on function public.get_sign_request, public.submit_signature to anon, authenticated;
