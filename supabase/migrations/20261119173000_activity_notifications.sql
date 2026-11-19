-- In-app notifications for group activity (NOTIF): new, edited and deleted
-- expenses that include you, and payments you made or received, entered by
-- someone else. Read state is stored per user so it follows you across devices.

alter table public."User"
  add column if not exists "notificationsSeenAt" timestamptz not null default now();

-- Newest first. `unread` = after the last time you opened the bell.
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
      -- Expenses: you have a share, you paid, or it has no split rows
      -- (shared by the whole group, or already deleted).
      else coalesce(mine."amountOwed", 0) > 0
        or r.paid_by = me.id
        or not exists (select 1 from public."Expense_Split" s where s."expenseId" = r."entityId")
    end
  )
  select r."activityId", r."groupId", g.name::text, r."actorId", au.name::text, r.action, r."entityId",
         coalesce(r.details->>'title', r.details#>>'{changes,title,to}'),
         coalesce(
           case when jsonb_typeof(r.details->'totalAmount') = 'number' then (r.details->>'totalAmount')::numeric end,
           case when jsonb_typeof(r.details->'amount') = 'number' then (r.details->>'amount')::numeric end,
           case when jsonb_typeof(r.details#>'{changes,totalAmount,to}') = 'number' then (r.details#>>'{changes,totalAmount,to}')::numeric end,
           case when jsonb_typeof(r.details#>'{changes,amount,to}') = 'number' then (r.details#>>'{changes,amount,to}')::numeric end,
           0),
         coalesce(r.expense_currency, 'PHP')::text,
         coalesce(r.share, 0),
         r.receiver,
         ru.name::text,
         r."createdAt",
         r."createdAt" > me.seen,
         count(*) filter (where r."createdAt" > me.seen) over ()
  from relevant r
  cross join me
  join public."Group" g on g."groupId" = r."groupId"
  left join public."User" au on au."userId" = r."actorId"
  left join public."User" ru on ru."userId" = r.receiver
  order by r."createdAt" desc, r."activityId"
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$function$;

revoke all on function public.list_activity_notifications(integer) from public, anon;
grant execute on function public.list_activity_notifications(integer) to authenticated;

-- Opening the bell marks everything up to now as read.
create or replace function public.mark_notifications_seen()
returns timestamptz
language sql
security definer
set search_path to ''
as $function$
  update public."User" set "notificationsSeenAt" = now()
  where "userId" = auth.uid()
  returning "notificationsSeenAt";
$function$;

revoke all on function public.mark_notifications_seen() from public, anon;
grant execute on function public.mark_notifications_seen() to authenticated;

create index if not exists group_activity_group_created_idx
  on public."Group_Activity" ("groupId", "createdAt" desc);
