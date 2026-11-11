-- Lets a signed-in user delete their own account and everything attached to it (Apple and Google require this inside the app).
-- Entries, settings, snapshots, sign requests, company memberships and profile are removed by the foreign keys.
-- Companies the user created are deleted too (their crew lose the link, but keep their own records).
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not signed in'; end if;
  delete from public.companies where created_by = uid;
  delete from auth.users where id = uid;
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
