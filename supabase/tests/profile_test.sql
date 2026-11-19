-- Tests for profile editing (AUTH-05) and the User hardening.
-- Runs on a fresh database: supabase_platform_stub.sql + all migrations.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create function pg_temp.act_as(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p::text, ''), false); $$;
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok: %', label;
end $$;
create function pg_temp.err(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return null;
exception when others then return sqlerrm;
end $$;

-- Sign-ups: registration username first, then full name, then email; always unique.
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'ana@example.com', now(), '{"full_name":"Ana Cruz","username":"ana"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'ana@other.com',   now(), '{"full_name":"Ana Reyes","username":"ANA"}'),
  ('00000000-0000-0000-0000-0000000000a3', 'bo@example.com',  now(), '{"full_name":"Bo Santos"}'),
  ('00000000-0000-0000-0000-0000000000a4', 'cy@example.com',  now(), '{}'),
  ('00000000-0000-0000-0000-0000000000a5', 'x@example.com',   now(), '{}');
select pg_temp.check((select name from public."User" where email = 'ana@example.com') = 'ana', 'sign-up uses the registration username');
select pg_temp.check((select name from public."User" where email = 'ana@other.com') = 'ANA2', 'duplicate username gets a number (case-insensitive)');
select pg_temp.check((select name from public."User" where email = 'bo@example.com') = 'Bo Santos', 'no username: full name');
select pg_temp.check((select name from public."User" where email = 'cy@example.com') = 'cy0', 'short email name padded to 3 characters');

set role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');

-- Username changes
select pg_temp.check((public.update_profile('  Ana   Cruz ') ->> 'name') = 'Ana Cruz', 'rename trims and collapses spaces');
select pg_temp.check(pg_temp.err($$ select public.update_profile('bo santos') $$) like 'CONFLICT:%already taken%', 'taken username (any case) is refused');
select pg_temp.check(pg_temp.err($$ select public.update_profile('ab') $$) like 'INVALID:%at least 3%', 'too short refused');
select pg_temp.check(pg_temp.err($$ select public.update_profile(repeat('a', 31)) $$) like 'INVALID:%up to 30%', 'too long refused');
select pg_temp.check(pg_temp.err($$ select public.update_profile('<script>') $$) like 'INVALID:%letters%', 'symbols refused');
select pg_temp.check(pg_temp.err($$ select public.update_profile('-ana') $$) like 'INVALID:%', 'must start with a letter or number');
select pg_temp.check((public.update_profile('José O''Brien') ->> 'name') = 'José O''Brien', 'accents and apostrophes allowed');
select pg_temp.check((public.update_profile('josé o''brien') ->> 'name') = 'josé o''brien', 'changing only the case of your own name is fine');

-- Photos
select pg_temp.check(
  (public.update_profile(null, 'https://x.supabase.co/storage/v1/object/public/avatars/00000000-0000-0000-0000-0000000000a1/1700000000.webp') ->> 'avatarUrl') like '%0000000000a1/1700000000.webp',
  'own avatar URL accepted');
select pg_temp.check((select name from public."User" where "userId" = '00000000-0000-0000-0000-0000000000a1') = 'josé o''brien', 'null name keeps the username');
select pg_temp.check(pg_temp.err($$ select public.update_profile(null, 'https://x.supabase.co/storage/v1/object/public/avatars/00000000-0000-0000-0000-0000000000a2/p.webp') $$) like 'INVALID:%', 'someone else''s folder refused');
select pg_temp.check(pg_temp.err($$ select public.update_profile(null, 'https://evil.example/tracker.png') $$) like 'INVALID:%', 'outside URL refused');
select pg_temp.check(pg_temp.err($$ select public.update_profile(null, 'https://x.supabase.co/storage/v1/object/public/avatars/00000000-0000-0000-0000-0000000000a1/../a2/p.webp') $$) like 'INVALID:%', 'path tricks refused');
select pg_temp.check((public.update_profile(null, null, true) ->> 'avatarUrl') is null, 'photo removed');

-- Direct writes are closed, except the notification switches
select pg_temp.check(pg_temp.err($$ update public."User" set email = 'boss@example.com' where "userId" = '00000000-0000-0000-0000-0000000000a1' $$) like '%permission denied%', 'email can''t be edited directly');
select pg_temp.check(pg_temp.err($$ update public."User" set name = 'Bo Santos' where "userId" = '00000000-0000-0000-0000-0000000000a1' $$) like '%permission denied%', 'name can''t bypass validation');
select pg_temp.check(pg_temp.err($$ update public."User" set "userCode" = 'U-00001' where "userId" = '00000000-0000-0000-0000-0000000000a1' $$) like '%permission denied%', 'user code can''t be edited');
select pg_temp.check(pg_temp.err($$ delete from public."User" where "userId" = '00000000-0000-0000-0000-0000000000a1' $$) like '%permission denied%', 'can''t delete profiles');
update public."User" set "notifyExpense" = false where "userId" = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.check((select not "notifyExpense" from public."User" where "userId" = '00000000-0000-0000-0000-0000000000a1'), 'notification switches still editable');

-- Avatar storage: only your own folder
select pg_temp.check(pg_temp.err($$ insert into storage.objects (bucket_id, name) values ('avatars', '00000000-0000-0000-0000-0000000000a1/new.webp') $$) is null, 'upload to own folder');
select pg_temp.check(pg_temp.err($$ insert into storage.objects (bucket_id, name) values ('avatars', '00000000-0000-0000-0000-0000000000a2/new.webp') $$) like '%row-level security%', 'upload to someone else''s folder refused');

reset role;
select pg_temp.check((select public from storage.buckets where id = 'avatars'), 'avatars bucket is public to read');
select pg_temp.check(has_function_privilege('anon', 'public.update_profile(text, text, boolean)', 'execute') = false, 'anon can''t call update_profile');
select 'profile tests passed' as result;
