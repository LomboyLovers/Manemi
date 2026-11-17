-- =====================================================================
-- 1. Leave a group
--    * Members and admins can leave once they're settled with everyone
--      in the group (no one owes them, they owe no one).
--    * The owner can't leave: archive the group instead.
--    Expenses and payments they took part in stay in the group's history.
--
-- 2. Add 'lodging' to expense categories (the app offers it; the database
--    didn't have it, so saving a Lodging expense failed).
-- =====================================================================

alter type public.expense_category add value if not exists 'lodging';


create or replace function public.leave_group(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := auth.uid();
  v_role   text;
  v_group  public."Group";
  v_unsettled int;
begin
  if v_me is null then
    raise exception 'FORBIDDEN: Sign in first';
  end if;

  select g.* into v_group from public."Group" g where g."groupId" = p_group_id;
  if not found then
    raise exception 'NOT_FOUND: Group not found';
  end if;

  select m.role::text into v_role
  from public."Group_Member" m
  where m."groupId" = p_group_id and m."userId" = v_me
  for update;

  if v_role is null then
    raise exception 'NOT_FOUND: You''re not a member of this group';
  end if;
  if v_role = 'owner' then
    raise exception 'FORBIDDEN: You own this group, so you can''t leave it. Archive it instead';
  end if;

  -- Debts between you and each other person in this group, from expense
  -- splits and completed payments (positive = they owe you).
  with ledger as (
    -- they owe you for expenses you paid
    select s."userId" as other, s."amountOwed" as amount
    from public."Expense" e
    join public."Expense_Split" s on s."expenseId" = e."expenseId"
    where e."groupId" = p_group_id and e."paidBy_UserId" = v_me and s."userId" <> v_me
    union all
    -- you owe them for expenses they paid
    select e."paidBy_UserId", -s."amountOwed"
    from public."Expense" e
    join public."Expense_Split" s on s."expenseId" = e."expenseId"
    where e."groupId" = p_group_id and s."userId" = v_me and e."paidBy_UserId" <> v_me
    union all
    -- you paid them back
    select st."receiverId", st.amount
    from public."Settlement" st
    where st."groupId" = p_group_id and st.status = 'completed' and st."payerId" = v_me
    union all
    -- they paid you back
    select st."payerId", -st.amount
    from public."Settlement" st
    where st."groupId" = p_group_id and st.status = 'completed' and st."receiverId" = v_me
  )
  select count(*) into v_unsettled
  from (
    select other from ledger group by other having abs(sum(amount)) >= 0.005
  ) open_balances;

  if v_unsettled > 0 then
    raise exception 'INVALID: Settle up with everyone in this group before leaving (% open balance%)',
      v_unsettled, case when v_unsettled = 1 then '' else 's' end;
  end if;

  delete from public."Group_Member"
  where "groupId" = p_group_id and "userId" = v_me;

  return jsonb_build_object('left', true, 'groupId', p_group_id, 'groupName', v_group.name);
end;
$$;

revoke all on function public.leave_group(uuid) from public, anon;
grant execute on function public.leave_group(uuid) to authenticated;
