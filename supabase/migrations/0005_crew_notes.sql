-- Private notes an employer keeps about a crew member (for example "needs 20 more days, due to start Master course in March").
-- Only admins of that company can read or write them; the crew member never sees them.
create table if not exists public.crew_notes (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  note text not null default '',
  updated_at timestamptz not null default now(),
  primary key (company_id, user_id),
  constraint note_size check (length(note) <= 5000)
);
alter table public.crew_notes enable row level security;
create policy notes_admin on public.crew_notes for all
  using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));
