-- Tests for list_activity_notifications + mark_notifications_seen. Runs on a fresh database built from:
--   supabase_platform_stub.sql + all migrations (baseline first).
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com', now(), '{"full_name":"Ana"}'),
  ('00000000-0000-0000-0000-00000000000b', 'ben@example.com', now(), '{"full_name":"Ben"}'),
  ('00000000-0000-0000-0000-00000000000c', 'cat@example.com', now(), '{"full_name":"Cat"}'),
  ('00000000-0000-0000-0000-00000000000d', 'dan@example.com', now(), '{"full_name":"Dan"}');
-- Everyone last opened the bell an hour ago.
update public."User" set "notificationsSeenAt" = now() - interval '1 hour';

create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
end $$;

-- G1: Ana, Ben, Cat. G2: Dan only (Ana must never see it).
insert into public."Group" ("groupId", name, "createdBy") values
  ('10000000-0000-0000-0000-000000000001', 'Korea 2026', '00000000-0000-0000-0000-00000000000a'),
  ('10000000-0000-0000-0000-000000000002', 'Secret trip', '00000000-0000-0000-0000-00000000000d');
insert into public."Group_Member" ("groupId", "userId") values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c')
on conflict do nothing;

-- E1: Ben paid, Ana owes 250 (new). E2: Ben paid, only Ben + Cat (Ana not in it).
-- E3: Ana added it herself (never notify yourself). E4: old, already seen.
insert into public."Expense" ("expenseId", "groupId", "paidBy_UserId", title, "totalAmount", category, currency) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'Dinner', 500, 'food', 'PHP'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'Taxi', 300, 'transport', 'PHP'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Snacks', 90, 'food', 'PHP'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', 'Hotel', 9000, 'lodging', 'USD'),
  ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000d', 'Secret', 999, 'food', 'PHP');
insert into public."Expense_Split" ("expenseId", "userId", "amountOwed") values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 250),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 250),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b', 150),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000c', 150),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', 45),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000b', 45),
  ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000a', 3000),
  ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000c', 6000);

delete from public."Group_Activity";
insert into public."Group_Activity" ("groupId", "actorId", action, "entityType", "entityId", details, "createdAt") values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'expense_created', 'expense', '20000000-0000-0000-0000-000000000001', '{"title":"Dinner","totalAmount":500,"paidBy":"00000000-0000-0000-0000-00000000000b"}', now() - interval '5 minutes'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'expense_created', 'expense', '20000000-0000-0000-0000-000000000002', '{"title":"Taxi","totalAmount":300,"paidBy":"00000000-0000-0000-0000-00000000000b"}', now() - interval '4 minutes'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'expense_created', 'expense', '20000000-0000-0000-0000-000000000003', '{"title":"Snacks","totalAmount":90,"paidBy":"00000000-0000-0000-0000-00000000000a"}', now() - interval '3 minutes'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', 'expense_created', 'expense', '20000000-0000-0000-0000-000000000004', '{"title":"Hotel","totalAmount":9000,"paidBy":"00000000-0000-0000-0000-00000000000c"}', now() - interval '2 days'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'expense_updated', 'expense', '20000000-0000-0000-0000-000000000001', '{"title":"Dinner","changes":{"totalAmount":{"from":400,"to":500}}}', now() - interval '2 minutes'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', 'settlement_recorded', 'settlement', gen_random_uuid(), '{"amount":100,"payerId":"00000000-0000-0000-0000-00000000000c","receiverId":"00000000-0000-0000-0000-00000000000a"}', now() - interval '1 minute'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', 'settlement_recorded', 'settlement', gen_random_uuid(), '{"amount":70,"payerId":"00000000-0000-0000-0000-00000000000c","receiverId":"00000000-0000-0000-0000-00000000000b"}', now() - interval '1 minute'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'group_renamed', 'group', '10000000-0000-0000-0000-000000000001', '{}', now()),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000d', 'expense_created', 'expense', '20000000-0000-0000-0000-000000000005', '{"title":"Secret","totalAmount":999,"paidBy":"00000000-0000-0000-0000-00000000000d"}', now());

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);

-- Ana sees: Dinner created, Dinner edited, Hotel (old), Cat's payment to her = 4.
select pg_temp.check((select count(*) from public.list_activity_notifications()) = 4, 'only activity that includes me, by others');
select pg_temp.check(not exists (select 1 from public.list_activity_notifications() where title in ('Taxi', 'Snacks', 'Secret')), 'excludes: not in split, my own, other groups');
select pg_temp.check((select max(unread_count) from public.list_activity_notifications()) = 3, '3 unread (Hotel was before I last looked)');
select pg_temp.check((select action from public.list_activity_notifications() limit 1) = 'settlement_recorded', 'newest first');
select pg_temp.check((select receiver_name from public.list_activity_notifications() limit 1) = 'Ana', 'payment receiver name');
select pg_temp.check((select your_share from public.list_activity_notifications() where action = 'expense_created' and title = 'Dinner') = 250, 'my share');
select pg_temp.check((select amount from public.list_activity_notifications() where action = 'expense_updated') = 500, 'edited amount = new amount');
select pg_temp.check((select currency from public.list_activity_notifications() where title = 'Hotel') = 'USD', 'expense currency');
select pg_temp.check((select actor_name from public.list_activity_notifications() where title = 'Hotel') = 'Cat', 'actor name');
select pg_temp.check((select count(*) from public.list_activity_notifications(1)) = 1, 'limit');

-- Opening the bell marks everything read.
select public.mark_notifications_seen();
select pg_temp.check((select coalesce(max(unread_count), 0) from public.list_activity_notifications()) = 0, 'all read after opening');
select pg_temp.check((select count(*) from public.list_activity_notifications()) = 4, 'still listed after reading');

-- Ben (payer of Dinner) is notified about Cat's payment to him, not Ana's view.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.check((select count(*) from public.list_activity_notifications() where action = 'settlement_recorded') = 1, 'payment to Ben only');
select pg_temp.check(exists (select 1 from public.list_activity_notifications() where title = 'Snacks'), 'Ben is in Ana''s Snacks split');
-- Marking read is per user.
select pg_temp.check((select max(unread_count) from public.list_activity_notifications()) > 0, 'Ben still has unread');

reset role;
select pg_temp.check(not has_function_privilege('anon', 'public.list_activity_notifications(integer)', 'execute'), 'signed-out users cannot read');
select pg_temp.check(not has_function_privilege('anon', 'public.mark_notifications_seen()', 'execute'), 'signed-out users cannot mark');

\echo ALL NOTIFICATION TESTS PASSED
