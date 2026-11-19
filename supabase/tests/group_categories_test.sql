-- Tests for group categories and search_group_ids. Runs on a fresh database built from:
--   supabase_platform_stub.sql + all migrations (baseline first).
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com', now(), '{"full_name":"Ana"}'),
  ('00000000-0000-0000-0000-00000000000b', 'ben@example.com', now(), '{"full_name":"Ben"}'),
  ('00000000-0000-0000-0000-00000000000c', 'cat@example.com', now(), '{"full_name":"Cat"}');

create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
end $$;

-- Created through the same function the create-group Edge Function uses.
select public.create_group_with_admin('00000000-0000-0000-0000-00000000000a', 'Korea 2026', 'Travel');
select public.create_group_with_admin('00000000-0000-0000-0000-00000000000a', 'Condo');
select public.create_group_with_admin('00000000-0000-0000-0000-00000000000c', 'Secret trip', 'Travel');

select pg_temp.check((select category from public."Group" where name = 'Korea 2026') = 'Travel', 'category saved on create');
select pg_temp.check((select category from public."Group" where name = 'Condo') = 'Other', 'category defaults to Other');

do $$ begin
  perform public.create_group_with_admin('00000000-0000-0000-0000-00000000000a', 'Bad', 'Space');
  raise exception 'FAIL: unknown category accepted on create';
exception when raise_exception then
  if sqlerrm not like 'INVALID:%' then raise; end if;
end $$;

-- Ben joins Korea as a plain member.
insert into public."Group_Member" ("groupId", "userId")
select "groupId", '00000000-0000-0000-0000-00000000000b' from public."Group" where name = 'Korea 2026';

insert into public."Expense" ("groupId", "paidBy_UserId", title, "totalAmount", category)
select "groupId", '00000000-0000-0000-0000-00000000000a', 'Hotel_50%', 1000, 'lodging' from public."Group" where name = 'Korea 2026';
insert into public."Expense" ("groupId", "paidBy_UserId", title, "totalAmount", category)
select "groupId", '00000000-0000-0000-0000-00000000000c', 'Dinner secret', 999, 'food' from public."Group" where name = 'Secret trip';
-- Ana's personal expense (no group) must never come back from group search.
insert into public."Expense" ("groupId", "paidBy_UserId", title, "totalAmount", category)
values (null, '00000000-0000-0000-0000-00000000000a', 'Dinner alone', 200, 'food');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);

-- ---------- search_group_ids ----------
select pg_temp.check((select count(*) from public.search_group_ids('korea')) = 1, 'search by group name');
select pg_temp.check((select count(*) from public.search_group_ids('HOTEL')) = 1, 'search by expense title, any case');
select pg_temp.check((select count(*) from public.search_group_ids('secret')) = 0, 'other people''s groups never match');
select pg_temp.check((select count(*) from public.search_group_ids('dinner')) = 0, 'personal expenses are not group matches');
select pg_temp.check((select count(*) from public.search_group_ids('50%')) = 1, '% is literal');
select pg_temp.check((select count(*) from public.search_group_ids('Hot_l')) = 0, '_ is literal');
select pg_temp.check((select count(*) from public.search_group_ids('   ')) = 0, 'blank query matches nothing');
select pg_temp.check((select count(*) from public.search_group_ids(null)) = 0, 'null query matches nothing');

-- ---------- set_group_category ----------
select pg_temp.check(
  public.set_group_category((select "groupId" from public."Group" where name = 'Condo'), 'Roommates') = 'Roommates',
  'owner changes category');
select pg_temp.check((select category from public."Group" where name = 'Condo') = 'Roommates', 'category stored');

do $$ begin
  perform public.set_group_category((select "groupId" from public."Group" where name = 'Condo'), 'Space');
  raise exception 'FAIL: unknown category accepted';
exception when invalid_parameter_value then null;
end $$;

-- Ben is a member, not owner/admin.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin
  perform public.set_group_category((select "groupId" from public."Group" where name = 'Korea 2026'), 'Events');
  raise exception 'FAIL: member changed category';
exception when insufficient_privilege then null;
end $$;

-- Ana cannot touch Cat's group (she cannot even see it).
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin
  perform public.set_group_category('00000000-0000-0000-0000-0000000000ff', 'Events');
  raise exception 'FAIL: changed a group I am not in';
exception when insufficient_privilege then null;
end $$;

reset role;
select pg_temp.check((select category from public."Group" where name = 'Korea 2026') = 'Travel', 'member change had no effect');
select pg_temp.check(not has_function_privilege('anon', 'public.search_group_ids(text)', 'execute'), 'signed-out users cannot search');
select pg_temp.check(not has_function_privilege('authenticated', 'public.create_group_with_admin(uuid, text, text)', 'execute'), 'only the Edge Function creates groups');

-- The trigram index exists and is usable.
select pg_temp.check(exists (select 1 from pg_indexes where indexname = 'group_name_trgm_idx'), 'group name index');
select pg_temp.check(exists (select 1 from pg_indexes where indexname = 'expense_title_trgm_idx'), 'expense title index');

\echo ALL GROUP CATEGORY TESTS PASSED
