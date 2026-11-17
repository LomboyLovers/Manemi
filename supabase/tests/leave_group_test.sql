-- Tests for leave_group + lodging. Runs on a fresh database built from:
--   supabase_platform_stub.sql + all migrations (baseline first).
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com', now(), '{"full_name":"Ana"}'),
  ('00000000-0000-0000-0000-00000000000b', 'ben@example.com', now(), '{"full_name":"Ben"}'),
  ('00000000-0000-0000-0000-00000000000c', 'cat@example.com', now(), '{"full_name":"Cat"}'),
  ('00000000-0000-0000-0000-00000000000d', 'dan@example.com', now(), '{"full_name":"Dan"}');

-- Ana owns the group; Ben, Cat, Dan are members.
select public.create_group_with_admin('00000000-0000-0000-0000-00000000000a', 'Trip');
create temp table g as select "groupId" as id from public."Group" limit 1;
insert into public."Group_Member" ("groupId", "userId")
select id, u from g, unnest(array['00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-00000000000d']::uuid[]) u;

-- Ana paid ₱300 split with Ben (Ben owes Ana 150). Cat and Dan not involved.
select public.create_expense_with_splits('00000000-0000-0000-0000-00000000000a', (select id from g),
  '00000000-0000-0000-0000-00000000000a', 'Dinner', 300, now(), 'lodging',
  null, '[{"userId":"00000000-0000-0000-0000-00000000000a","amount":150},{"userId":"00000000-0000-0000-0000-00000000000b","amount":150}]');
-- Cat paid ₱100 split with Dan; Dan paid Cat back ₱50 (settled).
select public.create_expense_with_splits('00000000-0000-0000-0000-00000000000c', (select id from g),
  '00000000-0000-0000-0000-00000000000c', 'Taxi', 100, now(), 'transport',
  null, '[{"userId":"00000000-0000-0000-0000-00000000000c","amount":50},{"userId":"00000000-0000-0000-0000-00000000000d","amount":50}]');
insert into public."Settlement" ("groupId", "payerId", "receiverId", amount)
select id, '00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000c', 50 from g;

create function pg_temp.act_as(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p::text, ''), false); $$;
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if; raise notice 'pass: %', label; end $$;
create function pg_temp.fails(stmt text, pattern text, label text) returns void language plpgsql as $$
begin
  execute stmt; raise exception 'FAIL (no error): %', label;
exception when others then
  if sqlerrm like 'FAIL (no error)%' then raise; end if;
  if sqlerrm !~* pattern then raise exception 'FAIL: % (got: %)', label, sqlerrm; end if;
  raise notice 'pass: %', label;
end $$;
grant execute on all functions in schema pg_temp to anon, authenticated;
grant select on g to authenticated, anon;
set client_min_messages = notice;

select pg_temp.check((select category::text from public."Expense" where title = 'Dinner') = 'lodging', 'lodging category can be saved');

set role anon;
select pg_temp.act_as(null);
select pg_temp.fails($$select public.leave_group((select id from g))$$, 'permission denied', 'signed-out users cannot call leave_group');
reset role;

set role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select pg_temp.fails($$select public.leave_group((select id from g))$$, 'own this group', 'owner cannot leave');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.fails($$select public.leave_group((select id from g))$$, 'still owe 1 person', 'member who owes money cannot leave');
select pg_temp.fails($$select public.leave_group((select id from g), true)$$, 'still owe', 'confirming does not let a debtor leave');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select pg_temp.check((public.leave_group((select id from g))->>'left')::boolean, 'member who paid back in full can leave');
select pg_temp.check(not public.is_group_member((select id from g)), 'they are no longer a member');
select pg_temp.fails($$select public.leave_group((select id from g))$$, 'not a member', 'cannot leave twice');

reset role;
-- Cat pays ₱100 split with Ben: Ben now owes Cat 50.
select public.create_expense_with_splits('00000000-0000-0000-0000-00000000000c', (select id from g),
  '00000000-0000-0000-0000-00000000000c', 'Snacks', 100, now(), 'food',
  null, '[{"userId":"00000000-0000-0000-0000-00000000000c","amount":50},{"userId":"00000000-0000-0000-0000-00000000000b","amount":50}]');
set role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select pg_temp.fails($$select public.leave_group((select id from g))$$, '1 person still owes you', 'someone who is owed must confirm first');
select pg_temp.check(public.is_group_member((select id from g)), 'still a member after the refusal');
select pg_temp.check((public.leave_group((select id from g), true)->>'leftCollectibles')::boolean, 'after confirming, they leave with collectibles');
select pg_temp.check(not public.is_group_member((select id from g)), 'Cat left');
reset role;

-- Ben pays Ana and Cat back; now Ben can leave.
insert into public."Settlement" ("groupId", "payerId", "receiverId", amount)
select id, '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a', 150 from g;
insert into public."Settlement" ("groupId", "payerId", "receiverId", amount)
select id, '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c', 50 from g;
set role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((public.leave_group((select id from g))->>'left')::boolean, 'after settling up, member can leave');
reset role;

select pg_temp.check((select count(*) from public."Expense") = 3, 'expenses stay in the group history');
\echo ALL LEAVE GROUP TESTS PASSED
