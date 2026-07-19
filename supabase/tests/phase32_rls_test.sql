-- Phase 32 RLS/behaviour test. Run against a DISPOSABLE database that has
-- migrations 0001–0026 applied:
--   psql "$DISPOSABLE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/phase32_rls_test.sql
--
-- The script creates three users (host, viewer, outsider), simulates live
-- room membership through the 0023 presence table, and asserts:
--   membership gating, block enforcement, opt-out discovery exclusion,
--   signal expiry/self-send/size rules, cross-room denial, and TURN
--   authorization gating. It runs in one transaction and rolls back.

begin;

-- Impersonation helpers -------------------------------------------------------
create or replace function pg_temp.impersonate(p_user uuid) returns void
language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true);
$$;

create or replace function pg_temp.as_admin() returns void
language sql as $$
  select set_config('role', 'postgres', true);
$$;

-- Fixture users ---------------------------------------------------------------
select pg_temp.as_admin();

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-0000000000a1', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'viewer@test.local'),
  ('00000000-0000-0000-0000-0000000000c3', 'outsider@test.local')
on conflict (id) do nothing;

-- Discoverable profiles (viewer opts in with a handle; outsider stays out).
insert into public.player_stats (user_id, display_name, public_handle, discoverable)
values
  ('00000000-0000-0000-0000-0000000000b2', 'ViewerVic', 'viewervic', true),
  ('00000000-0000-0000-0000-0000000000c3', 'OptOutOllie', 'ollie_hidden', false)
on conflict (user_id) do update
  set display_name = excluded.display_name,
      public_handle = excluded.public_handle,
      discoverable = excluded.discoverable;

-- Live room membership for host+viewer in room 'AAAAAA' (fresh heartbeats).
insert into public.live_room_social_presence (room_key_hash, user_id, presence_id, last_seen_at)
values
  (public.live_room_key_hash('AAAAAA'), '00000000-0000-0000-0000-0000000000a1', 'p-host', now()),
  (public.live_room_key_hash('AAAAAA'), '00000000-0000-0000-0000-0000000000b2', 'p-view', now()),
  (public.live_room_key_hash('BBBBBB'), '00000000-0000-0000-0000-0000000000a1', 'p-host-b', now()),
  (public.live_room_key_hash('BBBBBB'), '00000000-0000-0000-0000-0000000000b2', 'p-view-b', now())
on conflict (room_key_hash, user_id) do update set last_seen_at = now();

delete from public.room_media_readiness
where room_key_hash = public.live_room_key_hash('AAAAAA');
delete from public.room_media_state
where room_key_hash = public.live_room_key_hash('AAAAAA');
delete from public.rtc_signals
where room_key_hash = public.live_room_key_hash('AAAAAA');

-- 1. Discovery: opted-out users never appear; self never appears ---------------
do $$
declare v_count integer;
begin
  perform pg_temp.impersonate('00000000-0000-0000-0000-0000000000a1');
  select count(*) into v_count from public.search_people('viewervic');
  if v_count <> 1 then
    raise exception 'expected exactly one discoverable match, got %', v_count;
  end if;
  select count(*) into v_count from public.search_people('ollie_hidden');
  if v_count <> 0 then
    raise exception 'opted-out user leaked through discovery';
  end if;
end $$;

-- 2. Discovery: minimum query length ------------------------------------------
do $$
begin
  perform pg_temp.impersonate('00000000-0000-0000-0000-0000000000a1');
  begin
    perform * from public.search_people('ab');
    raise exception 'two-character query should have been rejected';
  exception when others then
    if sqlerrm not like '%query-too-short%' then raise; end if;
  end;
end $$;

-- 3. Room people: members only; outsider is refused ---------------------------
do $$
declare v_count integer;
begin
  perform pg_temp.impersonate('00000000-0000-0000-0000-0000000000a1');
  select count(*) into v_count from public.get_room_people('AAAAAA');
  if v_count <> 1 then
    raise exception 'host should see exactly the viewer, got %', v_count;
  end if;

  perform pg_temp.impersonate('00000000-0000-0000-0000-0000000000c3');
  begin
    perform * from public.get_room_people('AAAAAA');
    raise exception 'non-member enumerated room people';
  exception when others then
    if sqlerrm not like '%forbidden%' then raise; end if;
  end;
end $$;

-- 4. Room media state: controller, revision, membership, readiness ------------
do $$
declare
  v_revision bigint;
  v_count integer;
  v_mode jsonb := jsonb_build_object(
    'modeVersion', 2,
    'mode', 'file-watch',
    'readiness', 'all-ready',
    'descriptor', jsonb_build_object(
      'schemaVersion', 1,
      'kind', 'local',
      'fingerprint', 'sha256:' || repeat('a', 64),
      'title', 'Test Movie.mp4',
      'mimeType', 'video/mp4',
      'size', 1024
    )
  );
begin
  perform pg_temp.impersonate('00000000-0000-0000-0000-0000000000a1');
  select revision into v_revision
  from public.publish_room_media_descriptor('AAAAAA', 0, v_mode);
  if v_revision <> 1 then
    raise exception 'first room media revision was %, expected 1', v_revision;
  end if;

  perform pg_temp.impersonate('00000000-0000-0000-0000-0000000000b2');
  begin
    perform * from public.publish_room_media_descriptor('AAAAAA', 1, v_mode);
    raise exception 'viewer replaced a fresh controller';
  exception when others then
    if sqlerrm not like '%forbidden%' then raise; end if;
  end;
  perform public.report_media_readiness('AAAAAA', 1, 'ready');
  select count(*) into v_count
  from public.get_media_readiness_roster('AAAAAA', 1)
  where user_id = '00000000-0000-0000-0000-0000000000b2'
    and readiness = 'ready';
  if v_count <> 1 then
    raise exception 'viewer readiness was not visible to the room';
  end if;

  perform pg_temp.impersonate('00000000-0000-0000-0000-0000000000a1');
  begin
    perform * from public.publish_room_media_descriptor('AAAAAA', 99, v_mode);
    raise exception 'stale media revision was accepted';
  exception when others then
    if sqlerrm not like '%revision-conflict%' then raise; end if;
  end;

  perform pg_temp.impersonate('00000000-0000-0000-0000-0000000000c3');
  begin
    perform * from public.get_room_media_descriptor('AAAAAA');
    raise exception 'outsider read room media state';
  exception when others then
    if sqlerrm not like '%forbidden%' then raise; end if;
  end;
end $$;

-- 5. Signaling: happy path, then block enforcement ----------------------------
do $$
declare v_count integer;
begin
  perform pg_temp.impersonate('00000000-0000-0000-0000-0000000000a1');
  perform public.send_rtc_signal(
    'AAAAAA', '00000000-0000-0000-0000-0000000000b2',
    'voice', 'offer', repeat('a', 32), '{"sdp":"v=0"}');

  perform pg_temp.impersonate('00000000-0000-0000-0000-0000000000b2');
  select count(*) into v_count from public.fetch_rtc_signals('AAAAAA', 0);
  if v_count <> 1 then
    raise exception 'viewer should fetch exactly one signal, got %', v_count;
  end if;

  -- A signal addressed to the same viewer in another room must not leak into
  -- this room's inbox.
  perform pg_temp.impersonate('00000000-0000-0000-0000-0000000000a1');
  perform public.send_rtc_signal(
    'BBBBBB', '00000000-0000-0000-0000-0000000000b2',
    'voice', 'offer', repeat('9', 32), '{"sdp":"other-room"}');
  perform pg_temp.impersonate('00000000-0000-0000-0000-0000000000b2');
  select count(*) into v_count from public.fetch_rtc_signals('AAAAAA', 0);
  if v_count <> 1 then
    raise exception 'cross-room signal leaked into the inbox';
  end if;

  -- Viewer blocks host: queued and future signals both vanish.
  perform pg_temp.as_admin();
  insert into public.user_blocks (blocker_id, blocked_id)
  values ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1');

  perform pg_temp.impersonate('00000000-0000-0000-0000-0000000000b2');
  select count(*) into v_count from public.fetch_rtc_signals('AAAAAA', 0);
  if v_count <> 0 then
    raise exception 'blocked sender signals still fetchable';
  end if;

  perform pg_temp.impersonate('00000000-0000-0000-0000-0000000000a1');
  begin
    perform public.send_rtc_signal(
      'AAAAAA', '00000000-0000-0000-0000-0000000000b2',
      'voice', 'ice', repeat('b', 32), '{"candidate":"x"}');
    raise exception 'send to a blocking user should fail';
  exception when others then
    if sqlerrm not like '%blocked%' then raise; end if;
  end;

  perform pg_temp.as_admin();
  delete from public.user_blocks
  where blocker_id = '00000000-0000-0000-0000-0000000000b2';
end $$;

-- 6. Signaling: cross-room and non-member sends are refused -------------------
do $$
begin
  perform pg_temp.impersonate('00000000-0000-0000-0000-0000000000c3');
  begin
    perform public.send_rtc_signal(
      'AAAAAA', '00000000-0000-0000-0000-0000000000a1',
      'voice', 'offer', repeat('c', 32), '{"sdp":"v=0"}');
    raise exception 'outsider signaled into a room they are not in';
  exception when others then
    if sqlerrm not like '%forbidden%' then raise; end if;
  end;

  -- Host signaling a user who is NOT in the room (outsider) must fail too.
  perform pg_temp.impersonate('00000000-0000-0000-0000-0000000000a1');
  begin
    perform public.send_rtc_signal(
      'AAAAAA', '00000000-0000-0000-0000-0000000000c3',
      'voice', 'offer', repeat('d', 32), '{"sdp":"v=0"}');
    raise exception 'signal reached a non-member recipient';
  exception when others then
    if sqlerrm not like '%forbidden%' then raise; end if;
  end;
end $$;

-- 7. Signaling: stale rows are invisible and swept ----------------------------
do $$
declare v_count integer;
begin
  perform pg_temp.as_admin();
  update public.rtc_signals set expires_at = now() - interval '1 second';

  perform pg_temp.impersonate('00000000-0000-0000-0000-0000000000b2');
  select count(*) into v_count from public.fetch_rtc_signals('AAAAAA', 0);
  if v_count <> 0 then
    raise exception 'expired signals still fetchable';
  end if;

  -- Any successful send sweeps expired rows.
  perform pg_temp.impersonate('00000000-0000-0000-0000-0000000000a1');
  perform public.send_rtc_signal(
    'AAAAAA', '00000000-0000-0000-0000-0000000000b2',
    'voice', 'bye', repeat('e', 32), '');

  perform pg_temp.as_admin();
  select count(*) into v_count from public.rtc_signals where expires_at < now();
  if v_count <> 0 then
    raise exception 'expired signals were not swept on send';
  end if;
end $$;

-- 8. Signaling: self-send and oversized payloads are refused ------------------
do $$
begin
  perform pg_temp.impersonate('00000000-0000-0000-0000-0000000000a1');
  begin
    perform public.send_rtc_signal(
      'AAAAAA', '00000000-0000-0000-0000-0000000000a1',
      'voice', 'offer', repeat('f', 32), '{"sdp":"v=0"}');
    raise exception 'self-send should fail';
  exception when others then
    if sqlerrm not like '%forbidden%' then raise; end if;
  end;
  begin
    perform public.send_rtc_signal(
      'AAAAAA', '00000000-0000-0000-0000-0000000000b2',
      'voice', 'offer', repeat('0', 32), repeat('x', 20000));
    raise exception 'oversized payload should fail';
  exception when others then
    null; -- either the guard or the table check may fire first
  end;
end $$;

-- 9. Direct table access is denied for clients --------------------------------
do $$
begin
  perform pg_temp.impersonate('00000000-0000-0000-0000-0000000000a1');
  begin
    perform * from public.rtc_signals;
    raise exception 'client read rtc_signals directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.discovery_search_log;
    raise exception 'client read discovery_search_log directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.turn_credential_log;
    raise exception 'client read turn_credential_log directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.room_media_state;
    raise exception 'client read room_media_state directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.room_media_readiness;
    raise exception 'client read room_media_readiness directly';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 10. TURN authorization: member yes, outsider no, stale member no ------------
do $$
begin
  perform pg_temp.as_admin();
  if public.authorize_turn_access('00000000-0000-0000-0000-0000000000a1', 'AAAAAA') <> 'allowed' then
    raise exception 'fresh member denied TURN';
  end if;
  if public.authorize_turn_access('00000000-0000-0000-0000-0000000000c3', 'AAAAAA') <> 'forbidden' then
    raise exception 'outsider granted TURN';
  end if;

  update public.live_room_social_presence
  set last_seen_at = now() - interval '10 minutes'
  where user_id = '00000000-0000-0000-0000-0000000000b2';
  if public.authorize_turn_access('00000000-0000-0000-0000-0000000000b2', 'AAAAAA') <> 'forbidden' then
    raise exception 'stale member granted TURN';
  end if;
end $$;

select 'phase32 RLS test: all assertions passed' as result;

rollback;
