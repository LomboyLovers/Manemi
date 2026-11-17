-- Tests for search_history + search_activity. Runs on a fresh database built from:
--   supabase_platform_stub.sql + all migrations (baseline first).
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com', now(), '{"full_name":"Ana"}'),
  ('00000000-0000-0000-0000-00000000000b', 'ben@example.com', now(), '{"full_name":"Ben"}'),
  ('00000000-0000-0000-0000-00000000000c', 'cat@example.com', now(), '{"full_name":"Cat"}');
update public."User" set name = initcap(split_part(email, '@', 1));

-- G1: Ana + Ben. G2: Cat only (Ana must never see it).
insert into public."Group" ("groupId", name, "createdBy") values
  ('10000000-0000-0000-0000-000000000001', 'Korea 2026', '00000000-0000-0000-0000-00000000000a'),
  ('10000000-0000-0000-0000-000000000002', 'Secret trip', '00000000-0000-0000-0000-00000000000c');
insert into public."Group_Member" ("groupId", "userId") values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b')
on conflict do nothing;

-- 12 expenses in G1 (so there are 2 pages), Ben pays, Ana owes half of each.
insert into public."Expense" ("expenseId", "groupId", "paidBy_UserId", title, "totalAmount", category, "expenseDate")
select ('20000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, '10000000-0000-0000-0000-000000000001',
       '00000000-0000-0000-0000-00000000000b', 'Dinner ' || n, n * 100, 'food', now() - (n || ' days')::interval
from generate_series(1, 12) n;
insert into public."Expense_Split" ("expenseId", "userId", "amountOwed")
select e."expenseId", u.id, e."totalAmount" / 2
from public."Expense" e cross join (values ('00000000-0000-0000-0000-00000000000a'::uuid), ('00000000-0000-0000-0000-00000000000b'::uuid)) u(id);
-- One percentage split, one without split rows (shared by the group).
insert into public."Expense" ("expenseId", "groupId", "paidBy_UserId", title, "totalAmount", category, "expenseDate") values
  ('20000000-0000-0000-0000-000000000099', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'Hotel_50%', 1000, 'lodging', now() - interval '20 days'),
  ('20000000-0000-0000-0000-000000000098', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'Taxi', 300, 'transport', now() - interval '21 days');
insert into public."Expense_Split" ("expenseId", "userId", "amountOwed", percentage) values
  ('20000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-00000000000a', 250, 25),
  ('20000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-00000000000b', 750, 75);
-- G2 expense Ana must not see.
insert into public."Expense" ("groupId", "paidBy_UserId", title, "totalAmount", category)
values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000c', 'Dinner secret', 999, 'food');
-- A payment Ana -> Ben.
insert into public."Settlement" ("groupId", "payerId", "receiverId", amount, status, "paymentMethod", "settledAt") values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', 150, 'completed', 'gcash', now()),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', 75, 'cancelled', 'cash', now());
-- Audit log rows.
insert into public."Group_Activity" ("groupId", "actorId", action, "entityType", "entityId", details, "createdAt") values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'expense_created', 'expense', gen_random_uuid(), '{"title":"Dinner 1","totalAmount":100,"paidBy":"00000000-0000-0000-0000-00000000000b"}', now() - interval '1 day'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'settlement_recorded', 'settlement', gen_random_uuid(), '{"amount":150,"payerId":"00000000-0000-0000-0000-00000000000a","receiverId":"00000000-0000-0000-0000-00000000000b","paymentMethod":"gcash"}', now()),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'expense_updated', 'expense', gen_random_uuid(), '{"title":"Hotel_50%","changes":{"totalAmount":{"from":900,"to":1000}}}', now() - interval '2 days'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000c', 'expense_created', 'expense', gen_random_uuid(), '{"title":"Dinner secret","totalAmount":999}', now());

create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);

-- ---------- search_history ----------
select pg_temp.check((select count(*) from public.search_history()) = 10, 'first page has 10 rows');
select pg_temp.check((select max(total_count) from public.search_history()) = 15, 'total = 14 expenses + 1 completed payment (G2 and cancelled excluded)');
select pg_temp.check((select count(*) from public.search_history(p_offset => 10)) = 5, 'second page has the remaining 5');
select pg_temp.check((select kind from public.search_history() limit 1) = 'payment', 'newest first: today''s payment');
select pg_temp.check((select title from public.search_history(p_sort => 'oldest') limit 1) = 'Taxi', 'oldest first');
select pg_temp.check((select amount from public.search_history(p_sort => 'largest') limit 1) = 1200, 'largest first');
select pg_temp.check((select count(*) from public.search_history(p_query => 'secret')) = 0, 'other people''s groups never match');
select pg_temp.check((select max(total_count) from public.search_history(p_query => 'dinner 1')) = 4, 'search title (Dinner 1, 10, 11, 12)');
select pg_temp.check((select max(total_count) from public.search_history(p_query => 'korea')) = 15, 'search group name');
select pg_temp.check((select count(*) from public.search_history(p_query => '50%')) = 1, '% in the query is literal');
select pg_temp.check((select count(*) from public.search_history(p_query => 'Hotel_')) = 1, '_ in the query is literal');
select pg_temp.check((select max(total_count) from public.search_history(p_kind => 'payments')) = 1, 'payments only');
select pg_temp.check((select max(total_count) from public.search_history(p_kind => 'expenses')) = 14, 'expenses only');
select pg_temp.check((select your_share from public.search_history(p_query => 'Dinner 3')) = 150, 'your share from amountOwed');
select pg_temp.check((select your_share from public.search_history(p_query => 'Hotel')) = 250, 'your share for a percentage split');
select pg_temp.check((select your_share from public.search_history(p_query => 'Taxi')) = 150, 'no split rows: shared by the group');
select pg_temp.check((select bool_and(involves_you) from public.search_history(p_only_mine => true, p_limit => 50)), 'only mine');
select pg_temp.check((select count(*) from public.search_history(p_limit => 500)) = 15, 'limit is capped at 50');

-- ---------- search_activity ----------
select pg_temp.check((select max(total_count) from public.search_activity()) = 3, 'log: only my groups');
select pg_temp.check((select action from public.search_activity() limit 1) = 'settlement_recorded', 'log: newest first');
select pg_temp.check((select actor_name from public.search_activity() limit 1) = 'Ana', 'log: actor name');
select pg_temp.check((select receiver_name from public.search_activity() limit 1) = 'Ben', 'log: receiver name');
select pg_temp.check((select amount from public.search_activity(p_sort => 'largest') limit 1) = 1000, 'log: amount from changes.totalAmount.to');
select pg_temp.check((select max(total_count) from public.search_activity(p_query => 'ben')) = 3, 'log: search by person');
select pg_temp.check((select max(total_count) from public.search_activity(p_query => 'Hotel')) = 1, 'log: search by title');
select pg_temp.check((select count(*) from public.search_activity(p_limit => 1, p_offset => 1)) = 1, 'log: paging');

reset role;
set role anon;
select pg_temp.check(not has_function_privilege('anon', 'public.search_history(text, uuid, text, boolean, text, integer, integer)', 'execute'), 'signed-out users cannot search');
reset role;

\echo ALL SEARCH TESTS PASSED
