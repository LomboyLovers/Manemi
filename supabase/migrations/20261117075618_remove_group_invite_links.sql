-- Groups are joined only through friend invitations (invite_friends_to_group
-- + respond_group_invitation). Invite links/codes are removed.

-- 1. Code-based join and code generation
drop function if exists public.join_group_by_code(uuid, text);
drop function if exists public.join_group_with_code(character varying);
drop function if exists public.generate_group_invite_code(uuid);
-- Old email invite that also minted a code (replaced by invite_friends_to_group)
drop function if exists public.invite_users_to_group(uuid, uuid[]);

-- 2. New groups no longer get a code
create or replace function public.create_group_with_admin(p_caller uuid, p_name text)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_group "Group";
  v_role text;
begin
  if not exists (select 1 from "User" where "userId" = p_caller) then
    raise exception 'NOT_FOUND: User profile not found';
  end if;

  insert into "Group" (name, "createdBy")
  values (p_name, p_caller)
  returning * into v_group;

  -- Trigger on_group_created_add_owner adds the creator as owner
  select role::text into v_role from "Group_Member"
  where "groupId" = v_group."groupId" and "userId" = p_caller;
  if v_role is null then
    raise exception 'Owner membership was not created by trigger on_group_created_add_owner';
  end if;

  return jsonb_build_object('group', to_jsonb(v_group), 'role', v_role);
end; $function$;

revoke all on function public.create_group_with_admin(uuid, text) from public, anon, authenticated;
grant execute on function public.create_group_with_admin(uuid, text) to service_role;

-- 3. Existing codes stop meaning anything; clear them. (Columns are kept so
--    older Edge Function versions that read them don't break.)
update public."Group" set "inviteCode" = null, "inviteCodeExpiresAt" = null
where "inviteCode" is not null or "inviteCodeExpiresAt" is not null;

comment on column public."Group"."inviteCode" is 'Unused: invite links were removed (friends-only invitations).';
