-- Phase 20B acceptance tests: RLS, blocking, caps, cursors, visibility.
--
-- HOW TO RUN. Paste the whole file into the Supabase SQL Editor and run it.
-- It creates throwaway users, asserts, and ROLLS BACK — nothing is persisted,
-- so it is safe to run against the live project. Any failed assertion aborts
-- with a message naming the case.
--
-- It exercises the RPCs the way a client does, by impersonating users through
-- request.jwt.claims (which is what auth.uid() reads).

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

-- Raised-message assertion: the RPCs signal failure by raising.
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
  carol uuid := gen_random_uuid();
  extra uuid;
  conv uuid;
  msg1 uuid;
  msg2 uuid;
  note_private uuid;
  note_friends uuid;
  cnt bigint;
  i integer;
begin
  -- Fixtures. instance_id/aud/role mirror what GoTrue writes.
  insert into auth.users (id, instance_id, aud, role, email)
  values
    (alice, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'alice@test.local'),
    (bob,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bob@test.local'),
    (carol, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'carol@test.local');

  insert into player_stats (user_id, display_name, share_stats)
  values (alice, 'Alice', true), (bob, 'Bob', true), (carol, 'Carol', true);

  -- =========================================================================
  -- share_stats default is now FALSE (the 0006 consent flip).
  -- =========================================================================
  insert into auth.users (id, instance_id, aud, role, email)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dave@test.local')
  returning id into extra;
  insert into player_stats (user_id, display_name) values (extra, 'Dave');
  perform pg_temp.check(
    (select share_stats from player_stats where user_id = extra) = false,
    'share_stats defaults to false'
  );

  -- =========================================================================
  -- Friend requests: idempotency and the one-live-request rule.
  -- =========================================================================
  perform pg_temp.act_as(alice);
  perform send_friend_request(bob);
  perform send_friend_request(bob);  -- Idempotent: must not raise or duplicate.
  select count(*) into cnt
  from friend_requests
  where status = 'pending' and sender_id = alice and recipient_id = bob;
  perform pg_temp.check(cnt = 1, 'duplicate send_friend_request creates one row');

  -- A mirrored request auto-accepts rather than colliding with the unique index.
  perform pg_temp.act_as(bob);
  perform send_friend_request(alice);
  perform pg_temp.check(are_friends(alice, bob), 'mirrored request accepts into a friendship');

  -- Accepting an existing friendship is idempotent.
  perform accept_friend_request(alice);
  select count(*) into cnt from friendships
  where user_low = least(alice, bob) and user_high = greatest(alice, bob);
  perform pg_temp.check(cnt = 1, 'double accept collapses to one friendship');

  -- Canonical ordering holds.
  perform pg_temp.check(
    (select user_low < user_high from friendships
     where user_low = least(alice, bob) and user_high = greatest(alice, bob)),
    'friendship pair is canonically ordered'
  );

  -- =========================================================================
  -- Messaging basics, before we block anyone.
  -- =========================================================================
  perform pg_temp.act_as(alice);
  conv := create_direct_conversation(bob);
  perform pg_temp.check(conv is not null, 'direct conversation created between friends');

  -- Idempotent: the same pair must not spawn a second direct conversation.
  perform pg_temp.check(
    create_direct_conversation(bob) = conv,
    'create_direct_conversation returns the existing conversation'
  );

  msg1 := send_message(conv, 'first');
  msg2 := send_message(conv, 'second');

  -- Unread cursor: Bob has not read anything, so both of Alice's count.
  perform pg_temp.act_as(bob);
  select unread_count into cnt from list_conversations() where id = conv;
  perform pg_temp.check(cnt = 2, 'unread_count counts unread messages from others');

  perform mark_conversation_read(conv, msg1);
  select unread_count into cnt from list_conversations() where id = conv;
  perform pg_temp.check(cnt = 1, 'unread_count drops after marking read');

  -- Your own messages never count as unread to you.
  perform pg_temp.act_as(alice);
  select unread_count into cnt from list_conversations() where id = conv;
  perform pg_temp.check(cnt = 0, 'own messages are not unread to the sender');

  -- =========================================================================
  -- Soft deletion: the row survives (so cursors stay stable) but the body does
  -- not come back.
  -- =========================================================================
  perform delete_message(msg2);
  perform pg_temp.check(
    exists (select 1 from messages where id = msg2 and deleted_at is not null),
    'delete_message soft-deletes'
  );
  perform pg_temp.check(
    (select body from get_messages(conv) where id = msg2) = '',
    'soft-deleted message returns an empty body'
  );
  perform pg_temp.check(
    (select count(*) from get_messages(conv)) = 2,
    'soft-deleted message still occupies its cursor slot'
  );
  perform delete_message(msg2);  -- Idempotent.

  -- Only the sender may edit.
  perform pg_temp.act_as(bob);
  perform pg_temp.expect_raise(
    format('select edit_message(%L, %L)', msg1, 'hacked'),
    'forbidden',
    'non-sender cannot edit a message'
  );

  -- =========================================================================
  -- Non-friends cannot open a direct conversation.
  -- =========================================================================
  perform pg_temp.act_as(alice);
  perform pg_temp.expect_raise(
    format('select create_direct_conversation(%L)', carol),
    'forbidden',
    'direct conversation requires an accepted friendship'
  );

  -- =========================================================================
  -- Blocking overrides everything, in BOTH directions.
  -- =========================================================================
  perform pg_temp.act_as(alice);
  perform block_user(bob);

  perform pg_temp.check(not are_friends(alice, bob), 'block severs the friendship');
  perform pg_temp.check(is_blocked(bob, alice), 'block is symmetric for permissions');

  -- The blocked party cannot message the existing direct conversation.
  perform pg_temp.act_as(bob);
  perform pg_temp.expect_raise(
    format('select send_message(%L, %L)', conv, 'hello?'),
    'blocked',
    'blocked user cannot send into an existing direct conversation'
  );
  -- ...and neither can the blocker.
  perform pg_temp.act_as(alice);
  perform pg_temp.expect_raise(
    format('select send_message(%L, %L)', conv, 'hello?'),
    'blocked',
    'blocker cannot send into the conversation either'
  );

  -- Requests are impossible in both directions while blocked.
  perform pg_temp.expect_raise(
    format('select send_friend_request(%L)', bob),
    'blocked',
    'blocker cannot re-request the blocked user'
  );
  perform pg_temp.act_as(bob);
  perform pg_temp.expect_raise(
    format('select send_friend_request(%L)', alice),
    'blocked',
    'blocked user cannot request the blocker'
  );

  -- Neither appears in the other's graph.
  perform pg_temp.act_as(alice);
  perform pg_temp.check(
    not exists (select 1 from get_social_graph() where user_id = bob),
    'blocked user is absent from the blocker graph'
  );
  perform pg_temp.act_as(bob);
  perform pg_temp.check(
    not exists (select 1 from get_social_graph() where user_id = alice),
    'blocker is absent from the blocked user graph'
  );

  -- Blocking leaves no pending request behind that could later be accepted.
  select count(*) into cnt from friend_requests
  where status = 'pending'
    and least(sender_id, recipient_id) = least(alice, bob)
    and greatest(sender_id, recipient_id) = greatest(alice, bob);
  perform pg_temp.check(cnt = 0, 'block cancels pending requests in both directions');

  -- Unblocking does NOT silently restore the friendship.
  perform pg_temp.act_as(alice);
  perform unblock_user(bob);
  perform pg_temp.check(not are_friends(alice, bob), 'unblock does not restore the friendship');

  -- =========================================================================
  -- Presence: opt-out is the default, and the room code is never exposed.
  -- =========================================================================
  perform send_friend_request(bob);
  perform pg_temp.act_as(bob);
  perform accept_friend_request(alice);
  perform heartbeat_presence('watching', 'A Video');

  -- Bob has not consented, so Alice sees nothing.
  perform pg_temp.act_as(alice);
  perform pg_temp.check(
    not exists (select 1 from get_friend_presence() where user_id = bob),
    'presence is hidden by default (share_online false)'
  );

  -- share_online alone reveals status but NOT the activity title.
  perform pg_temp.act_as(bob);
  perform set_presence_preferences(true, false);
  perform pg_temp.act_as(alice);
  perform pg_temp.check(
    (select status from get_friend_presence() where user_id = bob) = 'watching',
    'share_online exposes status'
  );
  perform pg_temp.check(
    (select video_title from get_friend_presence() where user_id = bob) is null,
    'share_activity=false withholds the video title'
  );

  perform pg_temp.act_as(bob);
  perform set_presence_preferences(true, true);
  perform pg_temp.act_as(alice);
  perform pg_temp.check(
    (select video_title from get_friend_presence() where user_id = bob) = 'A Video',
    'share_activity exposes the video title'
  );

  -- Non-friends never appear, however much they consent.
  perform pg_temp.act_as(carol);
  perform set_presence_preferences(true, true);
  perform heartbeat_presence('online');
  perform pg_temp.act_as(alice);
  perform pg_temp.check(
    not exists (select 1 from get_friend_presence() where user_id = carol),
    'presence is limited to accepted friends'
  );

  -- =========================================================================
  -- Group cap: the 31st active member must be rejected.
  -- =========================================================================
  perform pg_temp.act_as(alice);
  conv := create_group_conversation('Test Group');

  -- Alice is the owner (1). Add 29 friends to reach the cap of 30.
  for i in 1..29 loop
    extra := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email)
    values (extra, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            format('member%s@test.local', i));
    insert into friendships (user_low, user_high)
    values (least(alice, extra), greatest(alice, extra));
    perform add_group_member(conv, extra);
  end loop;

  select count(*) into cnt from conversation_members
  where conversation_id = conv and left_at is null;
  perform pg_temp.check(cnt = 30, 'group fills to exactly 30 active members');

  -- The 31st is refused.
  extra := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email)
  values (extra, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'overflow@test.local');
  insert into friendships (user_low, user_high)
  values (least(alice, extra), greatest(alice, extra));
  perform pg_temp.expect_raise(
    format('select add_group_member(%L, %L)', conv, extra),
    'forbidden',
    'group cap rejects the 31st active member'
  );

  -- Removing someone frees a slot again.
  perform remove_group_member(conv, (
    select user_id from conversation_members
    where conversation_id = conv and role = 'member' and left_at is null limit 1
  ));
  perform add_group_member(conv, extra);
  select count(*) into cnt from conversation_members
  where conversation_id = conv and left_at is null;
  perform pg_temp.check(cnt = 30, 'a freed slot can be refilled, still capped at 30');

  -- The owner cannot walk away and orphan the group.
  perform pg_temp.expect_raise(
    format('select leave_conversation(%L)', conv),
    'forbidden',
    'owner cannot leave without transferring ownership'
  );

  -- =========================================================================
  -- Moment notes: visibility.
  -- =========================================================================
  perform pg_temp.act_as(alice);
  note_private := create_moment_note('AAAAAAAAAAA', 30, 'private', 'my note', null, null);
  note_friends := create_moment_note('AAAAAAAAAAA', 45, 'friends', 'friends note', null, null);

  -- Negative timestamps are clamped, not rejected.
  perform create_moment_note('AAAAAAAAAAA', -5, 'private', 'clamped', null, null);
  perform pg_temp.check(
    exists (select 1 from video_moment_notes
            where author_id = alice and body = 'clamped' and position_seconds = 0),
    'negative position_seconds clamps to 0'
  );

  -- Bob is Alice's friend: he sees the friends note, never the private one.
  perform pg_temp.act_as(bob);
  perform pg_temp.check(
    exists (select 1 from list_moment_notes('AAAAAAAAAAA') where id = note_friends),
    'friend sees a friends-visibility note'
  );
  perform pg_temp.check(
    not exists (select 1 from list_moment_notes('AAAAAAAAAAA') where id = note_private),
    'friend cannot see a private note'
  );

  -- Carol is not a friend: she sees neither.
  perform pg_temp.act_as(carol);
  perform pg_temp.check(
    not exists (select 1 from list_moment_notes('AAAAAAAAAAA') where id = note_friends),
    'non-friend cannot see a friends-visibility note'
  );

  -- A block hides previously-visible friends notes.
  perform pg_temp.act_as(alice);
  perform block_user(bob);
  perform pg_temp.act_as(bob);
  perform pg_temp.check(
    not exists (select 1 from list_moment_notes('AAAAAAAAAAA') where id = note_friends),
    'blocked user loses sight of friends-visibility notes'
  );
  perform pg_temp.act_as(alice);
  perform unblock_user(bob);

  -- Only the author may edit or delete.
  perform pg_temp.act_as(carol);
  perform pg_temp.expect_raise(
    format('select edit_moment_note(%L, %L, null)', note_private, 'hacked'),
    'forbidden',
    'non-author cannot edit a moment note'
  );

  -- Room notes require a real relationship with that room.
  perform pg_temp.expect_raise(
    format('select create_moment_note(%L, 10, %L, %L, null, %L)',
           'AAAAAAAAAAA', 'room', 'room note', 'ZZZZZZ'),
    'forbidden',
    'room note requires participation in that room'
  );

  -- =========================================================================
  -- Borders: the server refuses a selection that is not unlocked.
  -- =========================================================================
  perform pg_temp.act_as(alice);
  perform pg_temp.expect_raise(
    format('select select_border(%L)', 'streak-30'),
    'forbidden',
    'cannot select a border that is not unlocked'
  );
  perform pg_temp.expect_raise(
    format('select unlock_border(%L)', 'streak-30'),
    'forbidden',
    'cannot unlock a border whose achievement is not earned'
  );

  -- Earn it, then it works.
  insert into player_achievements (user_id, achievement_id) values (alice, 'streak-30');
  perform unlock_border('streak-30');
  perform select_border('streak-30');
  perform pg_temp.check(
    (select selected_border_id from player_stats where user_id = alice) = 'streak-30',
    'an unlocked border can be selected'
  );

  -- A border with no achievement requirement is always available.
  perform select_border('default');

  -- An unknown border id is rejected outright.
  perform pg_temp.expect_raise(
    format('select select_border(%L)', 'not-a-border'),
    'forbidden',
    'unknown border id is rejected'
  );

  -- =========================================================================
  -- Unauthenticated callers are turned away.
  -- =========================================================================
  perform set_config('request.jwt.claims', null, true);
  perform pg_temp.expect_raise(
    'select get_social_graph()',
    'unauthenticated',
    'unauthenticated caller is rejected'
  );

  raise notice 'ALL PHASE 20B TESTS PASSED';
end;
$$;

rollback;
