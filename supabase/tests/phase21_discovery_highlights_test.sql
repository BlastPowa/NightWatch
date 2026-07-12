-- Phase 21 acceptance tests: club discovery + highlight reels.
--
-- HOW TO RUN. Paste into the Supabase SQL Editor and run. It creates throwaway
-- users, asserts, and ROLLS BACK — safe against the live project.
--
-- Requires 0001–0016.

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
  owner_id uuid := gen_random_uuid();
  seeker uuid := gen_random_uuid();
  blocker uuid := gen_random_uuid();
  club uuid;
  found bigint;
  room text := 'HK2345';
  session_id uuid;
  top_video text;
  top_pos double precision;
  hl_count bigint;
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (owner_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'd-owner@test.local'),
    (seeker,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'd-seeker@test.local'),
    (blocker,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'd-blocker@test.local');

  insert into player_stats (user_id, display_name) values
    (owner_id, 'Owner'), (seeker, 'Seeker'), (blocker, 'Blocker');

  -- =========================================================================
  -- Clubs are private by default.
  -- =========================================================================
  perform pg_temp.act_as(owner_id);
  club := create_club('Midnight Cinema', 'horror only');

  perform pg_temp.act_as(seeker);
  select count(*) into found from search_clubs('Midnight');
  perform pg_temp.check(found = 0,
    'a new club is private and does not appear in the directory');

  -- =========================================================================
  -- Opting in lists it. Only the owner may.
  -- =========================================================================
  perform pg_temp.expect_raise(
    format('select set_club_visibility(%L, ''public'')', club),
    'forbidden',
    'a non-owner cannot list someone else''s club');

  perform pg_temp.act_as(owner_id);
  perform set_club_visibility(club, 'public');

  perform pg_temp.act_as(seeker);
  select count(*) into found from search_clubs('midnight');
  perform pg_temp.check(found = 1, 'a public club is discoverable, case-insensitively');

  select count(*) into found from search_clubs('');
  perform pg_temp.check(found = 1, 'an empty query browses the directory');

  select count(*) into found from search_clubs('nonexistent');
  perform pg_temp.check(found = 0, 'a non-matching query returns nothing');

  -- =========================================================================
  -- A block cuts discovery both ways.
  -- =========================================================================
  perform pg_temp.act_as(blocker);
  perform block_user(owner_id);
  select count(*) into found from search_clubs('midnight');
  perform pg_temp.check(found = 0,
    'a club owned by someone you blocked is absent from your directory');

  -- =========================================================================
  -- Suspension removes it from the directory AND closes the door.
  -- =========================================================================
  perform pg_temp.act_as(owner_id);
  perform set_club_suspended(club, true);

  perform pg_temp.act_as(seeker);
  select count(*) into found from search_clubs('midnight');
  perform pg_temp.check(found = 0, 'a suspended club leaves the directory');

  -- The key one: holding the club id is not a bypass.
  perform pg_temp.expect_raise(
    format('select join_club(%L)', club),
    'forbidden',
    'a suspended club refuses joins even from someone with a direct link');

  perform pg_temp.act_as(owner_id);
  perform set_club_suspended(club, false);

  perform pg_temp.act_as(seeker);
  perform join_club(club);
  perform pg_temp.check(is_club_member(club, seeker),
    'reinstating a club lets people join again');

  select count(*) into found from search_clubs('midnight') where is_member;
  perform pg_temp.check(found = 1, 'the directory reports that you are already a member');

  perform pg_temp.check(
    exists (select 1 from creator_audit_log where club_id = club and action = 'club.suspend'),
    'suspension is audited');

  -- =========================================================================
  -- Highlights.
  -- =========================================================================
  perform pg_temp.act_as(owner_id);
  insert into rooms (code, name, owner_id, insights_enabled)
    values (room, 'Highlight Room', owner_id, true);
  insert into room_sessions (room_code) values (room) returning id into session_id;

  -- Buckets are 15s wide, so a cluster must sit inside ONE bucket to count as
  -- one moment: 91/95/100/104 all land in bucket 6 (90–105). A pair at 300/302
  -- lands in bucket 20. The lone reaction at 900 must NOT become a highlight.
  insert into session_events (session_id, kind, value, video_id) values
    (session_id, 'reaction', 91, 'aaaaaaaaaaa'),
    (session_id, 'reaction', 95, 'aaaaaaaaaaa'),
    (session_id, 'reaction', 100, 'aaaaaaaaaaa'),
    (session_id, 'reaction', 104, 'aaaaaaaaaaa'),
    (session_id, 'reaction', 300, 'bbbbbbbbbbb'),
    (session_id, 'reaction', 302, 'bbbbbbbbbbb'),
    (session_id, 'reaction', 900, 'bbbbbbbbbbb'),
    -- Pre-0016 rows carry no video and cannot be attributed to one. These are a
    -- cluster by count, so if attribution were skipped they WOULD rank.
    (session_id, 'reaction', 100, null),
    (session_id, 'reaction', 101, null),
    (session_id, 'reaction', 102, null),
    -- Non-reactions are not highlights.
    (session_id, 'play', 100, 'aaaaaaaaaaa'),
    (session_id, 'members', 4, 'aaaaaaaaaaa');

  select count(*) into hl_count from get_session_highlights(session_id);
  perform pg_temp.check(hl_count = 2,
    'only clustered, attributable reactions become highlights');

  select video_id, position_seconds into top_video, top_pos
  from get_session_highlights(session_id) limit 1;

  perform pg_temp.check(top_video = 'aaaaaaaaaaa',
    'the busiest moment ranks first');
  -- Bucket 6 (90–105s) opens at 90; the 5s lead-in pulls the clip back to 85 so
  -- the export lands before the payoff, not on top of it.
  perform pg_temp.check(top_pos = 85,
    'the clip starts before the reaction, not at it');

  perform pg_temp.check(
    not exists (
      select 1 from get_session_highlights(session_id) where video_id is null
    ),
    'an unattributable reaction never becomes a highlight');

  -- Insights are the room owner's alone (ADR-014).
  perform pg_temp.act_as(seeker);
  perform pg_temp.expect_raise(
    format('select * from get_session_highlights(%L)', session_id),
    'forbidden',
    'a non-owner cannot read another room''s highlights');

  -- =========================================================================
  -- Compliance: nothing in this feature can carry media.
  -- =========================================================================
  perform pg_temp.check(
    not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'session_events'
        and column_name in ('media_url', 'clip_url', 'file_path', 'download_url')
    ),
    'a highlight is a timestamp — no column exists that could carry video');

  raise notice 'ALL PHASE 21 DISCOVERY + HIGHLIGHT TESTS PASSED';
end;
$$;

rollback;
