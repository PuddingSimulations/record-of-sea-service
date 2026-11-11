-- Fix: regenerate_join_code used gen_random_bytes, which Supabase keeps in another schema. Use the built-in uuid generator instead.
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
