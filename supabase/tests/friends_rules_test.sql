-- Tests for the friends + friends-only invitations migrations.
-- Run against a local copy of the schema (local_schema_mirror.sql), never production:
--   psql -v ON_ERROR_STOP=1 -f local_schema_mirror.sql -f ../migrations/20261117064513_friendships.sql \
--     -f ../migrations/20261117064616_friends_only_group_invitations.sql -f ../migrations/20261117075618_remove_group_invite_links.sql -f friends_rules_test.sql
\set ON_ERROR_STOP 1
set client_min_messages = warning;

-- People: A owns group G, B is a plain member of G, C is a stranger,
-- D and E become A's friends, F is a friend of B only.
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com', now()),
  ('00000000-0000-0000-0000-00000000000b', 'ben@example.com', now()),
  ('00000000-0000-0000-0000-00000000000c', 'cat@example.com', now()),
  ('00000000-0000-0000-0000-00000000000d', 'Dan@Example.com', now()),
  ('00000000-0000-0000-0000-00000000000e', 'eve@example.com', now()),
  ('00000000-0000-0000-0000-00000000000f', 'fin@example.com', now());
insert into public."User" ("userId", name, email)
select id, initcap(split_part(email, '@', 1)), email from auth.users order by lower(email);
-- codes: ana U-00001, ben U-00002, cat U-00003, Dan U-00004, eve U-00005, fin U-00006

insert into public."Group" ("groupId", "createdBy", name)
values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Korea 2026');
insert into public."Group_Member" ("groupId", "userId") values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b');
insert into public."Group" ("groupId", "createdBy", name, "isArchived")
values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'Old trip', true);

-- Helpers (test only).
create function pg_temp.act_as(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p::text, ''), false);
$$;
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'pass: %', label;
end $$;
create function pg_temp.fails(stmt text, pattern text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL (no error): %', label;
exception when others then
  if sqlerrm like 'FAIL (no error)%' then raise; end if;
  if sqlerrm !~* pattern then raise exception 'FAIL: % (got: %)', label, sqlerrm; end if;
  raise notice 'pass: %', label;
end $$;
grant execute on all functions in schema pg_temp to anon, authenticated;
set client_min_messages = notice;

-- ============ signed out ============
set role anon;
select pg_temp.act_as(null);
select pg_temp.fails($$select public.send_friend_request('U-00002')$$, 'permission denied', 'signed-out users cannot send friend requests');
select pg_temp.fails($$select * from public.search_user_codes('U-', 15)$$, 'permission denied', 'signed-out users can no longer list users by code');
select pg_temp.fails($$select * from public."Friendship"$$, 'permission denied', 'signed-out users cannot read friendships');
reset role;

-- ============ friend requests ============
set role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select pg_temp.fails($$select public.send_friend_request('U-00001')$$, 'add yourself', 'cannot friend yourself');
select pg_temp.fails($$select public.send_friend_request('nobody@example.com')$$, 'NOT_FOUND', 'unknown code/email is rejected');
select pg_temp.fails($$select public.send_friend_request('   ')$$, 'INVALID', 'blank lookup is rejected');
select pg_temp.check((public.send_friend_request('@u-00004')->>'status') = 'pending', 'request by user code (with @, any case)');
select pg_temp.check((public.send_friend_request('EVE@example.COM')->>'status') = 'pending', 'request by email (any case)');
select pg_temp.fails($$select public.send_friend_request('U-00004')$$, 'already sent', 'duplicate request is rejected');
select pg_temp.fails($$insert into public."Friendship" ("requesterId","addresseeId") values ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000c')$$,
  'permission denied', 'cannot insert friendships directly');
select pg_temp.check((select count(*) from public.list_friends() where direction = 'outgoing') = 2, 'sender sees 2 outgoing requests');
select pg_temp.fails($$select public.respond_friend_request((select friendship_id from public.list_friends() where user_code = 'U-00004'), true)$$,
  'NOT_FOUND', 'sender cannot accept their own request');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) from public.list_friends() where direction = 'incoming' and user_code = 'U-00001') = 1, 'receiver sees the incoming request');
select pg_temp.check((public.respond_friend_request((select friendship_id from public.list_friends() where user_code = 'U-00001'), true)->>'status') = 'accepted', 'receiver accepts');
select pg_temp.fails($$select public.send_friend_request('U-00001')$$, 'already friends', 'cannot re-request an existing friend');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
-- E sending a request back to A accepts A's pending request.
select pg_temp.check((public.send_friend_request('U-00001')->>'status') = 'accepted', 'requesting someone who already asked you accepts it');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public."Friendship") = 0, 'strangers cannot see other people''s friendships');
select pg_temp.check((public.send_friend_request('U-00002')->>'status') = 'pending', 'C asks B');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((public.respond_friend_request((select friendship_id from public.list_friends() where user_code = 'U-00003'), false)->>'status') = 'declined', 'B declines C');
select pg_temp.check((select count(*) from public.list_friends()) = 0, 'declined request is gone');
select pg_temp.check((public.send_friend_request('U-00006')->>'status') = 'pending', 'B asks F');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000f');
select public.respond_friend_request((select friendship_id from public.list_friends() where user_code = 'U-00002'), true);

-- ============ group invitations ============
-- B is a plain member of G: not allowed to invite.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.check(not public.is_group_manager('10000000-0000-0000-0000-000000000001'), 'plain member is not a manager');
select pg_temp.fails($$select * from public.invite_friends_to_group('10000000-0000-0000-0000-000000000001', array['00000000-0000-0000-0000-00000000000f']::uuid[])$$,
  'owner or an admin', 'plain members cannot invite, even their friends');
select pg_temp.fails($$insert into public."Group_Invitation" ("groupId","invitedEmail","invitedBy") values ('10000000-0000-0000-0000-000000000001','cat@example.com','00000000-0000-0000-0000-00000000000b')$$,
  'row-level security', 'cannot insert invitations directly');

-- A owns G.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select pg_temp.check(public.is_group_manager('10000000-0000-0000-0000-000000000001'), 'owner is a manager');
create temp table outcomes as
select * from public.invite_friends_to_group('10000000-0000-0000-0000-000000000001', array[
  '00000000-0000-0000-0000-00000000000b',  -- already a member
  '00000000-0000-0000-0000-00000000000c',  -- not a friend
  '00000000-0000-0000-0000-00000000000d',  -- friend
  '00000000-0000-0000-0000-00000000000e',  -- friend
  '00000000-0000-0000-0000-00000000000d'   -- duplicate in the list
]::uuid[]);
select pg_temp.check((select outcome from outcomes where invitee_id = '00000000-0000-0000-0000-00000000000b') = 'already_member', 'existing member is reported, not invited');
select pg_temp.check((select outcome from outcomes where invitee_id = '00000000-0000-0000-0000-00000000000c') = 'not_friend', 'non-friend is NOT invited');
select pg_temp.check((select count(*) from outcomes where outcome = 'invited') = 2, 'two friends invited, duplicate ignored');
select pg_temp.fails($$select * from public.invite_friends_to_group('10000000-0000-0000-0000-000000000002', array['00000000-0000-0000-0000-00000000000d']::uuid[])$$,
  'archived', 'cannot invite to an archived group');
select pg_temp.fails($$select * from public.invite_friends_to_group('10000000-0000-0000-0000-000000000001', (select array_agg(gen_random_uuid()) from generate_series(1, 51)))$$,
  'up to 50', 'max 50 per call');
select pg_temp.fails($$select * from public.invite_friends_to_group('10000000-0000-0000-0000-000000000001', array[]::uuid[])$$,
  'at least one', 'empty list rejected');

-- D accepts in the app.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) from public.list_my_group_invitations() where group_name = 'Korea 2026' and invited_by_name = 'Ana') = 1, 'friend sees the invitation with group and inviter names');
select pg_temp.check((public.respond_group_invitation((select invitation_id from public.list_my_group_invitations()), true)->>'accepted')::boolean, 'friend accepts');
select pg_temp.check(public.is_group_member('10000000-0000-0000-0000-000000000001'), 'accepting adds them as a member');
select pg_temp.check((select role::text from public."Group_Member" where "groupId" = '10000000-0000-0000-0000-000000000001' and "userId" = '00000000-0000-0000-0000-00000000000d') = 'member', 'they join with the member role');
select pg_temp.check((select count(*) from public.list_my_group_invitations()) = 0, 'accepted invitation is cleared');

-- Unfriending makes a pending invitation invalid.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select public.remove_friendship((select friendship_id from public.list_friends() where user_code = 'U-00005'));
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select pg_temp.check((select count(*) from public.list_my_group_invitations()) = 0, 'invitation from an ex-friend is hidden');
select pg_temp.fails($$select public.respond_group_invitation((select "invitationId" from public."Group_Invitation" where "invitedUserId" = auth.uid()), true)$$,
  'no longer valid', 'invitation from an ex-friend cannot be accepted');
select pg_temp.check(not public.is_group_member('10000000-0000-0000-0000-000000000001'), 'ex-friend did not join');
select pg_temp.check((public.respond_group_invitation((select "invitationId" from public."Group_Invitation" where "invitedUserId" = auth.uid()), false)->>'accepted') = 'false', 'they can still decline it');

-- Strangers can't touch other people's invitations.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select pg_temp.fails($$select public.respond_group_invitation(gen_random_uuid(), true)$$, 'NOT_FOUND', 'unknown invitation rejected');
select pg_temp.fails($$select public.remove_friendship((select "friendshipId" from public."Friendship" limit 1))$$, 'NOT_FOUND', 'cannot remove other people''s friendships');
reset role;

-- Invite links/codes are gone: the functions no longer exist and codes were cleared.
select pg_temp.check(to_regprocedure('public.join_group_by_code(uuid, text)') is null, 'join_group_by_code removed');
select pg_temp.check(to_regprocedure('public.join_group_with_code(character varying)') is null, 'join_group_with_code removed');
select pg_temp.check(to_regprocedure('public.generate_group_invite_code(uuid)') is null, 'generate_group_invite_code removed');
select pg_temp.check(to_regprocedure('public.invite_users_to_group(uuid, uuid[])') is null, 'invite_users_to_group removed');
select pg_temp.check(public.create_group_with_admin('00000000-0000-0000-0000-00000000000a', 'No code') #>> '{group,inviteCode}' is null, 'new groups get no invite code');

-- ============ old invitation rows (sent before friends existed) ============
-- Old-style invitation from A to C (not friends), like the 13 existing rows.
insert into public."Group_Invitation" ("groupId", "invitedUserId", "invitedEmail", "invitedBy")
values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', 'cat@example.com', '00000000-0000-0000-0000-00000000000a');
set role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.list_my_group_invitations()) = 0, 'old non-friend invitation is not shown in the app');
select public.send_friend_request('U-00001');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select public.respond_friend_request((select friendship_id from public.list_friends() where user_code = 'U-00003'), true);
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.list_my_group_invitations()) = 1, 'once they are friends, the invitation shows in the app');
select pg_temp.check((public.respond_group_invitation((select invitation_id from public.list_my_group_invitations()), true)->>'accepted') = 'true', 'and accepting it joins the group');
select pg_temp.check(public.is_group_member('10000000-0000-0000-0000-000000000001'), 'C is now a member');
reset role;

-- Admins can invite too (promote B, then B invites friend F).
update public."Group_Member" set role = 'admin' where "userId" = '00000000-0000-0000-0000-00000000000b' and "groupId" = '10000000-0000-0000-0000-000000000001';
set role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select outcome from public.invite_friends_to_group('10000000-0000-0000-0000-000000000001', array['00000000-0000-0000-0000-00000000000f']::uuid[])) = 'invited', 'admins can invite their friends');
reset role;

\echo ALL FRIENDS TESTS PASSED
