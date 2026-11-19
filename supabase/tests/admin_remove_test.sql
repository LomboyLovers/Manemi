-- Tests for remove_group_member with admins. Runs on a fresh database built from:
--   supabase_platform_stub.sql + all migrations (baseline first).
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com', now(), '{"full_name":"Ana"}'),
  ('00000000-0000-0000-0000-00000000000b', 'ben@example.com', now(), '{"full_name":"Ben"}'),
  ('00000000-0000-0000-0000-00000000000c', 'cat@example.com', now(), '{"full_name":"Cat"}'),
  ('00000000-0000-0000-0000-00000000000d', 'dan@example.com', now(), '{"full_name":"Dan"}'),
  ('00000000-0000-0000-0000-00000000000e', 'eve@example.com', now(), '{"full_name":"Eve"}');

create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
end $$;
create function pg_temp.fails(sql text, needle text, label text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'FAIL: % (no error)', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if position(needle in sqlerrm) = 0 then raise exception 'FAIL: % (got "%")', label, sqlerrm; end if;
end $$;

-- Ana owns G. Ben and Eve are admins, Cat and Dan are members. Everyone is settled.
insert into public."Group" ("groupId", name, "createdBy") values
  ('10000000-0000-0000-0000-000000000001', 'Korea 2026', '00000000-0000-0000-0000-00000000000a');
insert into public."Group_Member" ("groupId", "userId", role) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'admin'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000e', 'admin'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', 'member'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000d', 'member')
on conflict do nothing;

set role authenticated;

-- Admin Ben
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.fails($$select public.remove_group_member('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a')$$,
  'owner can''t be removed', 'admin cannot remove the owner');
select pg_temp.fails($$select public.remove_group_member('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000e')$$,
  'Admins can only remove regular members', 'admin cannot remove another admin');
select pg_temp.fails($$select public.remove_group_member('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b')$$,
  'remove yourself', 'admin cannot remove self');
select pg_temp.check((public.remove_group_member('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c')->>'removed')::boolean,
  'admin removes a settled member');

-- Member Dan
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
select pg_temp.fails($$select public.remove_group_member('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b')$$,
  'Only the group owner or an admin', 'members cannot remove anyone');

-- Owner Ana can remove an admin
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select pg_temp.check((public.remove_group_member('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000e')->>'removed')::boolean,
  'owner removes an admin');

reset role;
select pg_temp.check((select count(*) from public."Group_Member" where "groupId" = '10000000-0000-0000-0000-000000000001') = 3,
  'Ana, Ben, Dan remain');
select pg_temp.check((select count(*) from public."Group_Activity" where action = 'member_removed') = 2, 'both removals logged');

-- Archived groups can't change
update public."Group" set "isArchived" = true where "groupId" = '10000000-0000-0000-0000-000000000001';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select pg_temp.fails($$select public.remove_group_member('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000d')$$,
  'Archived groups', 'archived group is frozen');
reset role;

\echo ALL ADMIN REMOVE TESTS PASSED
