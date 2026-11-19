-- Tests for personal expenses: owner-only access, validation, receipts.
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
  ('00000000-0000-0000-0000-0000000000b1', 'ana@example.com', now(), '{"username":"ana"}'),
  ('00000000-0000-0000-0000-0000000000b2', 'ben@example.com', now(), '{"username":"ben"}');

set role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');

-- Add: owner filled in automatically
insert into public."Personal_Expense" (title, amount, category) values ('Coffee', 150, 'food');
insert into public."Personal_Expense" (title, amount, currency, category, note) values ('Netflix', 9.99, 'USD', 'entertainment', 'monthly');
select pg_temp.check((select count(*) from public."Personal_Expense") = 2, 'owner sees own expenses');
select pg_temp.check((select "userId" from public."Personal_Expense" where title = 'Coffee') = '00000000-0000-0000-0000-0000000000b1', 'owner defaults to the signed-in user');

-- Validation
select pg_temp.check(pg_temp.err($$ insert into public."Personal_Expense" (title, amount) values ('Free', 0) $$) like '%check%', 'zero amount refused');
select pg_temp.check(pg_temp.err($$ insert into public."Personal_Expense" (title, amount) values ('Neg', -5) $$) like '%check%', 'negative amount refused');
select pg_temp.check(pg_temp.err($$ insert into public."Personal_Expense" (title, amount) values ('   ', 5) $$) like '%check%', 'blank title refused');
select pg_temp.check(pg_temp.err($$ insert into public."Personal_Expense" (title, amount, currency) values ('x', 5, 'BTC') $$) like '%check%', 'unknown currency refused');
select pg_temp.check(pg_temp.err($$ insert into public."Personal_Expense" (title, amount, note) values ('x', 5, repeat('a', 501)) $$) like '%check%', 'note over 500 refused');
select pg_temp.check(pg_temp.err($$ insert into public."Personal_Expense" ("userId", title, amount) values ('00000000-0000-0000-0000-0000000000b2', 'sneaky', 5) $$) like '%row-level security%', 'can''t add for someone else');

-- Edit / delete own
update public."Personal_Expense" set amount = 175 where title = 'Coffee';
select pg_temp.check((select amount from public."Personal_Expense" where title = 'Coffee') = 175, 'owner can edit');
update public."Personal_Expense" set "userId" = '00000000-0000-0000-0000-0000000000b2' where title = 'Coffee';
select pg_temp.check((select count(*) from public."Personal_Expense" where title = 'Coffee') = 1, 'can''t hand an expense to someone else');

-- Someone else
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
select pg_temp.check((select count(*) from public."Personal_Expense") = 0, 'others can''t see them');
update public."Personal_Expense" set amount = 1 where title = 'Coffee';
delete from public."Personal_Expense" where title = 'Netflix';
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select pg_temp.check((select amount from public."Personal_Expense" where title = 'Coffee') = 175, 'others can''t edit them');
select pg_temp.check((select count(*) from public."Personal_Expense" where title = 'Netflix') = 1, 'others can''t delete them');
delete from public."Personal_Expense" where title = 'Netflix';
select pg_temp.check((select count(*) from public."Personal_Expense") = 1, 'owner can delete');

-- Receipts: personal/<own id>/ only
select pg_temp.check(pg_temp.err($$ insert into storage.objects (bucket_id, name) values ('receipts', 'personal/00000000-0000-0000-0000-0000000000b1/r.webp') $$) is null, 'upload own personal receipt');
select pg_temp.check(pg_temp.err($$ insert into storage.objects (bucket_id, name) values ('receipts', 'personal/00000000-0000-0000-0000-0000000000b2/r.webp') $$) like '%row-level security%', 'can''t upload into someone else''s folder');
select pg_temp.check((select count(*) from storage.objects where name like 'personal/%') = 1, 'only own receipts visible');

reset role;
set role anon;
select pg_temp.check(pg_temp.err($$ select count(*) from public."Personal_Expense" $$) like '%permission denied%', 'signed-out users get nothing');
reset role;
select 'ALL PERSONAL TESTS PASSED' as result;
