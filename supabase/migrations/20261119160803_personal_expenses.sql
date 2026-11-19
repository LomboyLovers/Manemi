-- =====================================================================
-- Personal expenses live in "Expense" with no group:
--   groupId IS NULL, owned by paidBy_UserId (the user who made it).
-- Group expenses are unchanged: they still go through the group RPCs, and
-- every balance / history / report query filters by group, so personal
-- rows never enter group math.
-- Only the owner can see or change a personal expense (RLS). Receipts go in
-- the private receipts bucket under personal/<userId>/..., owner only.
-- =====================================================================

alter table public."Expense" alter column "groupId" drop not null;

alter table public."Expense" add column if not exists note text;
do $$ begin
  alter table public."Expense" add constraint expense_note_length check (note is null or length(note) <= 500);
exception when duplicate_object then null; end $$;

-- Personal expenses need a real title (group expenses are checked by their RPCs).
do $$ begin
  alter table public."Expense" add constraint expense_personal_title
    check ("groupId" is not null or length(btrim(title)) between 1 and 100);
exception when duplicate_object then null; end $$;

create index if not exists "Expense_personal_owner_date_idx"
  on public."Expense" ("paidBy_UserId", "expenseDate" desc)
  where "groupId" is null;

-- Owner-only access to personal (no-group) expenses. Group expenses keep
-- "Members can view expenses" and stay write-only through the RPCs.
drop policy if exists "Owner reads personal expenses" on public."Expense";
drop policy if exists "Owner adds personal expenses" on public."Expense";
drop policy if exists "Owner edits personal expenses" on public."Expense";
drop policy if exists "Owner deletes personal expenses" on public."Expense";
create policy "Owner reads personal expenses" on public."Expense"
  for select to authenticated
  using ("groupId" is null and "paidBy_UserId" = (select auth.uid()));
create policy "Owner adds personal expenses" on public."Expense"
  for insert to authenticated
  with check ("groupId" is null and "paidBy_UserId" = (select auth.uid()));
create policy "Owner edits personal expenses" on public."Expense"
  for update to authenticated
  using ("groupId" is null and "paidBy_UserId" = (select auth.uid()))
  with check ("groupId" is null and "paidBy_UserId" = (select auth.uid()));
create policy "Owner deletes personal expenses" on public."Expense"
  for delete to authenticated
  using ("groupId" is null and "paidBy_UserId" = (select auth.uid()));

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
