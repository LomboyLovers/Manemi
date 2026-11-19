-- Tests for send_payment_reminder + reminders in the bell. Runs on a fresh database built from:
--   supabase_platform_stub.sql + all migrations (baseline first).
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com', now(), '{"full_name":"Ana"}'),
  ('00000000-0000-0000-0000-00000000000b', 'ben@example.com', now(), '{"full_name":"Ben"}'),
  ('00000000-0000-0000-0000-00000000000c', 'cat@example.com', now(), '{"full_name":"Cat"}'),
  ('00000000-0000-0000-0000-00000000000d', 'dan@example.com', now(), '{"full_name":"Dan"}');
update public."User" set "notificationsSeenAt" = now() - interval '1 hour';

create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
end $$;
-- Expect an error whose message starts with `prefix`.
create function pg_temp.fails(sql text, prefix text, label text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'FAIL: % (no error)', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if sqlerrm not like prefix || '%' then raise exception 'FAIL: % (got "%")', label, sqlerrm; end if;
end $$;

-- G1: Ana, Ben, Cat. Ana paid Dinner 750; Ben and Cat owe 250 each.
insert into public."Group" ("groupId", name, "createdBy") values
  ('10000000-0000-0000-0000-000000000001', 'Korea 2026', '00000000-0000-0000-0000-00000000000a');
insert into public."Group_Member" ("groupId", "userId") values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c')
on conflict do nothing;
insert into public."Expense" ("expenseId", "groupId", "paidBy_UserId", title, "totalAmount", category) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Dinner', 750, 'food');
insert into public."Expense_Split" ("expenseId", "userId", "amountOwed") values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 250),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 250),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', 250);

-- ---------- send_payment_reminder (called by the Edge Function as service role) ----------
select pg_temp.check(
  (public.send_payment_reminder('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001',
     '00000000-0000-0000-0000-00000000000b', 250)->>'amount')::numeric = 250,
  'Ana reminds Ben');
select pg_temp.check((select count(*) from public."Payment_Reminder") = 1, 'saved');
-- Amount is capped at what they owe (Cat owes 250, client asked 9999).
select pg_temp.check(
  (public.send_payment_reminder('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001',
     '00000000-0000-0000-0000-00000000000c', 9999)->>'amount')::numeric = 250,
  'amount capped at the debt');

select pg_temp.fails($$select public.send_payment_reminder('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 250)$$,
  'CONFLICT: You already reminded them recently', 'once per 12 hours');
select pg_temp.fails($$select public.send_payment_reminder('00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 250)$$,
  'CONFLICT: They don''t owe you', 'Ben owes Ana, not the other way round');
select pg_temp.fails($$select public.send_payment_reminder('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000d', 250)$$,
  'FORBIDDEN:', 'Dan is not in the group');
select pg_temp.fails($$select public.send_payment_reminder('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 250)$$,
  'INVALID:', 'not yourself');
select pg_temp.fails($$select public.send_payment_reminder('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 0)$$,
  'INVALID:', 'amount must be positive');

-- After 12 hours, another reminder is allowed.
update public."Payment_Reminder" set "createdAt" = now() - interval '13 hours'
where "toUserId" = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check(
  public.send_payment_reminder('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-00000000000b', 250) ? 'reminderId',
  'allowed again after 12 hours');

-- Once Ben has paid, he can't be reminded.
insert into public."Settlement" ("groupId", "payerId", "receiverId", amount, status, "paymentMethod", "settledAt") values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a', 250, 'completed', 'gcash', now());
update public."Payment_Reminder" set "createdAt" = now() - interval '13 hours'
where "toUserId" = '00000000-0000-0000-0000-00000000000b';
select pg_temp.fails($$select public.send_payment_reminder('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 250)$$,
  'CONFLICT: They don''t owe you', 'settled debts can''t be reminded');

-- ---------- Visibility ----------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.check((select count(*) from public."Payment_Reminder") = 2, 'Ben sees reminders sent to him');
select pg_temp.check(
  (select count(*) from public.list_activity_notifications() where action = 'payment_reminder') = 2,
  'reminders are in Ben''s bell');
select pg_temp.check(
  (select actor_name from public.list_activity_notifications() where action = 'payment_reminder' limit 1) = 'Ana',
  'from Ana');
select pg_temp.check(
  (select bool_and(unread) from public.list_activity_notifications() where action = 'payment_reminder' and created_at > now() - interval '1 minute') is not false,
  'new reminder is unread');
select pg_temp.fails($$insert into public."Payment_Reminder" ("groupId", "fromUserId", "toUserId", amount) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a', 5)$$,
  'permission denied', 'nobody inserts reminders directly');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select pg_temp.check((select count(*) from public."Payment_Reminder") = 1, 'Cat only sees her own reminder');
select pg_temp.check(
  (select count(*) from public.list_activity_notifications() where action = 'payment_reminder') = 1,
  'Cat''s bell has only hers');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select pg_temp.check((select count(*) from public."Payment_Reminder") = 3, 'Ana sees the reminders she sent');
select pg_temp.check(
  (select count(*) from public.list_activity_notifications() where action = 'payment_reminder') = 0,
  'sent reminders are not in the sender''s bell');

reset role;
select pg_temp.check(not has_function_privilege('authenticated', 'public.send_payment_reminder(uuid, uuid, uuid, numeric)', 'execute'), 'only the Edge Function can send');

\echo ALL PAYMENT REMINDER TESTS PASSED
