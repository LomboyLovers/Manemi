-- GROUP-04: the owner, and admins, can remove members (Members sheet in the
-- group's ••• menu). Admins can remove regular members only, never the owner
-- or another admin. Everything else is unchanged: nobody removes themselves,
-- the member must be settled up, history is kept, and it's logged.
create or replace function public.remove_group_member(p_group_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := auth.uid();
  v_my_role text;
  v_target text;
  v_net    numeric;
  v_name   text;
begin
  if v_me is null then raise exception 'FORBIDDEN: Sign in first'; end if;
  select m.role::text into v_my_role from public."Group_Member" m
  where m."groupId" = p_group_id and m."userId" = v_me;
  if v_my_role is null or v_my_role not in ('owner', 'admin') then
    raise exception 'FORBIDDEN: Only the group owner or an admin can remove members';
  end if;
  if exists (select 1 from public."Group" g where g."groupId" = p_group_id and coalesce(g."isArchived", false)) then
    raise exception 'INVALID: Archived groups can''t change members';
  end if;
  if p_user_id = v_me then
    raise exception 'INVALID: You can''t remove yourself. Leave or archive the group instead';
  end if;

  select m.role::text into v_target from public."Group_Member" m
  where m."groupId" = p_group_id and m."userId" = p_user_id for update;
  if v_target is null then raise exception 'NOT_FOUND: That person isn''t in this group'; end if;
  if v_target = 'owner' then raise exception 'FORBIDDEN: The owner can''t be removed'; end if;
  if v_my_role = 'admin' and v_target <> 'member' then
    raise exception 'FORBIDDEN: Admins can only remove regular members';
  end if;

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
