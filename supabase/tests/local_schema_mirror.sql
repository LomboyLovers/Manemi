-- Minimal local mirror of the live Manemi schema (as read on 2026-11-17),
-- used only to test migrations on a throwaway Postgres. Not a migration.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema auth;
create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
-- Same lookup Supabase uses.
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create extension citext schema public;
grant usage on schema public to anon, authenticated, service_role;

-- Supabase's defaults: new tables/functions in public are fully granted.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create type public.group_role as enum ('admin', 'member', 'owner');
create sequence public.user_code_seq;

create table public."User" (
  "userId" uuid primary key references auth.users(id),
  "userCode" varchar unique default ('U-' || lpad(nextval('public.user_code_seq')::text, 5, '0')),
  name varchar not null,
  email public.citext not null unique,
  "avatarUrl" varchar
);
create table public."Group" (
  "groupId" uuid primary key default gen_random_uuid(),
  "createdBy" uuid not null references public."User"("userId"),
  name varchar not null,
  "inviteCode" varchar,
  "inviteCodeExpiresAt" timestamptz,
  "isArchived" boolean default false,
  "createdAt" timestamptz default now()
);
create table public."Group_Member" (
  "memberId" uuid primary key default gen_random_uuid(),
  "groupId" uuid not null references public."Group"("groupId"),
  "userId" uuid not null references public."User"("userId"),
  role public.group_role not null default 'member',
  "joinedAt" timestamptz default now(),
  unique ("groupId", "userId")
);
create table public."Group_Invitation" (
  "invitationId" uuid primary key default gen_random_uuid(),
  "groupId" uuid not null references public."Group"("groupId"),
  "invitedUserId" uuid references public."User"("userId"),
  "invitedEmail" public.citext not null,
  "invitedBy" uuid not null references public."User"("userId"),
  "createdAt" timestamptz default now(),
  unique ("groupId", "invitedEmail")
);

create function public.is_group_member(gid uuid) returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from "Group_Member" where "groupId" = gid and "userId" = (select auth.uid()));
$$;
create function public.shares_group_with(other uuid) returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from "Group_Member" a join "Group_Member" b on b."groupId" = a."groupId"
                 where a."userId" = (select auth.uid()) and b."userId" = other);
$$;

alter table public."User" enable row level security;
alter table public."Group" enable row level security;
alter table public."Group_Member" enable row level security;
alter table public."Group_Invitation" enable row level security;
create policy "Users can view themselves and group mates" on public."User" for select to authenticated
  using (("userId" = (select auth.uid())) or shares_group_with("userId"));
create policy "Users update self" on public."User" for update to authenticated using ("userId" = auth.uid());
create policy "Members can view their groups" on public."Group" for select to authenticated using (is_group_member("groupId"));
create policy "Members can view group members" on public."Group_Member" for select to authenticated using (is_group_member("groupId"));
create policy "Members and invitees can view invitations" on public."Group_Invitation" for select to authenticated
  using (("invitedUserId" = (select auth.uid())) or is_group_member("groupId"));

create function public.handle_group_owner_creation() returns trigger language plpgsql security definer as $$
begin
  insert into public."Group_Member" ("groupId", "userId", "role") values (new."groupId", new."createdBy", 'owner');
  return new;
end; $$;
create trigger on_group_created_add_owner after insert on public."Group" for each row execute function public.handle_group_owner_creation();

-- Old functions, as they exist live (bodies trimmed to their effect).
create function public.invite_users_to_group(p_group_id uuid, p_user_ids uuid[])
returns table(invitecode varchar, expiresat timestamptz) language plpgsql security definer set search_path to 'public' as $$
declare v_user_id uuid; v_email citext;
begin
  if not exists (select 1 from "Group_Member" where "groupId" = p_group_id and "userId" = auth.uid()) then
    raise exception 'Unauthorized to invite users to this group.';
  end if;
  foreach v_user_id in array p_user_ids loop
    select "email" into v_email from "User" where "userId" = v_user_id;
    insert into "Group_Invitation" ("groupId", "invitedUserId", "invitedEmail", "invitedBy")
    values (p_group_id, v_user_id, v_email, auth.uid()) on conflict ("groupId", "invitedEmail") do nothing;
  end loop;
  return query select 'x'::varchar, now();
end; $$;
create function public.join_group_with_code(p_invite_code varchar) returns uuid language plpgsql security definer set search_path to 'public' as $$
begin return null; end; $$;
create function public.search_user_codes(p_query varchar, p_limit integer default 15)
returns table("userId" uuid, "userCode" varchar, name varchar, "avatarUrl" varchar) language plpgsql security definer set search_path to 'public' as $$
begin return query select u."userId", u."userCode", u."name", u."avatarUrl" from "User" u where u."userCode" ilike p_query || '%' limit p_limit; end; $$;
create function public.generate_group_invite_code(p_group_id uuid)
returns table(invitecode varchar, expiresat timestamptz) language plpgsql security definer set search_path to 'public' as $$
begin return query select 'x'::varchar, now(); end; $$;
create function public.join_group_by_code(p_caller uuid, p_invite_code text) returns jsonb language plpgsql security definer set search_path to '' as $$
begin return null; end; $$;
revoke all on function public.join_group_by_code(uuid, text) from public, anon, authenticated;
