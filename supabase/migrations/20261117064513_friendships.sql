-- =====================================================================
-- Friends
--
-- One "Friendship" row per pair of users. A request starts as 'pending'
-- (requester -> addressee) and becomes 'accepted' when the addressee
-- accepts. Declining, cancelling and unfriending delete the row.
--
-- Clients can only READ their own rows. Every change goes through the
-- functions below, which run the checks.
-- =====================================================================

create table public."Friendship" (
  "friendshipId" uuid primary key default gen_random_uuid(),
  "requesterId"  uuid not null references public."User"("userId") on delete cascade,
  "addresseeId"  uuid not null references public."User"("userId") on delete cascade,
  status         text not null default 'pending'
                 check (status in ('pending', 'accepted')),
  "createdAt"    timestamptz not null default now(),
  "respondedAt"  timestamptz,
  constraint "Friendship_not_self" check ("requesterId" <> "addresseeId")
);

-- One row per pair, whichever direction the request went.
create unique index "Friendship_pair_key"
  on public."Friendship" (least("requesterId", "addresseeId"), greatest("requesterId", "addresseeId"));
create index "Friendship_requester_idx" on public."Friendship" ("requesterId");
create index "Friendship_addressee_idx" on public."Friendship" ("addresseeId");

alter table public."Friendship" enable row level security;

-- Supabase grants everything on new tables by default; clients only read.
revoke all on table public."Friendship" from anon, authenticated;
grant select on table public."Friendship" to authenticated;

create policy "Users can view their own friendships"
  on public."Friendship" for select to authenticated
  using ((select auth.uid()) in ("requesterId", "addresseeId"));


-- ---------------------------------------------------------------------
-- Internal helper: are two users accepted friends?
-- Not callable by clients (it could reveal other people's friendships).
-- ---------------------------------------------------------------------
create or replace function public._are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public."Friendship" f
    where least(f."requesterId", f."addresseeId") = least(a, b)
      and greatest(f."requesterId", f."addresseeId") = greatest(a, b)
      and f.status = 'accepted'
  );
$$;
revoke all on function public._are_friends(uuid, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- Send a friend request by user code (e.g. U-00012 or @U-00012) or email.
-- If that person already sent YOU a request, this accepts it instead.
-- ---------------------------------------------------------------------
create or replace function public.send_friend_request(p_identifier text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me       uuid := auth.uid();
  v_query    text := regexp_replace(trim(coalesce(p_identifier, '')), '^@', '');
  v_target   public."User";
  v_existing public."Friendship";
  v_row      public."Friendship";
begin
  if v_me is null then
    raise exception 'FORBIDDEN: Sign in first';
  end if;
  if v_query = '' or length(v_query) > 320 then
    raise exception 'INVALID: Enter a user code or email address';
  end if;

  select u.* into v_target
  from public."User" u
  where lower(u."userCode") = lower(v_query)
     or lower(u.email::text) = lower(v_query)
  limit 1;

  if not found then
    raise exception 'NOT_FOUND: No Manemi account uses that code or email';
  end if;
  if v_target."userId" = v_me then
    raise exception 'INVALID: You can''t add yourself as a friend';
  end if;

  select f.* into v_existing
  from public."Friendship" f
  where least(f."requesterId", f."addresseeId") = least(v_me, v_target."userId")
    and greatest(f."requesterId", f."addresseeId") = greatest(v_me, v_target."userId")
  for update;

  if found then
    if v_existing.status = 'accepted' then
      raise exception 'CONFLICT: You''re already friends';
    elsif v_existing."requesterId" = v_me then
      raise exception 'CONFLICT: You already sent this person a request';
    end if;
    -- They asked first: accept their request.
    update public."Friendship"
       set status = 'accepted', "respondedAt" = now()
     where "friendshipId" = v_existing."friendshipId"
    returning * into v_row;
  else
    begin
      insert into public."Friendship" ("requesterId", "addresseeId")
      values (v_me, v_target."userId")
      returning * into v_row;
    exception when unique_violation then
      raise exception 'CONFLICT: A request between you two already exists';
    end;
  end if;

  return jsonb_build_object(
    'friendshipId', v_row."friendshipId",
    'status', v_row.status,
    'user', jsonb_build_object(
      'userId', v_target."userId",
      'name', v_target.name,
      'userCode', v_target."userCode",
      'avatarUrl', v_target."avatarUrl"
    )
  );
end;
$$;


-- ---------------------------------------------------------------------
-- Accept or decline a request sent to you. Declining deletes it.
-- ---------------------------------------------------------------------
create or replace function public.respond_friend_request(p_friendship_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me  uuid := auth.uid();
  v_row public."Friendship";
begin
  if v_me is null then
    raise exception 'FORBIDDEN: Sign in first';
  end if;

  select f.* into v_row
  from public."Friendship" f
  where f."friendshipId" = p_friendship_id
    and f."addresseeId" = v_me
    and f.status = 'pending'
  for update;

  if not found then
    raise exception 'NOT_FOUND: This friend request no longer exists';
  end if;

  if coalesce(p_accept, false) then
    update public."Friendship"
       set status = 'accepted', "respondedAt" = now()
     where "friendshipId" = p_friendship_id
    returning * into v_row;
    return jsonb_build_object('friendshipId', v_row."friendshipId", 'status', 'accepted');
  end if;

  delete from public."Friendship" where "friendshipId" = p_friendship_id;
  return jsonb_build_object('friendshipId', p_friendship_id, 'status', 'declined');
end;
$$;


-- ---------------------------------------------------------------------
-- Cancel a request you sent, or unfriend someone. Either side can do it.
-- Group memberships are not affected.
-- ---------------------------------------------------------------------
create or replace function public.remove_friendship(p_friendship_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'FORBIDDEN: Sign in first';
  end if;

  delete from public."Friendship" f
  where f."friendshipId" = p_friendship_id
    and v_me in (f."requesterId", f."addresseeId");

  if not found then
    raise exception 'NOT_FOUND: This friend or request no longer exists';
  end if;
end;
$$;


-- ---------------------------------------------------------------------
-- Your friends and requests, with each person's public profile.
-- direction: 'friend' | 'incoming' (they asked you) | 'outgoing' (you asked)
-- ---------------------------------------------------------------------
create or replace function public.list_friends()
returns table (
  friendship_id uuid,
  user_id       uuid,
  name          varchar,
  user_code     varchar,
  avatar_url    varchar,
  direction     text,
  created_at    timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    f."friendshipId",
    u."userId",
    u.name,
    u."userCode",
    u."avatarUrl",
    case
      when f.status = 'accepted' then 'friend'
      when f."addresseeId" = (select auth.uid()) then 'incoming'
      else 'outgoing'
    end,
    f."createdAt"
  from public."Friendship" f
  join public."User" u
    on u."userId" = case
                      when f."requesterId" = (select auth.uid()) then f."addresseeId"
                      else f."requesterId"
                    end
  where (select auth.uid()) in (f."requesterId", f."addresseeId")
  order by f.status = 'accepted', lower(u.name);
$$;


-- Client-callable functions: signed-in users only.
revoke all on function public.send_friend_request(text) from public, anon;
revoke all on function public.respond_friend_request(uuid, boolean) from public, anon;
revoke all on function public.remove_friendship(uuid) from public, anon;
revoke all on function public.list_friends() from public, anon;
grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.remove_friendship(uuid) to authenticated;
grant execute on function public.list_friends() to authenticated;
