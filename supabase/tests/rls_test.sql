-- Run against a plain Postgres with a stub of Supabase's auth schema.
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.uid', true),'')::uuid $$;
create role anon nologin; create role authenticated nologin;
grant usage on schema public, auth to anon, authenticated;
\i supabase/migrations/0001_core.sql
\i supabase/migrations/0002_snapshots.sql
\i supabase/migrations/0003_signing.sql
grant all on all tables in schema public to authenticated; grant all on all tables in schema public to anon;
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
