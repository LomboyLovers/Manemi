-- =====================================================================
-- Friends-only group invitations
--
-- Rules:
--   * Only the group's owner or an admin can invite.
--   * Only people who are already their accepted friends can be invited
--     (a friend always has a Manemi account).
--   * Invited people accept or decline inside the app.
--
-- Invitations keep using the existing "Group_Invitation" table.
-- Old routes that skipped these rules are closed at the bottom.
-- =====================================================================


-- Is the signed-in user the owner or an admin of this group?
create or replace function public.is_group_manager(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public."Group_Member" m
    where m."groupId" = p_group_id
      and m."userId" = (select auth.uid())
      and m.role in ('owner', 'admin')
  );
$$;


-- Internal: is this user the owner or an admin of this group?
create or replace function public._is_group_manager_user(p_group_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public."Group_Member" m
    where m."groupId" = p_group_id
      and m."userId" = p_user_id
      and m.role in ('owner', 'admin')
  );
$$;
revoke all on function public._is_group_manager_user(uuid, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- Invite friends to a group. Returns one outcome per person:
--   invited | already_member | not_friend
-- People who aren't your accepted friends are skipped, never invited.
-- ---------------------------------------------------------------------
create or replace function public.invite_friends_to_group(p_group_id uuid, p_user_ids uuid[])
returns table (invitee_id uuid, outcome text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_group public."Group";
  v_id    uuid;
  v_email public.citext;
begin
  if v_me is null then
    raise exception 'FORBIDDEN: Sign in first';
  end if;
  if p_user_ids is null or cardinality(p_user_ids) = 0 then
    raise exception 'INVALID: Choose at least one friend to invite';
  end if;
  if cardinality(p_user_ids) > 50 then
    raise exception 'INVALID: You can invite up to 50 friends at a time';
  end if;

  select g.* into v_group from public."Group" g where g."groupId" = p_group_id;
  if not found then
    raise exception 'NOT_FOUND: Group not found';
  end if;
  if coalesce(v_group."isArchived", false) then
    raise exception 'INVALID: This group is archived';
  end if;
  if not public._is_group_manager_user(p_group_id, v_me) then
    raise exception 'FORBIDDEN: Only the group owner or an admin can invite people';
  end if;

  for v_id in select distinct x from unnest(p_user_ids) as x where x is not null loop
    if exists (
      select 1 from public."Group_Member" m
      where m."groupId" = p_group_id and m."userId" = v_id
    ) then
      invitee_id := v_id; outcome := 'already_member'; return next;
      continue;
    end if;

    if not public._are_friends(v_me, v_id) then
      invitee_id := v_id; outcome := 'not_friend'; return next;
      continue;
    end if;

    select u.email into v_email from public."User" u where u."userId" = v_id;

    -- One invitation per person per group; re-inviting refreshes it.
    insert into public."Group_Invitation" ("groupId", "invitedUserId", "invitedEmail", "invitedBy")
    values (p_group_id, v_id, v_email, v_me)
    on conflict ("groupId", "invitedEmail") do update
      set "invitedUserId" = excluded."invitedUserId",
          "invitedBy"     = excluded."invitedBy",
          "createdAt"     = now();

    invitee_id := v_id; outcome := 'invited'; return next;
  end loop;
end;
$$;


-- ---------------------------------------------------------------------
-- Your pending group invitations. Only valid ones are listed: the group
-- is active, the inviter is still its owner/admin and still your friend,
-- and you aren't a member yet.
-- ---------------------------------------------------------------------
create or replace function public.list_my_group_invitations()
returns table (
  invitation_id   uuid,
  group_id        uuid,
  group_name      varchar,
  member_count    integer,
  invited_by_id   uuid,
  invited_by_name varchar,
  created_at      timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i."invitationId",
    g."groupId",
    g.name,
    (select count(*)::int from public."Group_Member" m where m."groupId" = g."groupId"),
    i."invitedBy",
    inviter.name,
    i."createdAt"
  from public."Group_Invitation" i
  join public."Group" g on g."groupId" = i."groupId"
  join public."User" me on me."userId" = (select auth.uid())
  join public."User" inviter on inviter."userId" = i."invitedBy"
  where (i."invitedUserId" = me."userId" or lower(i."invitedEmail"::text) = lower(me.email::text))
    and not coalesce(g."isArchived", false)
    and public._is_group_manager_user(g."groupId", i."invitedBy")
    and public._are_friends(i."invitedBy", me."userId")
    and not exists (
      select 1 from public."Group_Member" m
      where m."groupId" = g."groupId" and m."userId" = me."userId"
    )
  order by i."createdAt" desc;
$$;


-- ---------------------------------------------------------------------
-- Accept (join as a member) or decline (delete) one of your invitations.
-- ---------------------------------------------------------------------
create or replace function public.respond_group_invitation(p_invitation_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := auth.uid();
  v_email  text;
  v_invite public."Group_Invitation";
  v_group  public."Group";
begin
  if v_me is null then
    raise exception 'FORBIDDEN: Sign in first';
  end if;

  select lower(u.email::text) into v_email from public."User" u where u."userId" = v_me;

  select i.* into v_invite
  from public."Group_Invitation" i
  where i."invitationId" = p_invitation_id
    and (i."invitedUserId" = v_me or lower(i."invitedEmail"::text) = v_email)
  for update;

  if not found then
    raise exception 'NOT_FOUND: This invitation no longer exists';
  end if;

  if not coalesce(p_accept, false) then
    delete from public."Group_Invitation" where "invitationId" = p_invitation_id;
    return jsonb_build_object('accepted', false, 'groupId', v_invite."groupId");
  end if;

  select g.* into v_group from public."Group" g where g."groupId" = v_invite."groupId";
  if not found or coalesce(v_group."isArchived", false) then
    raise exception 'INVALID: This group is no longer active';
  end if;
  if not public._is_group_manager_user(v_invite."groupId", v_invite."invitedBy")
     or not public._are_friends(v_invite."invitedBy", v_me) then
    raise exception 'FORBIDDEN: This invitation is no longer valid. Ask a friend who owns or manages the group to invite you again';
  end if;

  insert into public."Group_Member" ("groupId", "userId", role)
  values (v_invite."groupId", v_me, 'member')
  on conflict ("groupId", "userId") do nothing;

  -- Clear every invitation to this group for you.
  delete from public."Group_Invitation" i
  where i."groupId" = v_invite."groupId"
    and (i."invitedUserId" = v_me or lower(i."invitedEmail"::text) = v_email);

  return jsonb_build_object('accepted', true, 'groupId', v_group."groupId", 'groupName', v_group.name);
end;
$$;


-- Client-callable functions: signed-in users only.
revoke all on function public.is_group_manager(uuid) from public, anon;
revoke all on function public.invite_friends_to_group(uuid, uuid[]) from public, anon;
revoke all on function public.list_my_group_invitations() from public, anon;
revoke all on function public.respond_group_invitation(uuid, boolean) from public, anon;
grant execute on function public.is_group_manager(uuid) to authenticated;
grant execute on function public.invite_friends_to_group(uuid, uuid[]) to authenticated;
grant execute on function public.list_my_group_invitations() to authenticated;
grant execute on function public.respond_group_invitation(uuid, boolean) to authenticated;


-- =====================================================================
-- Close the old routes that skipped these rules
-- =====================================================================

-- Joining with an invite code (used by the join-group edge function) now
-- also needs the invitation to come from a friend who owns/manages the
-- group. Everything else is unchanged from the current version.
create or replace function public.join_group_by_code(p_caller uuid, p_invite_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group  public."Group";
  v_member public."Group_Member";
  v_email  text;
begin
  select * into v_group
  from public."Group"
  where lower("inviteCode") = lower(p_invite_code);

  if not found then
    raise exception 'NOT_FOUND: Invalid invite code';
  end if;

  if coalesce(v_group."isArchived", false) then
    raise exception 'INVALID: This group is archived';
  end if;

  if v_group."inviteCodeExpiresAt" is not null
     and v_group."inviteCodeExpiresAt" < now() then
    raise exception 'INVALID: This invite code has expired';
  end if;

  if exists (
    select 1 from public."Group_Member"
    where "groupId" = v_group."groupId" and "userId" = p_caller
  ) then
    raise exception 'CONFLICT: You are already a member of this group';
  end if;

  select lower(trim(email)) into v_email
  from auth.users
  where id = p_caller and email_confirmed_at is not null;

  if v_email is null then
    raise exception 'FORBIDDEN: Please verify your email before joining';
  end if;

  -- NEW: the invitation must come from a friend who owns/manages the group.
  if not exists (
    select 1 from public."Group_Invitation" i
    where i."groupId" = v_group."groupId"
      and lower(trim(i."invitedEmail"::text)) = v_email
      and public._is_group_manager_user(i."groupId", i."invitedBy")
      and public._are_friends(i."invitedBy", p_caller)
  ) then
    raise exception 'FORBIDDEN: You can only join a group when a friend who owns or manages it invites you';
  end if;

  insert into public."Group_Member" ("groupId", "userId")
  values (v_group."groupId", p_caller)
  returning * into v_member;

  delete from public."Group_Invitation"
  where "groupId" = v_group."groupId"
    and lower(trim("invitedEmail"::text)) = v_email;

  return jsonb_build_object('group', to_jsonb(v_group), 'member', to_jsonb(v_member));
end;
$$;
-- Unchanged: only the server (edge function) may call it.
revoke all on function public.join_group_by_code(uuid, text) from public, anon, authenticated;

-- Invited anyone by user id, with no friend or role check. Not used by the app.
revoke execute on function public.invite_users_to_group(uuid, uuid[]) from public, anon, authenticated;

-- Joined on any invitation, with no friend check. Not used by the app.
revoke execute on function public.join_group_with_code(character varying) from public, anon, authenticated;

-- Let anyone (even signed-out visitors) list users by code prefix. Not used
-- by the app; friend requests use exact lookups instead.
revoke execute on function public.search_user_codes(character varying, integer) from public, anon, authenticated;

-- Invite codes are no longer the gate; signed-out visitors don't need this.
revoke execute on function public.generate_group_invite_code(uuid) from public, anon;
