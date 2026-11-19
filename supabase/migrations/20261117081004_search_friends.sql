-- Accepted friends, searched and paginated in the database.
-- SECURITY DEFINER like list_friends (friends' User rows aren't otherwise
-- readable unless you share a group); only the caller's own friendships are read.
create or replace function public.search_friends(
  p_query text default null,
  p_limit integer default 10,
  p_offset integer default 0
)
returns table (
  friendship_id uuid,
  user_id       uuid,
  name          varchar,
  user_code     varchar,
  avatar_url    varchar,
  created_at    timestamptz,
  total_count   bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with pat as (
    select case when nullif(btrim(coalesce(p_query, '')), '') is null then null
      else '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%' end as p
  )
  select f."friendshipId", u."userId", u.name, u."userCode", u."avatarUrl", f."createdAt",
         count(*) over ()
  from public."Friendship" f
  join public."User" u
    on u."userId" = case when f."requesterId" = (select auth.uid()) then f."addresseeId" else f."requesterId" end
  cross join pat
  where (select auth.uid()) in (f."requesterId", f."addresseeId")
    and f.status = 'accepted'
    and (pat.p is null or u.name ilike pat.p or u."userCode" ilike pat.p)
  order by lower(u.name), u."userId"
  limit greatest(1, least(coalesce(p_limit, 10), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.search_friends(text, integer, integer) from public, anon;
grant execute on function public.search_friends(text, integer, integer) to authenticated;
