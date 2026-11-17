-- =====================================================================
-- SRS gaps (2026-11-18)
--   EXP / currency   Expense.currency (per-expense currency)
--   SEC-02           receipts bucket private; only group members can read
--   GROUP-04         remove_group_member (owner only, member must be settled)
--   GROUP-06         rename_group (owner only)
--   GROUP-05         leave_group uses the member's net balance
--   SEC-05/HIST-04   audit log records member removed/left and renames
--   NOTIF-04         email notification preferences on User
--   HIST-02          search_history: category, member and date-range filters
--   DASH-02..05      report_expenses for the spending report
-- =====================================================================

-- ---------- currency ----------
alter table public."Expense" add column if not exists currency text not null default 'PHP';
do $$ begin
  alter table public."Expense" add constraint expense_currency_check
    check (currency in ('PHP', 'USD', 'EUR', 'JPY', 'KRW'));
exception when duplicate_object then null; end $$;

-- ---------- private receipts ----------
update storage.buckets set public = false where id = 'receipts';
drop policy if exists "Anyone can view receipt photos" on storage.objects;
drop policy if exists "Authenticated users can upload receipts" on storage.objects; -- uploads go through upload-receipt
drop policy if exists "Group members can view receipts" on storage.objects;
create policy "Group members can view receipts" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'receipts'
    -- folder = group id; a CASE so a non-uuid folder can never raise a cast error
    and public.is_group_member(case when (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
                                    then ((storage.foldername(name))[1])::uuid end)
  );

-- ---------- notification preferences ----------
alter table public."User" add column if not exists "notifyExpense" boolean not null default true;
alter table public."User" add column if not exists "notifySettlement" boolean not null default true;
alter table public."User" add column if not exists "notifyGroupJoin" boolean not null default true;

-- ---------- audit log: membership + rename events ----------
alter table public."Group_Activity" drop constraint if exists "Group_Activity_action_check";
alter table public."Group_Activity" add constraint "Group_Activity_action_check" check (action = any (array[
  'expense_created', 'expense_updated', 'expense_deleted',
  'settlement_recorded', 'settlement_updated', 'settlement_cancelled',
  'member_removed', 'member_left', 'group_renamed'
]));
alter table public."Group_Activity" drop constraint if exists "Group_Activity_entityType_check";
alter table public."Group_Activity" add constraint "Group_Activity_entityType_check"
  check ("entityType" = any (array['expense', 'settlement', 'member', 'group']));

-- ---------- a member's net balance in a group (positive = is owed) ----------
create or replace function public._group_net(p_group_id uuid, p_user_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(amount), 0) from (
    select s."amountOwed" as amount
    from public."Expense" e join public."Expense_Split" s on s."expenseId" = e."expenseId"
    where e."groupId" = p_group_id and e."paidBy_UserId" = p_user_id and s."userId" <> p_user_id
    union all
    select -s."amountOwed"
    from public."Expense" e join public."Expense_Split" s on s."expenseId" = e."expenseId"
    where e."groupId" = p_group_id and s."userId" = p_user_id and e."paidBy_UserId" <> p_user_id
    union all
    select st.amount from public."Settlement" st
    where st."groupId" = p_group_id and st.status = 'completed' and st."payerId" = p_user_id
    union all
    select -st.amount from public."Settlement" st
    where st."groupId" = p_group_id and st.status = 'completed' and st."receiverId" = p_user_id
  ) t;
$$;
revoke all on function public._group_net(uuid, uuid) from public, anon, authenticated;

-- ---------- leave: by net balance ----------
drop function if exists public.leave_group(uuid, boolean);
create or replace function public.leave_group(p_group_id uuid, p_leave_collectibles boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_role  text;
  v_group public."Group";
  v_net   numeric;
begin
  if v_me is null then raise exception 'FORBIDDEN: Sign in first'; end if;
  select g.* into v_group from public."Group" g where g."groupId" = p_group_id;
  if not found then raise exception 'NOT_FOUND: Group not found'; end if;

  select m.role::text into v_role from public."Group_Member" m
  where m."groupId" = p_group_id and m."userId" = v_me for update;
  if v_role is null then raise exception 'NOT_FOUND: You''re not a member of this group'; end if;
  if v_role = 'owner' then
    raise exception 'FORBIDDEN: You own this group, so you can''t leave it. Archive it instead';
  end if;

  v_net := public._group_net(p_group_id, v_me);
  if v_net <= -0.005 then
    raise exception 'INVALID: You still owe ₱% in this group. Settle up before leaving', to_char(-v_net, 'FM999,999,990.00');
  end if;
  if v_net >= 0.005 and not coalesce(p_leave_collectibles, false) then
    raise exception 'CONFLICT: People still owe you ₱% in this group. Confirm to leave anyway', to_char(v_net, 'FM999,999,990.00');
  end if;

  delete from public."Group_Member" where "groupId" = p_group_id and "userId" = v_me;
  insert into public."Group_Activity" ("groupId", "actorId", action, "entityType", "entityId", details)
  values (p_group_id, v_me, 'member_left', 'member', v_me,
          jsonb_build_object('userId', v_me, 'leftCollectibles', v_net >= 0.005, 'net', v_net));

  return jsonb_build_object('left', true, 'groupId', p_group_id, 'groupName', v_group.name,
                            'leftCollectibles', v_net >= 0.005);
end;
$$;
revoke all on function public.leave_group(uuid, boolean) from public, anon;
grant execute on function public.leave_group(uuid, boolean) to authenticated;

-- ---------- GROUP-04: owner removes a settled member ----------
create or replace function public.remove_group_member(p_group_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := auth.uid();
  v_target text;
  v_net    numeric;
  v_name   text;
begin
  if v_me is null then raise exception 'FORBIDDEN: Sign in first'; end if;
  if not exists (select 1 from public."Group_Member" m
                 where m."groupId" = p_group_id and m."userId" = v_me and m.role::text = 'owner') then
    raise exception 'FORBIDDEN: Only the group owner can remove members';
  end if;
  if p_user_id = v_me then
    raise exception 'INVALID: You can''t remove yourself. Archive the group instead';
  end if;

  select m.role::text into v_target from public."Group_Member" m
  where m."groupId" = p_group_id and m."userId" = p_user_id for update;
  if v_target is null then raise exception 'NOT_FOUND: That person isn''t in this group'; end if;
  if v_target = 'owner' then raise exception 'FORBIDDEN: The owner can''t be removed'; end if;

  select u.name into v_name from public."User" u where u."userId" = p_user_id;
  v_net := public._group_net(p_group_id, p_user_id);
  if abs(v_net) >= 0.005 then
    raise exception 'INVALID: % still has an open balance of ₱% in this group. Settle up before removing them',
      coalesce(v_name, 'This member'), to_char(abs(v_net), 'FM999,999,990.00');
  end if;

  delete from public."Group_Member" where "groupId" = p_group_id and "userId" = p_user_id;
  -- Pending invitations for them are cleared too, so they can be invited again later.
  delete from public."Group_Invitation" where "groupId" = p_group_id and "invitedUserId" = p_user_id;
  insert into public."Group_Activity" ("groupId", "actorId", action, "entityType", "entityId", details)
  values (p_group_id, v_me, 'member_removed', 'member', p_user_id,
          jsonb_build_object('userId', p_user_id, 'name', v_name));

  return jsonb_build_object('removed', true, 'userId', p_user_id);
end;
$$;
revoke all on function public.remove_group_member(uuid, uuid) from public, anon;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;

-- ---------- GROUP-06: owner renames the group ----------
create or replace function public.rename_group(p_group_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := auth.uid();
  v_old  text;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if v_me is null then raise exception 'FORBIDDEN: Sign in first'; end if;
  if not exists (select 1 from public."Group_Member" m
                 where m."groupId" = p_group_id and m."userId" = v_me and m.role::text = 'owner') then
    raise exception 'FORBIDDEN: Only the group owner can rename the group';
  end if;
  if length(v_name) = 0 then raise exception 'INVALID: Enter a group name'; end if;
  if length(v_name) > 50 then raise exception 'INVALID: Group names can be up to 50 characters'; end if;

  select name into v_old from public."Group" where "groupId" = p_group_id for update;
  if v_old is distinct from v_name then
    update public."Group" set name = v_name where "groupId" = p_group_id;
    insert into public."Group_Activity" ("groupId", "actorId", action, "entityType", "entityId", details)
    values (p_group_id, v_me, 'group_renamed', 'group', p_group_id,
            jsonb_build_object('changes', jsonb_build_object('name', jsonb_build_object('from', v_old, 'to', v_name))));
  end if;
  return jsonb_build_object('groupId', p_group_id, 'name', v_name);
end;
$$;
revoke all on function public.rename_group(uuid, text) from public, anon;
grant execute on function public.rename_group(uuid, text) to authenticated;

-- ---------- HIST-02: history filters (category, member, date range) + currency ----------
drop function if exists public.search_history(text, uuid, text, boolean, text, integer, integer);
create or replace function public.search_history(
  p_kind text default 'all',
  p_group_id uuid default null,
  p_query text default null,
  p_only_mine boolean default false,
  p_sort text default 'newest',
  p_limit integer default 10,
  p_offset integer default 0,
  p_category text default null,       -- expense category; hides payments
  p_member_id uuid default null,      -- payer, participant or payment party
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  kind text, id uuid, group_id uuid, group_name text, title text, amount numeric,
  category text, happened_at timestamptz, payer_id uuid, payer_name text,
  receiver_id uuid, receiver_name text, payment_method text, your_share numeric,
  involves_you boolean, currency text, total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with me as (select auth.uid() as id),
  my_groups as (
    select gm."groupId" from public."Group_Member" gm, me
    where gm."userId" = me.id and (p_group_id is null or gm."groupId" = p_group_id)
  ),
  pat as (
    select case when nullif(btrim(coalesce(p_query, '')), '') is null then null
      else '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%' end as p
  ),
  expenses as (
    select 'expense'::text as kind, e."expenseId" as id, e."groupId" as group_id, g.name::text as group_name,
           e.title::text as title, e."totalAmount" as amount, e.category::text as category,
           e."expenseDate" as happened_at, e."paidBy_UserId" as payer_id, pu.name::text as payer_name,
           null::uuid as receiver_id, null::text as receiver_name, null::text as payment_method,
           coalesce((
             select case
               when s."amountOwed" is not null then s."amountOwed"
               when s.percentage is not null then round(e."totalAmount" * s.percentage / 100, 2)
               else round(e."totalAmount" / nullif((select count(*) from public."Expense_Split" s2
                                                     where s2."expenseId" = e."expenseId"), 0), 2)
             end
             from public."Expense_Split" s, me
             where s."expenseId" = e."expenseId" and s."userId" = me.id
             limit 1
           ), case
             when not exists (select 1 from public."Expense_Split" s3 where s3."expenseId" = e."expenseId")
             then round(e."totalAmount" / nullif((select count(*) from public."Group_Member" m
                                                   where m."groupId" = e."groupId"), 0), 2)
             else 0 end) as your_share,
           e.currency as currency
    from public."Expense" e
    join my_groups mg on mg."groupId" = e."groupId"
    join public."Group" g on g."groupId" = e."groupId"
    left join public."User" pu on pu."userId" = e."paidBy_UserId"
    where coalesce(p_kind, 'all') in ('all', 'expenses')
      and (p_category is null or e.category::text = p_category)
      and (p_member_id is null or e."paidBy_UserId" = p_member_id
           or exists (select 1 from public."Expense_Split" sm
                      where sm."expenseId" = e."expenseId" and sm."userId" = p_member_id))
  ),
  payments as (
    select 'payment'::text, st."settlementId", st."groupId", g.name::text,
           null::text, st.amount, null::text,
           coalesce(st."settledAt", st."createdAt"), st."payerId", pu.name::text,
           st."receiverId", ru.name::text, st."paymentMethod"::text, 0::numeric, 'PHP'::text
    from public."Settlement" st
    join my_groups mg on mg."groupId" = st."groupId"
    join public."Group" g on g."groupId" = st."groupId"
    left join public."User" pu on pu."userId" = st."payerId"
    left join public."User" ru on ru."userId" = st."receiverId"
    where st.status = 'completed' and coalesce(p_kind, 'all') in ('all', 'payments')
      and p_category is null
      and (p_member_id is null or p_member_id in (st."payerId", st."receiverId"))
  ),
  filtered as (
    select r.*, (r.payer_id = me.id or r.receiver_id = me.id or r.your_share > 0) as involves_you
    from (select * from expenses union all select * from payments) r, me, pat
    where (pat.p is null
           or r.title ilike pat.p or r.group_name ilike pat.p
           or r.payer_name ilike pat.p or r.receiver_name ilike pat.p)
      and (p_from is null or r.happened_at >= p_from)
      and (p_to is null or r.happened_at < p_to)
  )
  select f.kind, f.id, f.group_id, f.group_name, f.title, f.amount, f.category, f.happened_at,
         f.payer_id, f.payer_name, f.receiver_id, f.receiver_name, f.payment_method,
         f.your_share, f.involves_you, f.currency, count(*) over () as total_count
  from filtered f
  where not coalesce(p_only_mine, false) or f.involves_you
  order by case when p_sort = 'largest' then f.amount end desc nulls last,
           case when p_sort = 'oldest' then f.happened_at end asc,
           f.happened_at desc, f.id
  limit greatest(1, least(coalesce(p_limit, 10), 50))
  offset greatest(0, coalesce(p_offset, 0));
$$;
revoke all on function public.search_history(text, uuid, text, boolean, text, integer, integer, text, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.search_history(text, uuid, text, boolean, text, integer, integer, text, uuid, timestamptz, timestamptz) to authenticated;

-- ---------- DASH-02..05: itemized expenses for the spending report ----------
create or replace function public.report_expenses(
  p_group_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  id uuid, group_id uuid, group_name text, title text, amount numeric, currency text,
  category text, happened_at timestamptz, payer_id uuid, payer_name text, your_share numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select h.id, h.group_id, h.group_name, h.title, h.amount, h.currency, h.category,
         h.happened_at, h.payer_id, h.payer_name, h.your_share
  from (
    select e."expenseId" as id, e."groupId" as group_id, g.name::text as group_name, e.title::text as title,
           e."totalAmount" as amount, e.currency, e.category::text as category, e."expenseDate" as happened_at,
           e."paidBy_UserId" as payer_id, pu.name::text as payer_name,
           coalesce((select s."amountOwed" from public."Expense_Split" s
                     where s."expenseId" = e."expenseId" and s."userId" = auth.uid() limit 1), 0) as your_share
    from public."Expense" e
    join public."Group_Member" gm on gm."groupId" = e."groupId" and gm."userId" = auth.uid()
    join public."Group" g on g."groupId" = e."groupId"
    left join public."User" pu on pu."userId" = e."paidBy_UserId"
    where (p_group_id is null or e."groupId" = p_group_id)
      and (p_from is null or e."expenseDate" >= p_from)
      and (p_to is null or e."expenseDate" < p_to)
  ) h
  order by h.happened_at desc
  limit 2000;
$$;
revoke all on function public.report_expenses(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.report_expenses(uuid, timestamptz, timestamptz) to authenticated;
