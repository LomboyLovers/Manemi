-- Tests for the SRS-gaps migration (remove member, rename, leave by net,
-- audit events, history filters, report, private receipts).
-- Runs on a fresh database: supabase_platform_stub.sql + all migrations.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com', now(), '{"full_name":"Ana"}'),
  ('00000000-0000-0000-0000-00000000000b', 'ben@example.com', now(), '{"full_name":"Ben"}'),
  ('00000000-0000-0000-0000-00000000000c', 'cat@example.com', now(), '{"full_name":"Cat"}'),
  ('00000000-0000-0000-0000-00000000000d', 'dan@example.com', now(), '{"full_name":"Dan"}');
update public."User" set name = initcap(split_part(email, '@', 1));

select public.create_group_with_admin('00000000-0000-0000-0000-00000000000a', 'Trip');
create temp table g as select "groupId" as id from public."Group" limit 1;
insert into public."Group_Member" ("groupId", "userId")
select id, u from g, unnest(array['00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-00000000000d']::uuid[]) u;

-- Ana paid 300 for Ana+Ben (Ben owes 150). Ben paid 100 for Ben+Cat (Cat owes 50).
select public.create_expense_with_splits('00000000-0000-0000-0000-00000000000a', (select id from g),
  '00000000-0000-0000-0000-00000000000a', 'Dinner', 300, now() - interval '3 days', 'food', null,
  '[{"userId":"00000000-0000-0000-0000-00000000000a","amount":150},{"userId":"00000000-0000-0000-0000-00000000000b","amount":150}]');
select public.create_expense_with_splits('00000000-0000-0000-0000-00000000000b', (select id from g),
  '00000000-0000-0000-0000-00000000000b', 'Taxi', 100, now() - interval '40 days', 'transport', null,
  '[{"userId":"00000000-0000-0000-0000-00000000000b","amount":50},{"userId":"00000000-0000-0000-0000-00000000000c","amount":50}]');
update public."Expense" set currency = 'USD' where title = 'Taxi';

create function pg_temp.act_as(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p::text, ''), false); $$;
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if; end $$;
create function pg_temp.fails(stmt text, pattern text, label text) returns void language plpgsql as $$
begin
  execute stmt; raise exception 'FAIL (no error): %', label;
exception when others then
  if sqlerrm like 'FAIL (no error)%' then raise; end if;
  if sqlerrm !~* pattern then raise exception 'FAIL: % (got: %)', label, sqlerrm; end if;
end $$;
grant execute on all functions in schema pg_temp to anon, authenticated;
grant select on g to authenticated, anon;

-- net balances
select pg_temp.check(public._group_net((select id from g), '00000000-0000-0000-0000-00000000000a') = 150, 'Ana is owed 150');
select pg_temp.check(public._group_net((select id from g), '00000000-0000-0000-0000-00000000000b') = -100, 'Ben net -100');
select pg_temp.check(public._group_net((select id from g), '00000000-0000-0000-0000-00000000000d') = 0, 'Dan settled');

set role authenticated;
-- ---------- rename ----------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.fails($$select public.rename_group((select id from g), 'Hacked')$$, 'Only the group owner', 'members cannot rename');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select pg_temp.fails($$select public.rename_group((select id from g), '   ')$$, 'Enter a group name', 'blank name rejected');
select pg_temp.fails($$select public.rename_group((select id from g), repeat('x', 51))$$, 'up to 50', 'long name rejected');
select pg_temp.check((public.rename_group((select id from g), '  Korea 2026 ')->>'name') = 'Korea 2026', 'owner renames (trimmed)');
select pg_temp.check((select name from public."Group" where "groupId" = (select id from g)) = 'Korea 2026', 'name saved');
select pg_temp.check(exists (select 1 from public."Group_Activity" where action = 'group_renamed'), 'rename is in the audit log');

-- ---------- remove member ----------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.fails($$select public.remove_group_member((select id from g), '00000000-0000-0000-0000-00000000000d')$$, 'Only the group owner', 'members cannot remove');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select pg_temp.fails($$select public.remove_group_member((select id from g), '00000000-0000-0000-0000-00000000000a')$$, 'remove yourself', 'owner cannot remove self');
select pg_temp.fails($$select public.remove_group_member((select id from g), '00000000-0000-0000-0000-00000000000b')$$, 'Ben still has an open balance of ₱100.00', 'cannot remove someone with a balance');
select pg_temp.check((public.remove_group_member((select id from g), '00000000-0000-0000-0000-00000000000d')->>'removed')::boolean, 'owner removes a settled member');
select pg_temp.check(not exists (select 1 from public."Group_Member" where "userId" = '00000000-0000-0000-0000-00000000000d'), 'Dan is gone');
select pg_temp.check(exists (select 1 from public."Group_Activity" where action = 'member_removed'), 'removal is in the audit log');
select pg_temp.check((select count(*) from public."Expense") = 2, 'history kept');

-- ---------- leave by net ----------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.fails($$select public.leave_group((select id from g), true)$$, 'still owe ₱100.00', 'Ben (net -100) cannot leave, even confirming');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select pg_temp.fails($$select public.leave_group((select id from g))$$, 'still owe ₱50.00', 'Cat owes 50');

-- ---------- history filters ----------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select max(total_count) from public.search_history(p_category => 'food')) = 1, 'category filter');
select pg_temp.check((select max(total_count) from public.search_history(p_member_id => '00000000-0000-0000-0000-00000000000c')) = 1, 'member filter (participant)');
select pg_temp.check((select max(total_count) from public.search_history(p_from => now() - interval '7 days')) = 1, 'date from');
select pg_temp.check((select max(total_count) from public.search_history(p_to => now() - interval '7 days')) = 1, 'date to');
select pg_temp.check((select currency from public.search_history(p_query => 'Taxi')) = 'USD', 'currency returned');

-- ---------- report ----------
select pg_temp.check((select count(*) from public.report_expenses()) = 2, 'report: all');
select pg_temp.check((select count(*) from public.report_expenses(p_from => now() - interval '7 days')) = 1, 'report: range');
select pg_temp.check((select your_share from public.report_expenses() where title = 'Dinner') = 150, 'report: your share');

-- ---------- private receipts ----------
reset role;
insert into storage.objects (bucket_id, name) values
  ('receipts', (select id from g)::text || '/r1.png'),
  ('receipts', '99999999-9999-9999-9999-999999999999/other.png');
set role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from storage.objects) = 1, 'members see only their group''s receipts');
reset role;
set role anon;
select pg_temp.act_as(null);
select pg_temp.check((select count(*) from storage.objects) = 0, 'signed-out users see no receipts');
reset role;
select pg_temp.check(not (select public from storage.buckets where id = 'receipts'), 'bucket is private');

\echo ALL SRS TESTS PASSED
