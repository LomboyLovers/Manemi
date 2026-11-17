-- Server-side search + pagination for History, the audit log and Home search.
-- SECURITY INVOKER: row-level security still decides what each user can see;
-- the explicit membership filter just lets Postgres use the indexes.

create or replace function public.search_history(
  p_kind text default 'all',          -- all | expenses | payments
  p_group_id uuid default null,
  p_query text default null,
  p_only_mine boolean default false,
  p_sort text default 'newest',       -- newest | oldest | largest
  p_limit integer default 10,
  p_offset integer default 0
)
returns table (
  kind text, id uuid, group_id uuid, group_name text, title text, amount numeric,
  category text, happened_at timestamptz, payer_id uuid, payer_name text,
  receiver_id uuid, receiver_name text, payment_method text, your_share numeric,
  involves_you boolean, total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with me as (select auth.uid() as id),
  my_groups as (
    select gm."groupId"
    from public."Group_Member" gm, me
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
             -- older expenses without split rows: shared by everyone in the group
             when not exists (select 1 from public."Expense_Split" s3 where s3."expenseId" = e."expenseId")
             then round(e."totalAmount" / nullif((select count(*) from public."Group_Member" m
                                                   where m."groupId" = e."groupId"), 0), 2)
             else 0 end) as your_share
    from public."Expense" e
    join my_groups mg on mg."groupId" = e."groupId"
    join public."Group" g on g."groupId" = e."groupId"
    left join public."User" pu on pu."userId" = e."paidBy_UserId"
    where coalesce(p_kind, 'all') in ('all', 'expenses')
  ),
  payments as (
    select 'payment'::text, st."settlementId", st."groupId", g.name::text,
           null::text, st.amount, null::text,
           coalesce(st."settledAt", st."createdAt"), st."payerId", pu.name::text,
           st."receiverId", ru.name::text, st."paymentMethod"::text, 0::numeric
    from public."Settlement" st
    join my_groups mg on mg."groupId" = st."groupId"
    join public."Group" g on g."groupId" = st."groupId"
    left join public."User" pu on pu."userId" = st."payerId"
    left join public."User" ru on ru."userId" = st."receiverId"
    where st.status = 'completed' and coalesce(p_kind, 'all') in ('all', 'payments')
  ),
  filtered as (
    select r.*, (r.payer_id = me.id or r.receiver_id = me.id or r.your_share > 0) as involves_you
    from (select * from expenses union all select * from payments) r, me, pat
    where (pat.p is null
           or r.title ilike pat.p or r.group_name ilike pat.p
           or r.payer_name ilike pat.p or r.receiver_name ilike pat.p)
  )
  select f.kind, f.id, f.group_id, f.group_name, f.title, f.amount, f.category, f.happened_at,
         f.payer_id, f.payer_name, f.receiver_id, f.receiver_name, f.payment_method,
         f.your_share, f.involves_you, count(*) over () as total_count
  from filtered f
  where not coalesce(p_only_mine, false) or f.involves_you
  order by case when p_sort = 'largest' then f.amount end desc nulls last,
           case when p_sort = 'oldest' then f.happened_at end asc,
           f.happened_at desc, f.id
  limit greatest(1, least(coalesce(p_limit, 10), 50))
  offset greatest(0, coalesce(p_offset, 0));
$$;

create or replace function public.search_activity(
  p_group_id uuid default null,
  p_query text default null,
  p_only_mine boolean default false,
  p_sort text default 'newest',       -- newest | oldest | largest
  p_limit integer default 10,
  p_offset integer default 0
)
returns table (
  activity_id uuid, group_id uuid, group_name text, actor_id uuid, actor_name text,
  action text, entity_type text, entity_id uuid, details jsonb, created_at timestamptz,
  amount numeric, payer_name text, receiver_name text, paid_by_name text,
  involves_you boolean, total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with me as (select auth.uid() as id),
  my_groups as (
    select gm."groupId"
    from public."Group_Member" gm, me
    where gm."userId" = me.id and (p_group_id is null or gm."groupId" = p_group_id)
  ),
  pat as (
    select case when nullif(btrim(coalesce(p_query, '')), '') is null then null
      else '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%' end as p
  ),
  rows as (
    select a."activityId", a."groupId", g.name::text as group_name, a."actorId", au.name::text as actor_name,
           a.action, a."entityType", a."entityId", a.details, a."createdAt",
           coalesce(
             case when jsonb_typeof(a.details->'totalAmount') = 'number' then (a.details->>'totalAmount')::numeric end,
             case when jsonb_typeof(a.details->'amount') = 'number' then (a.details->>'amount')::numeric end,
             case when jsonb_typeof(a.details#>'{changes,totalAmount,to}') = 'number' then (a.details#>>'{changes,totalAmount,to}')::numeric end,
             case when jsonb_typeof(a.details#>'{changes,amount,to}') = 'number' then (a.details#>>'{changes,amount,to}')::numeric end,
             0) as amount,
           pu.name::text as payer_name, ru.name::text as receiver_name, bu.name::text as paid_by_name,
           (me.id in (a."actorId",
                      (case when a.details->>'payerId' ~* '^[0-9a-f-]{36}$' then (a.details->>'payerId')::uuid end),
                      (case when a.details->>'receiverId' ~* '^[0-9a-f-]{36}$' then (a.details->>'receiverId')::uuid end),
                      (case when a.details->>'paidBy' ~* '^[0-9a-f-]{36}$' then (a.details->>'paidBy')::uuid end))) as involves_you
    from public."Group_Activity" a
    join my_groups mg on mg."groupId" = a."groupId"
    join public."Group" g on g."groupId" = a."groupId"
    cross join me
    left join public."User" au on au."userId" = a."actorId"
    left join public."User" pu on pu."userId" = (case when a.details->>'payerId' ~* '^[0-9a-f-]{36}$' then (a.details->>'payerId')::uuid end)
    left join public."User" ru on ru."userId" = (case when a.details->>'receiverId' ~* '^[0-9a-f-]{36}$' then (a.details->>'receiverId')::uuid end)
    left join public."User" bu on bu."userId" = (case when a.details->>'paidBy' ~* '^[0-9a-f-]{36}$' then (a.details->>'paidBy')::uuid end)
  )
  select r."activityId", r."groupId", r.group_name, r."actorId", r.actor_name, r.action, r."entityType",
         r."entityId", r.details, r."createdAt", r.amount, r.payer_name, r.receiver_name, r.paid_by_name,
         coalesce(r.involves_you, false), count(*) over ()
  from rows r, pat
  where (pat.p is null
         or r.details->>'title' ilike pat.p or r.group_name ilike pat.p
         or r.actor_name ilike pat.p or r.payer_name ilike pat.p or r.receiver_name ilike pat.p)
    and (not coalesce(p_only_mine, false) or coalesce(r.involves_you, false))
  order by case when p_sort = 'largest' then r.amount end desc nulls last,
           case when p_sort = 'oldest' then r."createdAt" end asc,
           r."createdAt" desc, r."activityId"
  limit greatest(1, least(coalesce(p_limit, 10), 50))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.search_history(text, uuid, text, boolean, text, integer, integer) from public, anon;
revoke all on function public.search_activity(uuid, text, boolean, text, integer, integer) from public, anon;
grant execute on function public.search_history(text, uuid, text, boolean, text, integer, integer) to authenticated;
grant execute on function public.search_activity(uuid, text, boolean, text, integer, integer) to authenticated;

-- Indexes for the date-ordered lists and for searching by name.
create index if not exists idx_expense_group_date on public."Expense" ("groupId", "expenseDate" desc);
create index if not exists idx_settlement_group on public."Settlement" ("groupId");
create index if not exists idx_expense_split_expense on public."Expense_Split" ("expenseId");
