-- Run against a plain Postgres with a stub of Supabase's auth schema.
create schema auth;
create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.uid', true),'')::uuid $$;
create role anon nologin; create role authenticated nologin;
grant usage on schema public, auth to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
\i supabase/migrations/0001_core.sql
\i supabase/migrations/0002_snapshots.sql
\i supabase/migrations/0003_signing.sql
\i supabase/migrations/0006_licences.sql
\i supabase/migrations/0007_fix_code.sql
\i supabase/migrations/0009_delete_account.sql
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-00000000000b'),('00000000-0000-0000-0000-00000000000c');
insert into profiles(id,full_name) select id,'u'||right(id::text,1) from auth.users;
\set ON_ERROR_STOP on
-- A owns a company; B joins; C stays outside.
set role authenticated; set request.uid='00000000-0000-0000-0000-00000000000a';
select name from create_company('Harbour Cruises') \gset
select join_code from companies \gset
set request.uid='00000000-0000-0000-0000-00000000000b';
select join_company(:'join_code') is not null as b_joined;
insert into entries values ('00000000-0000-0000-0000-00000000000b','e1','{"days":10}');
set request.uid='00000000-0000-0000-0000-00000000000c';
insert into entries values ('00000000-0000-0000-0000-00000000000c','e2','{"days":99}');
select 'C sees (expect 1 own):' as t, count(*) from entries;
select 'C joined bad code:' as t; 
do $$ begin perform join_company('NOPE'); exception when others then raise notice 'bad code rejected ok'; end $$;
set request.uid='00000000-0000-0000-0000-00000000000a';
select 'A (admin) raw entries visible (expect 0):' as t, count(*) from entries;
select 'A crew view rows (expect 1):' as t, count(*) from company_crew;
select 'A sees phone column? (expect error)' ; do $$ begin perform phone from company_crew; exception when others then raise notice 'no phone column ok'; end $$;
set request.uid='00000000-0000-0000-0000-00000000000b';
insert into progress_snapshots values ('00000000-0000-0000-0000-00000000000b','{"ed":12}');
set request.uid='00000000-0000-0000-0000-00000000000a';
select 'A sees snapshot (expect 1):' as t, count(*) from company_crew where snapshot is not null;
set request.uid='00000000-0000-0000-0000-00000000000c';
select 'C (outsider) crew rows (expect 0):' as t, count(*) from company_crew;
set request.uid='00000000-0000-0000-0000-00000000000b';
select 'B sees (expect 1 own):' as t, count(*) from entries;
select 'B cannot see companies members of others:' as t, count(*) from company_members;
do $$ begin insert into entries values ('00000000-0000-0000-0000-00000000000c','x','{}'); raise notice 'FAIL B wrote as C'; exception when others then raise notice 'forged write rejected ok'; end $$;
-- supervisor token flow as anon (0003)
reset role; set request.uid='00000000-0000-0000-0000-00000000000b';
set role authenticated;
insert into sign_requests(user_id,entry_id,snapshot) values ('00000000-0000-0000-0000-00000000000b','e1','{"v":1,"n":"Crew B"}') returning token \gset
set role anon; set request.uid='';
select get_sign_request(:'token') as fetched;
select get_sign_request('deadbeef') is null as unknown_token_null;
select submit_signature(:'token','{"sig":"x"}') as signed_first, submit_signature(:'token','{"sig":"y"}') as signed_again;
select get_sign_request(:'token') as after_sign_no_snapshot;
select count(*) as anon_direct_read from sign_requests;
do $$ begin perform submit_signature('x', ('{"a":"' || repeat('z',250000) || '"}')::jsonb); raise notice 'FAIL oversized accepted'; exception when others then raise notice 'oversized signature rejected ok'; end $$;
-- crew can read the signed row, mark applied, but not rewrite the signature
set role authenticated; set request.uid='00000000-0000-0000-0000-00000000000b';
select count(*) as crew_sees_signed from sign_requests where status='signed' and not applied;
update sign_requests set applied = true where token = :'token';
select count(*) as now_applied from sign_requests where applied;
do $$ begin update sign_requests set signed = '{"forged":1}' where true; raise notice 'FAIL forged signature'; exception when others then raise notice 'forged signature rejected ok'; end $$;
-- admin removes crew from company
set request.uid='00000000-0000-0000-0000-00000000000a';
delete from company_members where user_id='00000000-0000-0000-0000-00000000000b';
select 'A crew view after removing B (expect 0):' as t, count(*) from company_crew;

-- 0006 licences
reset role; set request.uid='';
select 'new company state (expect trial):' as t, public.company_state((select id from companies limit 1));
set role authenticated; set request.uid='00000000-0000-0000-0000-00000000000a';
do $$ begin update companies set paid_until = now() + interval '5 years' where true; raise notice 'FAIL employer extended own licence'; exception when others then raise notice 'employer cannot set paid_until ok'; end $$;
do $$ begin insert into companies(name, created_by, paid_until) values ('Sneaky', '00000000-0000-0000-0000-00000000000a', now() + interval '9 years'); raise notice 'FAIL insert with paid_until'; exception when others then raise notice 'employer cannot insert paid_until ok'; end $$;
select 'admin regenerates code (expect 8 chars):' as t, length(public.regenerate_join_code((select id from companies where name='Harbour Cruises'))) as n;
set request.uid='00000000-0000-0000-0000-00000000000c';
do $$ begin perform public.regenerate_join_code((select id from companies limit 1)); raise notice 'FAIL outsider regenerated'; exception when others then raise notice 'outsider cannot regenerate ok'; end $$;
do $$ begin perform * from public.admin_companies(); raise notice 'FAIL non-admin listed companies'; exception when others then raise notice 'non-admin cannot list ok'; end $$;
reset role; select id as hc from companies where name='Harbour Cruises' \gset
insert into platform_admins values ('00000000-0000-0000-0000-00000000000c');
insert into company_members(company_id, user_id, role) select id, '00000000-0000-0000-0000-00000000000b', 'crew' from companies where name='Harbour Cruises';
set role authenticated; set request.uid='00000000-0000-0000-0000-00000000000c';
select 'platform admin sees companies:' as t, count(*) from public.admin_companies();
select public.admin_set_company(:'hc', now() - interval '1 day', now() - interval '1 day', 'medium', 'invoice 001 unpaid');
set request.uid='00000000-0000-0000-0000-00000000000a';
select 'expired company: crew view rows (expect 0):' as t, count(*) from company_crew;
select 'my_companies state (expect expired):' as t, state from public.my_companies() where name='Harbour Cruises';
set request.uid='00000000-0000-0000-0000-00000000000c';
select public.admin_set_company(:'hc', now() + interval '1 year', null, 'medium', null);
set request.uid='00000000-0000-0000-0000-00000000000a';
select 'paid company: crew view rows (expect 1):' as t, count(*) from company_crew;
select 'my_companies state (expect active):' as t, state from public.my_companies() where name='Harbour Cruises';

-- 0009 delete account: C owns no company; A owns Harbour Cruises with crew B. Deleting A removes A's data and company, B survives.
reset role; set request.uid='';
insert into entries values ('00000000-0000-0000-0000-00000000000a','ea','{}');
insert into progress_snapshots values ('00000000-0000-0000-0000-00000000000a','{}');
set role authenticated; set request.uid='00000000-0000-0000-0000-00000000000a';
select public.delete_my_account();
reset role;
select 'A user rows left (expect 0):' as t, count(*) from auth.users where id='00000000-0000-0000-0000-00000000000a';
select 'A entries left (expect 0):' as t, count(*) from entries where user_id='00000000-0000-0000-0000-00000000000a';
select 'A companies left (expect 0):' as t, count(*) from companies where created_by='00000000-0000-0000-0000-00000000000a';
select 'B still exists (expect 1):' as t, count(*) from auth.users where id='00000000-0000-0000-0000-00000000000b';
select 'B entries kept (expect 1):' as t, count(*) from entries where user_id='00000000-0000-0000-0000-00000000000b';
set role anon; do $$ begin perform public.delete_my_account(); raise notice 'FAIL anon deleted'; exception when others then raise notice 'anon cannot delete ok'; end $$;
