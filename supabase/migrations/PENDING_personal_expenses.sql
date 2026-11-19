-- =====================================================================
-- Personal expenses: your own costs, no group, no splitting.
-- Only the owner can see or change them (RLS). Receipts go in the private
-- receipts bucket under personal/<userId>/..., readable only by the owner.
-- =====================================================================

create table if not exists public."Personal_Expense" (
  "personalExpenseId" uuid primary key default gen_random_uuid(),
  "userId"      uuid not null default auth.uid() references public."User" ("userId") on delete cascade,
  title         varchar(100) not null check (length(btrim(title)) between 1 and 100),
  amount        numeric(10, 2) not null check (amount > 0 and amount <= 99999999.99),
  currency      text not null default 'PHP' check (currency in ('PHP', 'USD', 'EUR', 'JPY', 'KRW')),
  category      public.expense_category not null default 'other',
  "expenseDate" timestamptz not null default now(),
  note          text check (note is null or length(note) <= 500),
  "receiptUrl"  text,
  "createdAt"   timestamptz not null default now(),
  "updatedAt"   timestamptz not null default now()
);
create index if not exists "Personal_Expense_user_date_idx"
  on public."Personal_Expense" ("userId", "expenseDate" desc);

alter table public."Personal_Expense" enable row level security;

drop policy if exists "Owner reads personal expenses" on public."Personal_Expense";
drop policy if exists "Owner adds personal expenses" on public."Personal_Expense";
drop policy if exists "Owner edits personal expenses" on public."Personal_Expense";
drop policy if exists "Owner deletes personal expenses" on public."Personal_Expense";
create policy "Owner reads personal expenses" on public."Personal_Expense"
  for select to authenticated using ("userId" = (select auth.uid()));
create policy "Owner adds personal expenses" on public."Personal_Expense"
  for insert to authenticated with check ("userId" = (select auth.uid()));
create policy "Owner edits personal expenses" on public."Personal_Expense"
  for update to authenticated
  using ("userId" = (select auth.uid()))
  with check ("userId" = (select auth.uid()));
create policy "Owner deletes personal expenses" on public."Personal_Expense"
  for delete to authenticated using ("userId" = (select auth.uid()));

revoke all on public."Personal_Expense" from anon;
grant select, insert, update, delete on public."Personal_Expense" to authenticated;

-- Keep updatedAt current and stop rows from moving to another owner.
create or replace function public._personal_expense_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new."updatedAt" := now();
  if tg_op = 'UPDATE' then
    new."userId" := old."userId";
    new."createdAt" := old."createdAt";
  end if;
  return new;
end;
$$;
drop trigger if exists personal_expense_touch on public."Personal_Expense";
create trigger personal_expense_touch
  before insert or update on public."Personal_Expense"
  for each row execute function public._personal_expense_touch();

-- ---------- receipts for personal expenses (private, owner only) ----------
drop policy if exists "Owner reads personal receipts" on storage.objects;
drop policy if exists "Owner uploads personal receipts" on storage.objects;
drop policy if exists "Owner deletes personal receipts" on storage.objects;
create policy "Owner reads personal receipts" on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = 'personal'
         and (storage.foldername(name))[2] = auth.uid()::text);
create policy "Owner uploads personal receipts" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = 'personal'
              and (storage.foldername(name))[2] = auth.uid()::text);
create policy "Owner deletes personal receipts" on storage.objects
  for delete to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = 'personal'
         and (storage.foldername(name))[2] = auth.uid()::text);
