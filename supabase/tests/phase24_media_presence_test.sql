-- Phase 24 acceptance tests: consent-safe playable friend media presence.
--
-- HOW TO RUN. Paste the whole file into the Supabase SQL Editor and run it (or
-- run it against a disposable database). It creates throwaway users, asserts,
-- and ROLLS BACK — nothing is persisted. Any failed assertion aborts with a
-- message naming the case.
--
-- Covers: consent combinations, friendship + block transitions in both
-- directions, invalid video ids, safe-avatar and validated-border exposure,
-- stale presence parity with v1, old-client (v0.1.22) compatibility, and the
-- hard guarantee that get_friend_presence_v2 can never carry a room code.

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
  carol uuid := gen_random_uuid();
  good_avatar text := 'https://cdn.discordapp.com/avatars/1/abc.png';
  evil_avatar text := 'https://evil.example.com/avatars/1/abc.png';
  vid text := 'dQw4w9WgXcQ';  -- exactly 11 chars
  cnt bigint;
  got text;
begin
  insert into auth.users (id, instance_id, aud, role, email)
  values
    (alice, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'alice@test.local'),
    (bob,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bob@test.local'),
    (carol, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'carol@test.local');

  insert into player_stats (user_id, display_name, avatar_url)
  values (alice, 'Alice', null), (bob, 'Bob', good_avatar), (carol, 'Carol', null);

  -- Alice and Bob are friends; Carol is a stranger.
  insert into friendships (user_low, user_high)
  values (least(alice, bob), greatest(alice, bob));

  -- =========================================================================
  -- Deployment guarantee: get_friend_presence_v2 has NO room-code column. This
  -- is the invariant the whole feature rests on, checked at the schema level so
  -- it cannot regress no matter what the body selects.
  -- =========================================================================
  perform pg_temp.check(
    not exists (
      select 1
      from pg_proc p, unnest(coalesce(p.proargnames, '{}')) as an
      where p.proname = 'get_friend_presence_v2'
        and (an ilike '%room%' or an ilike '%code%')
    ),
    'get_friend_presence_v2 exposes no room/code column'
  );

  -- =========================================================================
  -- Invalid video ids are rejected outright (strict, not coerced).
  -- =========================================================================
  perform pg_temp.act_as(bob);
  perform pg_temp.expect_raise(
    format('select heartbeat_media_presence(%L, %L, %L)', 'watching', 't', 'short'),
    'forbidden',
    'a too-short video id is rejected'
  );
  perform pg_temp.expect_raise(
    format('select heartbeat_media_presence(%L, %L, %L)', 'watching', 't', 'twelvechars0'),
    'forbidden',
    'a 12-character video id is rejected'
  );
  perform pg_temp.expect_raise(
    format('select heartbeat_media_presence(%L, %L, %L)', 'watching', 't', 'has a space'),
    'forbidden',
    'a video id with spaces is rejected'
  );
  perform pg_temp.expect_raise(
    format('select heartbeat_media_presence(%L, %L, %L)', 'not-a-status', null, null),
    'forbidden',
    'an invalid status is rejected'
  );

  -- A valid heartbeat with a real id succeeds and stores the id.
  perform heartbeat_media_presence('watching', 'A Video', vid);
  perform pg_temp.check(
    (select video_id from presence_preferences where user_id = bob) = vid,
    'a valid 11-char video id is stored'
  );

  -- =========================================================================
  -- Consent combinations.
  -- =========================================================================
  -- Default (share_online false): Bob is invisible even to a friend.
  perform pg_temp.act_as(alice);
  perform pg_temp.check(
    not exists (select 1 from get_friend_presence_v2() where user_id = bob),
    'share_online=false hides the friend entirely'
  );

  -- share_online only: status yes, title/id no.
  perform pg_temp.act_as(bob);
  perform set_presence_preferences(true, false);
  perform pg_temp.act_as(alice);
  perform pg_temp.check(
    (select status from get_friend_presence_v2() where user_id = bob) = 'watching',
    'share_online exposes status'
  );
  perform pg_temp.check(
    (select video_title from get_friend_presence_v2() where user_id = bob) is null,
    'share_activity=false withholds the title'
  );
  perform pg_temp.check(
    (select video_id from get_friend_presence_v2() where user_id = bob) is null,
    'share_activity=false withholds the video id'
  );

  -- share_activity: title AND id revealed.
  perform pg_temp.act_as(bob);
  perform set_presence_preferences(true, true);
  perform pg_temp.act_as(alice);
  perform pg_temp.check(
    (select video_title from get_friend_presence_v2() where user_id = bob) = 'A Video',
    'share_activity exposes the title'
  );
  perform pg_temp.check(
    (select video_id from get_friend_presence_v2() where user_id = bob) = vid,
    'share_activity exposes the video id'
  );

  -- =========================================================================
  -- Safe avatar: only a canonical Discord CDN url survives to a friend's row.
  -- =========================================================================
  perform pg_temp.check(
    (select avatar_url from get_friend_presence_v2() where user_id = bob) = good_avatar,
    'a Discord CDN avatar is exposed'
  );
  -- Poison the stored value directly (set_profile_avatar does not gate host).
  update player_stats set avatar_url = evil_avatar where user_id = bob;
  perform pg_temp.check(
    (select avatar_url from get_friend_presence_v2() where user_id = bob) is null,
    'a non-Discord avatar host is stripped to null on the way out'
  );
  update player_stats set avatar_url = good_avatar where user_id = bob;

  -- =========================================================================
  -- Validated border: a forged (locked) selection renders as null.
  -- =========================================================================
  -- Force a selection Bob never unlocked, straight into the column.
  update player_stats set selected_border_id = 'streak-30' where user_id = bob;
  perform pg_temp.check(
    (select selected_border_id from get_friend_presence_v2() where user_id = bob) is null,
    'an unearned border is not exposed'
  );
  update player_stats set selected_border_id = null where user_id = bob;

  -- =========================================================================
  -- Only accepted friends: Carol, fully consenting, is still invisible.
  -- =========================================================================
  perform pg_temp.act_as(carol);
  perform set_presence_preferences(true, true);
  perform heartbeat_media_presence('watching', 'Carol Video', vid);
  perform pg_temp.act_as(alice);
  perform pg_temp.check(
    not exists (select 1 from get_friend_presence_v2() where user_id = carol),
    'a non-friend never appears however much they consent'
  );

  -- =========================================================================
  -- Blocks override consent in BOTH directions.
  -- =========================================================================
  perform pg_temp.act_as(alice);
  perform block_user(bob);
  perform pg_temp.check(
    not exists (select 1 from get_friend_presence_v2() where user_id = bob),
    'a blocked friend disappears from the blocker view'
  );
  perform pg_temp.act_as(bob);
  perform pg_temp.check(
    not exists (select 1 from get_friend_presence_v2() where user_id = alice),
    'the blocker disappears from the blocked user view'
  );
  perform pg_temp.act_as(alice);
  perform unblock_user(bob);

  -- Friendship transition: unblock does not restore friendship, so still hidden.
  perform pg_temp.check(
    not exists (select 1 from get_friend_presence_v2() where user_id = bob),
    'after a block/unblock the severed friendship stays hidden'
  );
  -- Re-friend and Bob is visible again (transition back).
  insert into friendships (user_low, user_high)
  values (least(alice, bob), greatest(alice, bob));
  perform pg_temp.check(
    exists (select 1 from get_friend_presence_v2() where user_id = bob),
    'restoring the friendship restores visibility'
  );

  -- =========================================================================
  -- Stale presence parity with v1: no row is withheld by age. A very old
  -- heartbeat still returns, identically to get_friend_presence, and the client
  -- derives staleness from updated_at.
  -- =========================================================================
  update presence_preferences
  set updated_at = now() - interval '3 days'
  where user_id = bob;
  perform pg_temp.check(
    exists (select 1 from get_friend_presence_v2() where user_id = bob),
    'v2 returns a stale row (client-derived expiry, matching v1)'
  );
  perform pg_temp.check(
    (select count(*) from get_friend_presence() where user_id = bob)
      = (select count(*) from get_friend_presence_v2() where user_id = bob),
    'v1 and v2 agree on which friends are present'
  );

  -- =========================================================================
  -- Old-client (v0.1.22) compatibility.
  -- =========================================================================
  -- The old heartbeat still works and leaves video_id null.
  perform pg_temp.act_as(bob);
  perform heartbeat_presence('online', 'Old Client Video');
  perform pg_temp.check(
    (select video_id from presence_preferences where user_id = bob) is null,
    'old heartbeat_presence clears the video id (never writes one)'
  );
  -- And v2 surfaces that row with a null id even under full activity consent.
  perform pg_temp.act_as(alice);
  perform pg_temp.check(
    (select video_id from get_friend_presence_v2() where user_id = bob) is null,
    'an old-client presence row shows a null video id in v2'
  );
  perform pg_temp.check(
    (select status from get_friend_presence_v2() where user_id = bob) = 'online',
    'an old-client presence row still exposes status in v2'
  );
  -- The old reader keeps working unchanged.
  perform pg_temp.check(
    exists (select 1 from get_friend_presence() where user_id = bob),
    'the original get_friend_presence still returns the friend'
  );

  -- =========================================================================
  -- Unauthenticated callers are turned away.
  -- =========================================================================
  perform set_config('request.jwt.claims', null, true);
  perform pg_temp.expect_raise(
    'select get_friend_presence_v2()',
    'unauthenticated',
    'unauthenticated caller is rejected by v2'
  );
  perform pg_temp.expect_raise(
    format('select heartbeat_media_presence(%L, null, null)', 'online'),
    'unauthenticated',
    'unauthenticated caller cannot heartbeat media presence'
  );

  raise notice 'ALL PHASE 24 TESTS PASSED';
end;
$$;

rollback;
