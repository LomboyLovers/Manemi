-- Leaving a group, revisited:
--   * You still owe someone in the group -> blocked (settle up first).
--   * People still owe you -> allowed only after you confirm
--     (p_leave_collectibles = true); their debts to you stay on record.
--   * The owner still can't leave (archive instead).
drop function if exists public.leave_group(uuid);

create or replace function public.leave_group(p_group_id uuid, p_leave_collectibles boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := auth.uid();
  v_role   text;
  v_group  public."Group";
  v_i_owe  int;
  v_owed   int;
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

  -- Balance with each other person (positive = they owe you), from expense
  -- splits and completed payments.
  with ledger as (
    select s."userId" as other, s."amountOwed" as amount
    from public."Expense" e
    join public."Expense_Split" s on s."expenseId" = e."expenseId"
    where e."groupId" = p_group_id and e."paidBy_UserId" = v_me and s."userId" <> v_me
    union all
    select e."paidBy_UserId", -s."amountOwed"
    from public."Expense" e
    join public."Expense_Split" s on s."expenseId" = e."expenseId"
    where e."groupId" = p_group_id and s."userId" = v_me and e."paidBy_UserId" <> v_me
    union all
    select st."receiverId", st.amount
    from public."Settlement" st
    where st."groupId" = p_group_id and st.status = 'completed' and st."payerId" = v_me
    union all
    select st."payerId", -st.amount
    from public."Settlement" st
    where st."groupId" = p_group_id and st.status = 'completed' and st."receiverId" = v_me
  ),
  per_person as (
    select other, sum(amount) as net from ledger group by other
  )
  select count(*) filter (where net <= -0.005), count(*) filter (where net >= 0.005)
  into v_i_owe, v_owed
  from per_person;

  if v_i_owe > 0 then
    raise exception 'INVALID: You still owe % %. Settle up before leaving',
      v_i_owe, case when v_i_owe = 1 then 'person in this group' else 'people in this group' end;
  end if;

  if v_owed > 0 and not coalesce(p_leave_collectibles, false) then
    raise exception 'CONFLICT: % still owe% you money in this group. Confirm to leave anyway',
      case when v_owed = 1 then '1 person' else v_owed || ' people' end,
      case when v_owed = 1 then 's' else '' end;
  end if;

  delete from public."Group_Member"
  where "groupId" = p_group_id and "userId" = v_me;

  return jsonb_build_object('left', true, 'groupId', p_group_id, 'groupName', v_group.name,
                            'leftCollectibles', v_owed > 0);
end;
$$;

revoke all on function public.leave_group(uuid, boolean) from public, anon;
grant execute on function public.leave_group(uuid, boolean) to authenticated;
