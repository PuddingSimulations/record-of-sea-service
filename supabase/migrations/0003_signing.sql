-- Server-tracked supervisor sign-off.
-- A signed-in crew member creates a sign_requests row; the supervisor opens sign.html#t=<token> (no account),
-- reads the request and submits one signature. The crew member's app picks it up on its next sync.

alter table public.sign_requests add column if not exists applied boolean not null default false;
alter table public.sign_requests add constraint sign_snapshot_size check (length(snapshot::text) < 20000);

create or replace function public.submit_signature(t text, payload jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if length(payload::text) > 200000 then raise exception 'Signature too large'; end if;
  update sign_requests set status = 'signed', signed = payload, signed_at = now()
  where token = t and status = 'pending' and expires_at > now();
  return found;
end $$;

-- Supervisors can see whether a request is still open, expired or already signed; never anything else.
create or replace function public.get_sign_request(t text) returns jsonb
language sql security definer set search_path = public as $$
  select case when expires_at <= now() then jsonb_build_object('status', 'expired')
              when status = 'signed' then jsonb_build_object('status', 'signed')
              else jsonb_build_object('status', status, 'snapshot', snapshot) end
  from sign_requests where token = t;
$$;
revoke all on function public.submit_signature, public.get_sign_request from public;
grant execute on function public.submit_signature, public.get_sign_request to anon, authenticated;

-- Crew may only update their own request rows (e.g. mark as applied); the signature itself cannot be edited by them.
create or replace function public.sign_requests_guard() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and (new.signed is distinct from old.signed or new.status is distinct from old.status or new.snapshot is distinct from old.snapshot) then
    raise exception 'Signed data cannot be changed';
  end if;
  return new;
end $$;
drop trigger if exists sign_requests_guard on public.sign_requests;
create trigger sign_requests_guard before update on public.sign_requests for each row execute function public.sign_requests_guard();
