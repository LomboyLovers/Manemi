-- Tests for personal expenses (Expense rows with no group): owner-only
-- access, validation, receipts, and that they never reach group data.
-- Runs on a fresh database: supabase_platform_stub.sql + all migrations.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create function pg_temp.act_as(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p::text, ''), false); $$;
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
end $$;
create function pg_temp.err(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return null;
exception when others then return sqlerrm;
end $$;

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000b1', 'ana@example.com', now(), '{"full_name":"Ana"}'),
  ('00000000-0000-0000-0000-0000000000b2', 'ben@example.com', now(), '{"full_name":"Ben"}');

-- A group Ana and Ben share, with one real group expense (Ben owes Ana 50).
select public.create_group_with_admin('00000000-0000-0000-0000-0000000000b1', 'Trip');
create temp table g as select "groupId" as id from public."Group" limit 1;
grant select on g to authenticated;
insert into public."Group_Member" ("groupId", "userId") select id, '00000000-0000-0000-0000-0000000000b2' from g;
select public.create_expense_with_splits('00000000-0000-0000-0000-0000000000b1', (select id from g),
  '00000000-0000-0000-0000-0000000000b1', 'Dinner', 100, now(), 'food', null,
  '[{"userId":"00000000-0000-0000-0000-0000000000b1","amount":50},{"userId":"00000000-0000-0000-0000-0000000000b2","amount":50}]');

set role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
create temp table personal_seen (n int);

-- Add personal expenses (no group, paid by you)
insert into public."Expense" ("paidBy_UserId", title, "totalAmount", category)
values ('00000000-0000-0000-0000-0000000000b1', 'Coffee', 150, 'food');
insert into public."Expense" ("paidBy_UserId", title, "totalAmount", currency, category, note)
values ('00000000-0000-0000-0000-0000000000b1', 'Netflix', 9.99, 'USD', 'entertainment', 'monthly');
select pg_temp.check((select count(*) from public."Expense" where "groupId" is null) = 2, 'owner sees own personal expenses');
select pg_temp.check((select count(*) from public."Expense" where "groupId" is not null) = 1, 'group expense still visible to members');

-- Validation
select pg_temp.check(pg_temp.err($$ insert into public."Expense" ("paidBy_UserId", title, "totalAmount") values ('00000000-0000-0000-0000-0000000000b1', 'Free', 0) $$) like '%check%', 'zero amount refused');
select pg_temp.check(pg_temp.err($$ insert into public."Expense" ("paidBy_UserId", title, "totalAmount") values ('00000000-0000-0000-0000-0000000000b1', '   ', 5) $$) like '%check%', 'blank title refused');
select pg_temp.check(pg_temp.err($$ insert into public."Expense" ("paidBy_UserId", title, "totalAmount", currency) values ('00000000-0000-0000-0000-0000000000b1', 'x', 5, 'BTC') $$) like '%check%', 'unknown currency refused');
select pg_temp.check(pg_temp.err($$ insert into public."Expense" ("paidBy_UserId", title, "totalAmount", note) values ('00000000-0000-0000-0000-0000000000b1', 'x', 5, repeat('a', 501)) $$) like '%check%', 'note over 500 refused');

-- Can't use this to touch group data or other people
select pg_temp.check(pg_temp.err($$ insert into public."Expense" ("paidBy_UserId", title, "totalAmount") values ('00000000-0000-0000-0000-0000000000b2', 'sneaky', 5) $$) like '%row-level security%', 'can''t add one for someone else');
select pg_temp.check(pg_temp.err(format($f$ insert into public."Expense" ("groupId", "paidBy_UserId", title, "totalAmount") values (%L, '00000000-0000-0000-0000-0000000000b1', 'bypass', 5) $f$, (select id from g))) like '%row-level security%', 'can''t add a group expense directly (RPC only)');
select pg_temp.check(pg_temp.err(format($f$ update public."Expense" set "groupId" = %L where title = 'Coffee' $f$, (select id from g))) like '%row-level security%', 'can''t move a personal expense into a group');
update public."Expense" set "totalAmount" = 1 where title = 'Dinner';
select pg_temp.check((select "totalAmount" from public."Expense" where title = 'Dinner') = 100, 'group expenses can''t be edited directly');
delete from public."Expense" where title = 'Dinner';
select pg_temp.check((select count(*) from public."Expense" where title = 'Dinner') = 1, 'group expenses can''t be deleted directly');

-- Owner edits / deletes
update public."Expense" set "totalAmount" = 175 where title = 'Coffee';
select pg_temp.check((select "totalAmount" from public."Expense" where title = 'Coffee') = 175, 'owner can edit');
select pg_temp.check(pg_temp.err($$ update public."Expense" set "paidBy_UserId" = '00000000-0000-0000-0000-0000000000b2' where title = 'Coffee' $$) like '%row-level security%', 'can''t hand it to someone else');

-- Personal expenses stay out of group data
reset role;
select pg_temp.check(public._group_net((select id from g), '00000000-0000-0000-0000-0000000000b1') = 50, 'group balance ignores personal expenses');
set role authenticated;
select pg_temp.check((select count(*) from public.search_history('all', null, null, false, 'newest', 50, 0)) = 1, 'history lists group expenses only');
select pg_temp.check((select count(*) from public.report_expenses(null, null, null)) = 1, 'group report lists group expenses only');

-- Ben can't see or change Ana's personal expenses
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
select pg_temp.check((select count(*) from public."Expense" where "groupId" is null) = 0, 'others can''t see them');
update public."Expense" set "totalAmount" = 1 where title = 'Coffee';
delete from public."Expense" where title = 'Netflix';
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select pg_temp.check((select "totalAmount" from public."Expense" where title = 'Coffee') = 175, 'others can''t edit them');
select pg_temp.check((select count(*) from public."Expense" where title = 'Netflix') = 1, 'others can''t delete them');
delete from public."Expense" where title = 'Netflix';
select pg_temp.check((select count(*) from public."Expense" where "groupId" is null) = 1, 'owner can delete');

-- Receipts: personal/<own id>/ only
select pg_temp.check(pg_temp.err($$ insert into storage.objects (bucket_id, name) values ('receipts', 'personal/00000000-0000-0000-0000-0000000000b1/r.webp') $$) is null, 'upload own personal receipt');
select pg_temp.check(pg_temp.err($$ insert into storage.objects (bucket_id, name) values ('receipts', 'personal/00000000-0000-0000-0000-0000000000b2/r.webp') $$) like '%row-level security%', 'can''t upload into someone else''s folder');

reset role;
select 'ALL PERSONAL TESTS PASSED' as result;
