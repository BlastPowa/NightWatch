-- Phase 23 acceptance tests: privacy-safe profiles, block management,
-- conversation members, room invitations.
--
-- HOW TO RUN. Paste into the Supabase SQL Editor and run. Creates throwaway
-- users, asserts, and ROLLS BACK — safe against the live project.
--
-- Requires 0001–0020.

begin;

create or replace function pg_temp.act_as(p_user uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
end;
$$;

create or replace function pg_temp.check(p_condition boolean, p_case text)
returns void
language plpgsql
as $$
begin
  if not p_condition then
    raise exception 'FAILED: %', p_case;
  end if;
end;
$$;

create or replace function pg_temp.expect_raise(p_sql text, p_expected text, p_case text)
returns void
language plpgsql
as $$
begin
  begin
    execute p_sql;
  exception
    when others then
      if sqlerrm <> p_expected then
        raise exception 'FAILED: % (expected "%", got "%")', p_case, p_expected, sqlerrm;
      end if;
      return;
  end;
  raise exception 'FAILED: % (expected raise "%", but it succeeded)', p_case, p_expected;
end;
$$;

do $$
declare
  alice uuid := gen_random_uuid();
  bob uuid := gen_random_uuid();
  carol uuid := gen_random_uuid();      -- a stranger
  mallory uuid := gen_random_uuid();    -- blocked
  shared_room text := 'PP2345';
  alice_room text := 'PP6789';
  profile jsonb;
  invite_id uuid;
  grp uuid;
  cnt bigint;
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (alice,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p-alice@test.local'),
    (bob,     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p-bob@test.local'),
    (carol,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p-carol@test.local'),
    (mallory, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p-mallory@test.local');

  insert into player_stats (user_id, display_name, rooms_joined, watch_seconds) values
    (alice, 'Alice', 5, 3600), (bob, 'Bob', 9, 7200),
    (carol, 'Carol', 1, 60), (mallory, 'Mallory', 2, 120);

  insert into player_achievements (user_id, achievement_id) values (bob, 'first-night');

  -- Alice and Bob are friends. Carol is a stranger. Mallory blocked Alice.
  perform pg_temp.act_as(alice);
  perform send_friend_request(bob);
  perform pg_temp.act_as(bob);
  perform accept_friend_request(alice);
  perform pg_temp.act_as(mallory);
  perform block_user(alice);

  -- =========================================================================
  -- Opt-in: stats and achievements are hidden by default.
  -- =========================================================================
  perform pg_temp.act_as(alice);
  profile := get_social_profile(bob);

  perform pg_temp.check(profile ? 'displayName', 'a profile always carries a display name');
  perform pg_temp.check(not (profile ? 'stats'),
    'stats are absent until the subject opts in');
  perform pg_temp.check(not (profile ? 'achievements'),
    'achievements are absent until the subject opts in');
  perform pg_temp.check((profile ->> 'isFriend')::boolean,
    'a friend is reported as a friend');
  perform pg_temp.check((profile ->> 'canMessage')::boolean,
    'you may message a friend');

  -- Bob opts into stats only. Achievements stay private: they are a SEPARATE
  -- disclosure, and opting into one must not opt you into the other.
  perform pg_temp.act_as(bob);
  update player_stats set share_stats = true where user_id = bob;

  perform pg_temp.act_as(alice);
  profile := get_social_profile(bob);
  perform pg_temp.check(profile ? 'stats', 'opting into stats reveals stats');
  perform pg_temp.check(not (profile ? 'achievements'),
    'opting into stats does NOT reveal achievements');
  perform pg_temp.check((profile -> 'stats' ->> 'watchSeconds')::bigint = 7200,
    'the revealed stats are the real ones');

  perform pg_temp.act_as(bob);
  perform set_share_achievements(true);
  perform pg_temp.act_as(alice);
  profile := get_social_profile(bob);
  perform pg_temp.check(jsonb_array_length(profile -> 'achievements') = 1,
    'opting into achievements reveals them');

  -- =========================================================================
  -- Strangers: no stats, no messaging, no mutual rooms.
  -- =========================================================================
  perform pg_temp.act_as(carol);
  update player_stats set share_stats = true where user_id = carol;

  perform pg_temp.act_as(alice);
  profile := get_social_profile(carol);
  perform pg_temp.check(not (profile ->> 'isFriend')::boolean, 'a stranger is not a friend');
  perform pg_temp.check(not (profile ->> 'canMessage')::boolean,
    'you may not message a stranger');
  perform pg_temp.check(not (profile ->> 'canInvite')::boolean,
    'you may not invite a stranger to a room');
  perform pg_temp.check(not (profile ? 'mutualRooms'),
    'mutual rooms are not disclosed to a non-friend');

  -- =========================================================================
  -- Blocks: total. Not a filtered profile — no profile.
  -- =========================================================================
  perform pg_temp.expect_raise(
    format('select get_social_profile(%L)', mallory),
    'blocked',
    'a blocked user has no profile at all, not an empty one');

  perform pg_temp.act_as(mallory);
  perform pg_temp.expect_raise(
    format('select get_social_profile(%L)', alice),
    'blocked',
    'a block cuts profile reads in BOTH directions');

  -- =========================================================================
  -- Borders cannot be forged.
  -- =========================================================================
  perform pg_temp.act_as(bob);
  -- Bob writes a border he never unlocked directly into his own row.
  update player_stats set selected_border_id = 'streak-30' where user_id = bob;

  perform pg_temp.act_as(alice);
  profile := get_social_profile(bob);
  perform pg_temp.check(profile ->> 'selectedBorderId' is null,
    'a border that was never unlocked does not render, even if selected');

  -- A border with no requirement is available to anyone.
  perform pg_temp.act_as(bob);
  update player_stats set selected_border_id = 'default' where user_id = bob;
  perform pg_temp.act_as(alice);
  profile := get_social_profile(bob);
  perform pg_temp.check(profile ->> 'selectedBorderId' = 'default',
    'an unrestricted border renders');

  -- =========================================================================
  -- Avatars: the host allowlist is a real constraint.
  -- =========================================================================
  perform pg_temp.act_as(bob);
  perform set_profile_avatar('https://cdn.discordapp.com/avatars/1/abc.png');
  perform pg_temp.act_as(alice);
  profile := get_social_profile(bob);
  perform pg_temp.check(profile ->> 'avatarUrl' like 'https://cdn.discordapp.com/%',
    'a Discord avatar is stored and returned');

  perform pg_temp.act_as(bob);
  begin
    -- An arbitrary URL rendered as an <img> in other users' clients is a
    -- tracking beacon. The column must refuse it.
    perform set_profile_avatar('https://evil.example/beacon.png');
    raise exception 'FAILED: a non-Discord avatar URL was accepted';
  exception
    when check_violation then null;  -- expected
  end;

  -- =========================================================================
  -- Mutual rooms: only rooms BOTH can reach.
  -- =========================================================================
  perform pg_temp.act_as(alice);
  insert into rooms (code, name, owner_id) values
    (shared_room, 'Shared Room', alice),
    (alice_room, 'Alice Only', alice);
  insert into room_invites (room_code, user_id) values (shared_room, bob);

  profile := get_social_profile(bob);
  perform pg_temp.check(jsonb_array_length(profile -> 'mutualRooms') = 1,
    'only rooms both people can reach are mutual');
  perform pg_temp.check(profile -> 'mutualRooms' -> 0 ->> 'code' = shared_room,
    'the mutual room is the shared one');
  perform pg_temp.check(
    not (profile::text like '%' || alice_room || '%'),
    'a room the other person cannot access is never named');

  -- =========================================================================
  -- Block management.
  -- =========================================================================
  perform pg_temp.act_as(alice);
  perform block_user(carol);
  select count(*) into cnt from list_blocked_users();
  perform pg_temp.check(cnt = 1, 'the block list reports who you blocked');

  perform unblock_user(carol);
  select count(*) into cnt from list_blocked_users();
  perform pg_temp.check(cnt = 0, 'unblocking removes them from the list');

  -- =========================================================================
  -- Conversation members: membership authorises, removal revokes.
  -- =========================================================================
  perform pg_temp.act_as(alice);
  grp := create_group_conversation('Movie Night');
  perform add_group_member(grp, bob);

  select count(*) into cnt from get_conversation_members(grp);
  perform pg_temp.check(cnt = 2, 'members can see the member list');

  perform pg_temp.check(
    exists (select 1 from get_conversation_members(grp)
            where user_id = bob and display_name = 'Bob'),
    'a member sees real names, not a shortened UUID');

  -- Carol is not in the group.
  perform pg_temp.act_as(carol);
  perform pg_temp.expect_raise(
    format('select * from get_conversation_members(%L)', grp),
    'forbidden',
    'a non-member cannot read the member list');

  -- Removal revokes it.
  perform pg_temp.act_as(alice);
  perform remove_group_member(grp, bob);
  perform pg_temp.act_as(bob);
  perform pg_temp.expect_raise(
    format('select * from get_conversation_members(%L)', grp),
    'forbidden',
    'removal revokes access to the member list');

  -- =========================================================================
  -- Room invitations.
  -- =========================================================================
  perform pg_temp.act_as(alice);
  invite_id := invite_friend_to_room(alice_room, bob);
  perform pg_temp.check(invite_id is not null, 'a friend can be invited to a room');

  perform pg_temp.check(
    exists (select 1 from notifications where user_id = bob and kind = 'room.invite'),
    'an invitation notifies the invitee');
  perform pg_temp.check(
    exists (select 1 from social_audit_log where actor_id = alice and action = 'room.invite'),
    'an invitation is audited');

  -- A stranger cannot be invited.
  perform pg_temp.expect_raise(
    format('select invite_friend_to_room(%L, %L)', alice_room, carol),
    'forbidden',
    'a stranger cannot be invited to a room');

  -- You cannot hand out access you do not have.
  perform pg_temp.act_as(bob);
  perform pg_temp.expect_raise(
    format('select invite_friend_to_room(%L, %L)', shared_room, mallory),
    'forbidden',
    'you cannot invite someone who is not your friend');

  -- Accepting grants access.
  perform pg_temp.act_as(bob);
  perform pg_temp.check(not public.can_access_room(bob, alice_room),
    'an invitation is not yet access');
  perform respond_room_invite(invite_id, true);
  perform pg_temp.check(public.can_access_room(bob, alice_room),
    'accepting an invitation grants access to the room');

  -- Someone else cannot answer your invitation.
  perform pg_temp.act_as(alice);
  invite_id := invite_friend_to_room(shared_room, bob);
  perform pg_temp.act_as(carol);
  perform pg_temp.expect_raise(
    format('select respond_room_invite(%L, true)', invite_id),
    'forbidden',
    'only the invitee may answer an invitation');

  -- Revocation.
  perform pg_temp.act_as(alice);
  perform revoke_room_invite(invite_id);
  perform pg_temp.act_as(bob);
  perform pg_temp.expect_raise(
    format('select respond_room_invite(%L, true)', invite_id),
    'forbidden',
    'a revoked invitation cannot be accepted');

  -- Expiry: an expired invitation is gone, not merely old.
  perform pg_temp.act_as(alice);
  invite_id := invite_friend_to_room(shared_room, bob);
  update room_friend_invites set expires_at = now() - interval '1 day' where id = invite_id;

  perform pg_temp.act_as(bob);
  perform pg_temp.expect_raise(
    format('select respond_room_invite(%L, true)', invite_id),
    'forbidden',
    'an expired invitation cannot be accepted');

  select count(*) into cnt from list_room_invites();
  perform pg_temp.check(cnt = 0, 'an expired invitation is not listed');

  raise notice 'ALL PHASE 23 PROFILE TESTS PASSED';
end;
$$;

rollback;
