-- Payment reminders ("Request Payment" → Remind). The send-reminder Edge
-- Function calls send_payment_reminder (checks + saves) and then emails the
-- person; the reminder also shows in their bell (list_activity_notifications)
-- and arrives live over Realtime.

create table if not exists public."Payment_Reminder" (
  "reminderId" uuid primary key default gen_random_uuid(),
  "groupId" uuid not null references public."Group" ("groupId") on delete cascade,
  "fromUserId" uuid not null references public."User" ("userId") on delete cascade,
  "toUserId" uuid not null references public."User" ("userId") on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  "createdAt" timestamptz not null default now(),
  check ("fromUserId" <> "toUserId")
);

create index if not exists payment_reminder_to_idx
  on public."Payment_Reminder" ("toUserId", "createdAt" desc);
create index if not exists payment_reminder_pair_idx
  on public."Payment_Reminder" ("fromUserId", "toUserId", "groupId", "createdAt" desc);

alter table public."Payment_Reminder" enable row level security;

-- Sender and recipient can see a reminder. Nobody writes directly; only
-- send_payment_reminder (via the Edge Function) inserts.
drop policy if exists "Sender and recipient can view reminders" on public."Payment_Reminder";
create policy "Sender and recipient can view reminders" on public."Payment_Reminder"
  for select to authenticated
  using ((select auth.uid()) in ("fromUserId", "toUserId"));

revoke insert, update, delete, truncate on public."Payment_Reminder" from anon, authenticated;
grant select on public."Payment_Reminder" to authenticated;

-- Checks, rate limit and save in one transaction. Called by the Edge Function
-- with the verified caller id (service role only).
create or replace function public.send_payment_reminder(
  p_caller uuid,
  p_group_id uuid,
  p_to uuid,
  p_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_caller_net numeric;
  v_to_net numeric;
  v_amount numeric;
  v_last timestamptz;
  v_reminder public."Payment_Reminder";
  v_group text;
  v_from_name text;
  v_to_name text;
begin
  if p_caller = p_to then
    raise exception 'INVALID: You can''t remind yourself';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID: Amount must be more than zero';
  end if;

  select g.name into v_group
  from public."Group" g
  where g."groupId" = p_group_id and coalesce(g."isArchived", false) = false;
  if v_group is null then
    raise exception 'NOT_FOUND: Group not found or archived';
  end if;
  if (select count(*) from public."Group_Member" m
      where m."groupId" = p_group_id and m."userId" in (p_caller, p_to)) <> 2 then
    raise exception 'FORBIDDEN: You can only remind someone in the same group';
  end if;

  -- They must owe money in this group, and you must be owed.
  v_caller_net := public._group_net(p_group_id, p_caller);
  v_to_net := public._group_net(p_group_id, p_to);
  if v_caller_net <= 0 or v_to_net >= 0 then
    raise exception 'CONFLICT: They don''t owe you anything in this group anymore';
  end if;
  v_amount := round(least(p_amount, v_caller_net, -v_to_net), 2);

  -- One reminder per person per group every 12 hours.
  select max(r."createdAt") into v_last
  from public."Payment_Reminder" r
  where r."fromUserId" = p_caller and r."toUserId" = p_to and r."groupId" = p_group_id;
  if v_last is not null and v_last > now() - interval '12 hours' then
    raise exception 'CONFLICT: You already reminded them recently. You can send another after %',
      to_char((v_last + interval '12 hours') at time zone 'Asia/Manila', 'FMHH12:MI AM, Mon FMDD');
  end if;

  insert into public."Payment_Reminder" ("groupId", "fromUserId", "toUserId", amount)
  values (p_group_id, p_caller, p_to, v_amount)
  returning * into v_reminder;

  select u.name into v_from_name from public."User" u where u."userId" = p_caller;
  select u.name into v_to_name from public."User" u where u."userId" = p_to;

  return jsonb_build_object(
    'reminderId', v_reminder."reminderId",
    'amount', v_reminder.amount,
    'createdAt', v_reminder."createdAt",
    'groupName', v_group,
    'fromName', v_from_name,
    'toName', v_to_name
  );
end;
$function$;

revoke all on function public.send_payment_reminder(uuid, uuid, uuid, numeric) from public, anon, authenticated;
grant execute on function public.send_payment_reminder(uuid, uuid, uuid, numeric) to service_role;

-- Bell: reminders sent to you join the activity feed.
create or replace function public.list_activity_notifications(p_limit integer default 20)
returns table (
  activity_id uuid,
  group_id uuid,
  group_name text,
  actor_id uuid,
  actor_name text,
  action text,
  entity_id uuid,
  title text,
  amount numeric,
  currency text,
  your_share numeric,
  receiver_id uuid,
  receiver_name text,
  created_at timestamptz,
  unread boolean,
  unread_count bigint
)
language sql
stable
security invoker
set search_path to ''
as $function$
  with me as (
    select u."userId" as id, u."notificationsSeenAt" as seen
    from public."User" u
    where u."userId" = auth.uid()
  ),
  rows as (
    select a.*,
           case when a.details->>'receiverId' ~* '^[0-9a-f-]{36}$' then (a.details->>'receiverId')::uuid end as receiver,
           case when a.details->>'payerId' ~* '^[0-9a-f-]{36}$' then (a.details->>'payerId')::uuid end as payer,
           case when a.details->>'paidBy' ~* '^[0-9a-f-]{36}$' then (a.details->>'paidBy')::uuid end as paid_by
    from public."Group_Activity" a
    join public."Group_Member" gm on gm."groupId" = a."groupId"
    join me on gm."userId" = me.id
    where a."actorId" is distinct from me.id
      and a.action in ('expense_created', 'expense_updated', 'expense_deleted',
                       'settlement_recorded', 'settlement_updated', 'settlement_cancelled')
      and a."createdAt" > now() - interval '60 days'
  ),
  relevant as (
    select r.*, e.currency as expense_currency, mine."amountOwed" as share
    from rows r
    cross join me
    left join public."Expense" e on r."entityType" = 'expense' and e."expenseId" = r."entityId"
    left join public."Expense_Split" mine
      on r."entityType" = 'expense' and mine."expenseId" = r."entityId" and mine."userId" = me.id
    where case
      when r."entityType" = 'settlement' then me.id in (r.payer, r.receiver)
      else coalesce(mine."amountOwed", 0) > 0
        or r.paid_by = me.id
        or not exists (select 1 from public."Expense_Split" s where s."expenseId" = r."entityId")
    end
  ),
  feed as (
    select r."activityId" as activity_id, r."groupId" as group_id, r."actorId" as actor_id, r.action,
           r."entityId" as entity_id,
           coalesce(r.details->>'title', r.details#>>'{changes,title,to}') as title,
           coalesce(
             case when jsonb_typeof(r.details->'totalAmount') = 'number' then (r.details->>'totalAmount')::numeric end,
             case when jsonb_typeof(r.details->'amount') = 'number' then (r.details->>'amount')::numeric end,
             case when jsonb_typeof(r.details#>'{changes,totalAmount,to}') = 'number' then (r.details#>>'{changes,totalAmount,to}')::numeric end,
             case when jsonb_typeof(r.details#>'{changes,amount,to}') = 'number' then (r.details#>>'{changes,amount,to}')::numeric end,
             0) as amount,
           coalesce(r.expense_currency, 'PHP')::text as currency,
           coalesce(r.share, 0) as your_share,
           r.receiver as receiver_id,
           r."createdAt" as created_at
    from relevant r
    union all
    -- Someone reminded you to pay them.
    select pr."reminderId", pr."groupId", pr."fromUserId", 'payment_reminder', pr."reminderId",
           null, pr.amount, 'PHP', pr.amount, pr."toUserId", pr."createdAt"
    from public."Payment_Reminder" pr
    join me on pr."toUserId" = me.id
    where pr."createdAt" > now() - interval '60 days'
  )
  select f.activity_id, f.group_id, g.name::text, f.actor_id, au.name::text, f.action, f.entity_id,
         f.title, f.amount, f.currency, f.your_share, f.receiver_id, ru.name::text, f.created_at,
         f.created_at > me.seen,
         count(*) filter (where f.created_at > me.seen) over ()
  from feed f
  cross join me
  join public."Group" g on g."groupId" = f.group_id
  left join public."User" au on au."userId" = f.actor_id
  left join public."User" ru on ru."userId" = f.receiver_id
  order by f.created_at desc, f.activity_id
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$function$;

revoke all on function public.list_activity_notifications(integer) from public, anon;
grant execute on function public.list_activity_notifications(integer) to authenticated;

-- Live: the recipient's bell updates as soon as a reminder is saved.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'Payment_Reminder'
     ) then
    alter publication supabase_realtime add table public."Payment_Reminder";
  end if;
end $$;
