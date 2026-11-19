-- Group categories (Travel, Roommates, Group Dinners, Events, Other) and a
-- single-call group search that runs in the database.

-- 1. Category column. Existing groups become "Other".
alter table public."Group"
  add column if not exists category text not null default 'Other';

alter table public."Group"
  drop constraint if exists group_category_check;
alter table public."Group"
  add constraint group_category_check
  check (category in ('Travel', 'Roommates', 'Group Dinners', 'Events', 'Other'));

-- 2. Create a group with a category (the create-group Edge Function calls this).
--    Same behaviour as before; the category defaults to "Other".
drop function if exists public.create_group_with_admin(uuid, text);
create or replace function public.create_group_with_admin(
  p_caller uuid,
  p_name text,
  p_category text default 'Other'
)
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
  if coalesce(p_category, 'Other') not in ('Travel', 'Roommates', 'Group Dinners', 'Events', 'Other') then
    raise exception 'INVALID: Unknown group category';
  end if;

  insert into "Group" (name, "createdBy", category)
  values (p_name, p_caller, coalesce(p_category, 'Other'))
  returning * into v_group;

  -- Trigger on_group_created_add_owner adds the creator as owner
  select role::text into v_role from "Group_Member"
  where "groupId" = v_group."groupId" and "userId" = p_caller;
  if v_role is null then
    raise exception 'Owner membership was not created by trigger on_group_created_add_owner';
  end if;

  return jsonb_build_object('group', to_jsonb(v_group), 'role', v_role);
end; $function$;

revoke all on function public.create_group_with_admin(uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_group_with_admin(uuid, text, text) to service_role;

-- 3. Owners and admins change a group's category.
create or replace function public.set_group_category(p_group_id uuid, p_category text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if p_category is null or p_category not in ('Travel', 'Roommates', 'Group Dinners', 'Events', 'Other') then
    raise exception 'Choose Travel, Roommates, Group Dinners, Events, or Other.' using errcode = '22023';
  end if;

  select gm.role::text into v_role
  from "Group_Member" gm
  where gm."groupId" = p_group_id and gm."userId" = auth.uid();

  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception 'Only the group owner or an admin can change the category.' using errcode = '42501';
  end if;

  update "Group" set category = p_category
  where "groupId" = p_group_id and coalesce("isArchived", false) = false;
  if not found then
    raise exception 'Archived groups cannot be changed.' using errcode = '22023';
  end if;

  return p_category;
end; $function$;

revoke all on function public.set_group_category(uuid, text) from public, anon;
grant execute on function public.set_group_category(uuid, text) to authenticated;

-- 4. Group search in one round trip: groups you belong to whose name, or one
--    of whose expense titles, contains the query. Runs as the caller, so the
--    existing row-level security decides what is visible.
create or replace function public.search_group_ids(p_query text)
returns setof uuid
language sql
stable
security invoker
set search_path to 'public'
as $function$
  with q as (
    select '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern
    where length(btrim(coalesce(p_query, ''))) > 0
  )
  select g."groupId"
  from "Group" g, q
  where g.name ilike q.pattern
  union
  select e."groupId"
  from "Expense" e, q
  where e."groupId" is not null and e.title ilike q.pattern;
$function$;

revoke all on function public.search_group_ids(text) from public, anon;
grant execute on function public.search_group_ids(text) to authenticated;

-- 5. Trigram indexes so "contains" search stays fast as groups and expenses grow.
create extension if not exists pg_trgm with schema extensions;
create index if not exists group_name_trgm_idx
  on public."Group" using gin (name extensions.gin_trgm_ops);
create index if not exists expense_title_trgm_idx
  on public."Expense" using gin (title extensions.gin_trgm_ops)
  where "groupId" is not null;
