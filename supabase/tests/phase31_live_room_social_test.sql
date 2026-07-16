-- Phase 31 acceptance tests: live-room co-watcher discovery + diagnostics.
--
-- HOW TO RUN. Paste the whole file into the Supabase SQL Editor and run it (or
-- run it against a disposable database). It creates throwaway users, asserts,
-- and ROLLS BACK — nothing is persisted. Any failed assertion aborts with a
-- message naming the case.
--
-- Covers: heartbeat/list/leave lifecycle, caller-freshness gating, code and
-- presence-id validation, room-switch rate limiting, one-room-per-user,
-- friend/pending-request/block exclusion in both directions, staleness,
-- opportunistic cleanup, direct-table lockdown, the hard guarantee that a raw
-- room code is never stored, anon denial, and social_diagnostics().

begin;

-- Both the claims AND the role are switched.
--
-- Setting request.jwt.claims alone is not enough to test RLS: the role running
-- the test (postgres) may hold BYPASSRLS, in which case every policy is skipped
-- and an isolation test passes while proving nothing. Becoming `authenticated`
-- is what makes these assertions real.
create or replace function pg_temp.act_as(p_user uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.act_as_anon()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
end;
$$;

-- RESET ROLE is always allowed and restores the session's original (admin)
-- authorization, so fixtures and clock manipulation can bypass the lockdown.
create or replace function pg_temp.act_as_admin()
returns void
language plpgsql
as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
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
  exception when others then
    if p_expected is not null and sqlerrm <> p_expected then
      raise exception 'FAILED: % (expected "%", got "%")', p_case, p_expected, sqlerrm;
    end if;
    return;
  end;
  raise exception 'FAILED (expected an error): %', p_case;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures and cases.
-- ---------------------------------------------------------------------------

do $$
declare
  v_alice uuid := gen_random_uuid();  -- host
  v_bob   uuid := gen_random_uuid();  -- co-watcher
  v_carol uuid := gen_random_uuid();  -- outsider (never in the room)
  v_dave  uuid := gen_random_uuid();  -- bob's accepted friend
  v_erin  uuid := gen_random_uuid();  -- pending request with bob
  v_frank uuid := gen_random_uuid();  -- blocked by bob
  v_room1 text := 'ABC234';
  v_room2 text := 'XYZ789';
  v_count integer;
  v_diag jsonb;
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (v_alice, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'alice-p31@test.local'),
    (v_bob,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bob-p31@test.local'),
    (v_carol, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'carol-p31@test.local'),
    (v_dave,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dave-p31@test.local'),
    (v_erin,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'erin-p31@test.local'),
    (v_frank, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'frank-p31@test.local');

  insert into public.player_stats (user_id, display_name)
  values (v_bob, 'Bob');

  insert into public.friendships (user_low, user_high)
  values (least(v_bob, v_dave), greatest(v_bob, v_dave));

  insert into public.friend_requests (sender_id, recipient_id, status)
  values (v_bob, v_erin, 'pending');

  insert into public.user_blocks (blocker_id, blocked_id)
  values (v_bob, v_frank);

  -- -------------------------------------------------------------------------
  -- Direct table access is denied to clients; RPCs are the only surface.
  -- -------------------------------------------------------------------------

  perform pg_temp.act_as(v_alice);
  perform pg_temp.expect_raise(
    'select * from public.live_room_social_presence', null,
    'authenticated cannot read the presence table directly');
  perform pg_temp.expect_raise(
    'select * from public.live_room_social_secret', null,
    'authenticated cannot read the hash secret');
  perform pg_temp.expect_raise(
    format('insert into public.live_room_social_presence values (''x'', %L, ''p'', now())', v_alice), null,
    'authenticated cannot insert presence directly');
  perform pg_temp.expect_raise(
    'select public.live_room_key_hash(''ABC234'')', null,
    'the hash helper is not client-callable');

  -- -------------------------------------------------------------------------
  -- Validation.
  -- -------------------------------------------------------------------------

  perform pg_temp.expect_raise(
    'select public.heartbeat_live_room_social(''ABC1'', ''p1'')', 'forbidden',
    'a short room code is rejected');
  perform pg_temp.expect_raise(
    'select public.heartbeat_live_room_social(''ABC10!'', ''p1'')', 'forbidden',
    'a room code outside the alphabet is rejected');
  perform pg_temp.expect_raise(
    'select public.heartbeat_live_room_social(''ABC234'', ''bad id!'')', 'forbidden',
    'an unsafe presence id is rejected');
  perform pg_temp.expect_raise(
    format('select public.heartbeat_live_room_social(%L, repeat(''a'', 65))', 'ABC234'), 'forbidden',
    'an oversized presence id is rejected');

  -- -------------------------------------------------------------------------
  -- Heartbeat + list lifecycle.
  -- -------------------------------------------------------------------------

  perform pg_temp.check(
    public.heartbeat_live_room_social(v_room1, 'alice-p') = 'ok',
    'alice can heartbeat the live room');
  -- Lowercase input normalizes to the same room.
  perform pg_temp.check(
    public.heartbeat_live_room_social(lower(v_room1), 'alice-p') = 'ok',
    're-heartbeating the same room (lowercase) is allowed');

  select count(*) into v_count from public.list_live_room_co_watchers(v_room1);
  perform pg_temp.check(v_count = 0, 'alice alone sees no co-watchers');

  perform pg_temp.act_as(v_bob);
  perform pg_temp.check(
    public.heartbeat_live_room_social(v_room1, 'bob-p') = 'ok',
    'bob can heartbeat the same room');

  perform pg_temp.act_as(v_alice);
  select count(*) into v_count from public.list_live_room_co_watchers(v_room1)
    where user_id = v_bob and display_name = 'Bob';
  perform pg_temp.check(v_count = 1, 'alice sees bob as a fresh co-watcher');

  -- Caller not present in the room: knowing the code lists nothing.
  perform pg_temp.act_as(v_carol);
  perform pg_temp.expect_raise(
    format('select * from public.list_live_room_co_watchers(%L)', v_room1), 'forbidden',
    'a caller without a fresh heartbeat cannot enumerate the room');

  -- -------------------------------------------------------------------------
  -- Room-switch rate limit and one-room-per-user.
  -- -------------------------------------------------------------------------

  perform pg_temp.act_as(v_bob);
  perform pg_temp.expect_raise(
    format('select public.heartbeat_live_room_social(%L, ''bob-p'')', v_room2), 'rate-limited',
    'immediately switching rooms is rate limited');

  perform pg_temp.act_as_admin();
  update public.live_room_social_presence
    set last_seen_at = now() - interval '11 seconds'
    where user_id = v_bob;

  perform pg_temp.act_as(v_bob);
  perform pg_temp.check(
    public.heartbeat_live_room_social(v_room2, 'bob-p') = 'ok',
    'switching rooms succeeds after the rate-limit window');

  perform pg_temp.act_as_admin();
  select count(*) into v_count from public.live_room_social_presence where user_id = v_bob;
  perform pg_temp.check(v_count = 1, 'a user holds presence in at most one room');

  perform pg_temp.act_as(v_alice);
  select count(*) into v_count from public.list_live_room_co_watchers(v_room1);
  perform pg_temp.check(v_count = 0, 'bob left room1 by joining room2');

  -- Move bob back beside alice for the exclusion cases.
  perform pg_temp.act_as_admin();
  update public.live_room_social_presence
    set last_seen_at = now() - interval '11 seconds'
    where user_id = v_bob;
  perform pg_temp.act_as(v_bob);
  perform pg_temp.check(
    public.heartbeat_live_room_social(v_room1, 'bob-p') = 'ok',
    'bob returns to room1');

  -- -------------------------------------------------------------------------
  -- Exclusions: friends, pending requests, blocks (both directions).
  -- -------------------------------------------------------------------------

  perform pg_temp.act_as(v_dave);
  perform pg_temp.check(
    public.heartbeat_live_room_social(v_room1, 'dave-p') = 'ok',
    'dave joins room1');
  perform pg_temp.act_as(v_erin);
  perform pg_temp.check(
    public.heartbeat_live_room_social(v_room1, 'erin-p') = 'ok',
    'erin joins room1');
  perform pg_temp.act_as(v_frank);
  perform pg_temp.check(
    public.heartbeat_live_room_social(v_room1, 'frank-p') = 'ok',
    'frank joins room1');

  perform pg_temp.act_as(v_bob);
  select count(*) into v_count from public.list_live_room_co_watchers(v_room1);
  perform pg_temp.check(v_count = 1, 'bob sees only alice (friend, pending, block excluded)');
  select count(*) into v_count from public.list_live_room_co_watchers(v_room1)
    where user_id = v_alice;
  perform pg_temp.check(v_count = 1, 'the one suggestion bob sees is alice');

  -- The exclusions hold in the other direction too.
  perform pg_temp.act_as(v_frank);
  select count(*) into v_count from public.list_live_room_co_watchers(v_room1)
    where user_id = v_bob;
  perform pg_temp.check(v_count = 0, 'the blocked side never sees the blocker');
  perform pg_temp.act_as(v_erin);
  select count(*) into v_count from public.list_live_room_co_watchers(v_room1)
    where user_id = v_bob;
  perform pg_temp.check(v_count = 0, 'a pending request hides the sender from the recipient');

  -- -------------------------------------------------------------------------
  -- Staleness: two minutes is the freshness horizon.
  -- -------------------------------------------------------------------------

  perform pg_temp.act_as_admin();
  update public.live_room_social_presence
    set last_seen_at = now() - interval '3 minutes'
    where user_id = v_bob;

  perform pg_temp.act_as(v_alice);
  select count(*) into v_count from public.list_live_room_co_watchers(v_room1)
    where user_id = v_bob;
  perform pg_temp.check(v_count = 0, 'a stale co-watcher disappears from the list');

  perform pg_temp.act_as(v_bob);
  perform pg_temp.expect_raise(
    format('select * from public.list_live_room_co_watchers(%L)', v_room1), 'forbidden',
    'a stale caller must heartbeat again before listing');

  -- -------------------------------------------------------------------------
  -- Leave and opportunistic cleanup.
  -- -------------------------------------------------------------------------

  perform pg_temp.act_as(v_dave);
  perform pg_temp.check(
    public.leave_live_room_social(v_room1) = 'ok',
    'leave succeeds');
  perform pg_temp.act_as_admin();
  select count(*) into v_count from public.live_room_social_presence where user_id = v_dave;
  perform pg_temp.check(v_count = 0, 'leave deletes only the caller''s row');
  select count(*) into v_count from public.live_room_social_presence;
  perform pg_temp.check(v_count = 4, 'other rows survive a leave');

  update public.live_room_social_presence
    set last_seen_at = now() - interval '11 minutes'
    where user_id = v_frank;
  perform pg_temp.act_as(v_alice);
  perform pg_temp.check(
    public.heartbeat_live_room_social(v_room1, 'alice-p') = 'ok',
    'alice heartbeats again');
  perform pg_temp.act_as_admin();
  select count(*) into v_count from public.live_room_social_presence where user_id = v_frank;
  perform pg_temp.check(v_count = 0, 'rows past ten minutes are cleaned up opportunistically');

  -- -------------------------------------------------------------------------
  -- The stored key can never leak a room code.
  -- -------------------------------------------------------------------------

  select count(*) into v_count from public.live_room_social_presence
    where room_key_hash !~ '^[0-9a-f]{64}$'
       or position(v_room1 in upper(room_key_hash)) > 0;
  perform pg_temp.check(v_count = 0, 'stored keys are 64-hex HMACs, never room codes');

  -- -------------------------------------------------------------------------
  -- Anonymous callers are refused outright.
  -- -------------------------------------------------------------------------

  perform pg_temp.act_as_anon();
  perform pg_temp.expect_raise(
    format('select public.heartbeat_live_room_social(%L, ''p'')', v_room1), null,
    'anon cannot heartbeat');
  perform pg_temp.expect_raise(
    format('select * from public.list_live_room_co_watchers(%L)', v_room1), null,
    'anon cannot list');

  -- -------------------------------------------------------------------------
  -- social_diagnostics(): callable without a session, truthful either way.
  -- -------------------------------------------------------------------------

  select public.social_diagnostics() into v_diag;
  perform pg_temp.check(v_diag->>'hasSession' = 'false', 'diagnostics reports no session for anon');
  perform pg_temp.check(
    (v_diag->'functions'->>'send_message')::boolean
      and (v_diag->'functions'->>'heartbeat_live_room_social')::boolean
      and (v_diag->'functions'->>'list_live_room_co_watchers')::boolean,
    'diagnostics reports the social functions as deployed');

  perform pg_temp.act_as(v_alice);
  select public.social_diagnostics() into v_diag;
  perform pg_temp.check(v_diag->>'hasSession' = 'true', 'diagnostics reports the caller''s session');

  perform pg_temp.act_as_admin();
  raise notice 'Phase 31 live-room social tests: ALL CHECKS PASSED';
end;
$$;

rollback;
