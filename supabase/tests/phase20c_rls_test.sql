-- Phase 20C acceptance tests: clubs, bounty status machine, vote integrity,
-- moderation, audit log.
--
-- HOW TO RUN. Paste into the Supabase SQL Editor and run. It creates throwaway
-- users, asserts, and ROLLS BACK — safe against the live project. Any failed
-- assertion aborts with a message naming the case.

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
  mod_id uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  club uuid;
  bounty uuid;
  sub_member uuid;
  sub_mod uuid;
  report uuid;
  cnt bigint;
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (owner_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@test.local'),
    (mod_id,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mod@test.local'),
    (member_id,'00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'member@test.local'),
    (outsider, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outsider@test.local');

  insert into player_stats (user_id, display_name) values
    (owner_id, 'Owner'), (mod_id, 'Mod'), (member_id, 'Member'), (outsider, 'Outsider');

  -- =========================================================================
  -- Club creation and roles.
  -- =========================================================================
  perform pg_temp.act_as(owner_id);
  club := create_club('Test Club', 'a club');
  perform pg_temp.check(is_club_staff(club, owner_id), 'creator is club staff');

  perform pg_temp.act_as(mod_id);
  perform join_club(club);
  perform pg_temp.act_as(member_id);
  perform join_club(club);

  perform pg_temp.act_as(owner_id);
  perform set_club_role(club, mod_id, 'moderator');
  perform pg_temp.check(is_club_staff(club, mod_id), 'owner can promote a moderator');
  perform pg_temp.check(not is_club_staff(club, member_id), 'a member is not staff');

  -- A moderator cannot mint moderators.
  perform pg_temp.act_as(mod_id);
  perform pg_temp.expect_raise(
    format('select set_club_role(%L, %L, %L)', club, member_id, 'moderator'),
    'forbidden',
    'moderator cannot promote another moderator'
  );

  -- The owner cannot be removed, nor walk away and orphan the club.
  perform pg_temp.expect_raise(
    format('select remove_club_member(%L, %L)', club, owner_id),
    'forbidden',
    'owner cannot be removed by a moderator'
  );
  perform pg_temp.act_as(owner_id);
  perform pg_temp.expect_raise(
    format('select leave_club(%L)', club),
    'forbidden',
    'owner cannot leave the club'
  );

  -- Non-members see nothing.
  perform pg_temp.act_as(outsider);
  perform pg_temp.expect_raise(
    format('select * from list_bounties(%L)', club),
    'forbidden',
    'non-member cannot list bounties'
  );

  -- =========================================================================
  -- Bounty status machine. Illegal transitions must be refused.
  -- =========================================================================
  perform pg_temp.act_as(owner_id);
  bounty := create_bounty(club, 'Best edit', 'brief');

  -- A member cannot create a bounty.
  perform pg_temp.act_as(member_id);
  perform pg_temp.expect_raise(
    format('select create_bounty(%L, %L)', club, 'Sneaky'),
    'forbidden',
    'ordinary member cannot create a bounty'
  );

  -- A draft is invisible to ordinary members but visible to staff.
  perform pg_temp.check(
    not exists (select 1 from list_bounties(club) where id = bounty),
    'draft bounty is hidden from ordinary members'
  );
  perform pg_temp.act_as(owner_id);
  perform pg_temp.check(
    exists (select 1 from list_bounties(club) where id = bounty),
    'draft bounty is visible to staff'
  );

  -- draft cannot jump straight to closed.
  perform pg_temp.expect_raise(
    format('select set_bounty_status(%L, %L)', bounty, 'closed'),
    'forbidden',
    'draft cannot skip to closed'
  );

  -- Submissions are refused while the bounty is a draft.
  perform pg_temp.act_as(member_id);
  perform pg_temp.expect_raise(
    format('select submit_to_bounty(%L, %L)', bounty, 'AAAAAAAAAAA'),
    'forbidden',
    'cannot submit to a draft bounty'
  );

  perform pg_temp.act_as(owner_id);
  perform set_bounty_status(bounty, 'open');
  perform set_bounty_status(bounty, 'open');  -- Idempotent.

  -- =========================================================================
  -- Submissions.
  -- =========================================================================
  perform pg_temp.act_as(member_id);
  sub_member := submit_to_bounty(bounty, 'AAAAAAAAAAA', 'my entry');

  -- Re-submitting replaces rather than floods: one entry per person.
  perform submit_to_bounty(bounty, 'BBBBBBBBBBB', 'changed my mind');
  select count(*) into cnt from bounty_submissions
  where bounty_id = bounty and submitter_id = member_id;
  perform pg_temp.check(cnt = 1, 're-submitting replaces the entry rather than adding one');

  perform pg_temp.act_as(mod_id);
  sub_mod := submit_to_bounty(bounty, 'CCCCCCCCCCC', 'mod entry');

  -- An outsider cannot submit.
  perform pg_temp.act_as(outsider);
  perform pg_temp.expect_raise(
    format('select submit_to_bounty(%L, %L)', bounty, 'DDDDDDDDDDD'),
    'forbidden',
    'non-member cannot submit'
  );

  -- =========================================================================
  -- Vote integrity. This is the part with a competitive outcome, so it is the
  -- part someone has an incentive to game.
  -- =========================================================================

  -- Voting is refused before judging opens: you cannot vote on a field that is
  -- still being assembled.
  perform pg_temp.act_as(member_id);
  perform pg_temp.expect_raise(
    format('select cast_vote(%L)', sub_mod),
    'forbidden',
    'cannot vote while the bounty is still open for entries'
  );

  perform pg_temp.act_as(owner_id);
  perform set_bounty_status(bounty, 'judging');

  -- Entries close once judging starts.
  perform pg_temp.act_as(member_id);
  perform pg_temp.expect_raise(
    format('select submit_to_bounty(%L, %L)', bounty, 'EEEEEEEEEEE'),
    'forbidden',
    'cannot submit once judging has started'
  );

  -- No voting for yourself.
  perform pg_temp.expect_raise(
    format('select cast_vote(%L)', sub_member),
    'forbidden',
    'cannot vote for your own submission'
  );

  -- One vote per bounty: a second vote MOVES the vote, it does not add one.
  perform cast_vote(sub_mod);
  select count(*) into cnt from bounty_votes where bounty_id = bounty and voter_id = member_id;
  perform pg_temp.check(cnt = 1, 'one vote per voter per bounty');

  perform pg_temp.act_as(owner_id);
  perform cast_vote(sub_member);
  perform cast_vote(sub_mod);  -- Owner changes their mind.
  select count(*) into cnt from bounty_votes where bounty_id = bounty and voter_id = owner_id;
  perform pg_temp.check(cnt = 1, 'changing your vote moves it rather than adding one');
  perform pg_temp.check(
    (select submission_id from bounty_votes where bounty_id = bounty and voter_id = owner_id)
      = sub_mod,
    'the moved vote points at the new submission'
  );

  -- The tally reflects exactly the two live votes.
  perform pg_temp.check(
    (select votes from get_bounty_results(bounty) where submission_id = sub_mod) = 2,
    'vote tally counts both voters'
  );
  perform pg_temp.check(
    (select votes from get_bounty_results(bounty) where submission_id = sub_member) = 0,
    'the retracted/moved vote no longer counts for the old submission'
  );

  -- A non-member cannot vote.
  perform pg_temp.act_as(outsider);
  perform pg_temp.expect_raise(
    format('select cast_vote(%L)', sub_mod),
    'forbidden',
    'non-member cannot vote'
  );

  -- Blocking severs voting in both directions.
  perform pg_temp.act_as(member_id);
  perform block_user(mod_id);
  perform pg_temp.expect_raise(
    format('select cast_vote(%L)', sub_mod),
    'blocked',
    'cannot vote for someone a block stands between'
  );
  perform pg_temp.check(
    not exists (select 1 from get_bounty_results(bounty) where submission_id = sub_mod),
    'a blocked submitter is absent from results'
  );
  perform unblock_user(mod_id);

  -- Retracting is idempotent.
  perform retract_vote(bounty);
  perform retract_vote(bounty);
  select count(*) into cnt from bounty_votes where bounty_id = bounty and voter_id = member_id;
  perform pg_temp.check(cnt = 0, 'retract_vote removes the vote and is idempotent');

  -- Ballots are secret. This runs as the table owner, so RLS is bypassed and a
  -- direct SELECT would prove nothing — assert the POLICY instead: the only way
  -- to read bounty_votes is your own row, so a member cannot see who else voted.
  -- Tallies come from get_bounty_results, which returns counts, never ballots.
  perform pg_temp.check(
    exists (
      select 1 from pg_policies
      where tablename = 'bounty_votes' and cmd = 'SELECT' and qual like '%voter_id%'
    ),
    'bounty_votes is readable only by the voter (ballots are secret)'
  );

  -- =========================================================================
  -- Judging and closing.
  -- =========================================================================
  perform pg_temp.act_as(member_id);
  perform pg_temp.expect_raise(
    format('select set_submission_status(%L, %L)', sub_mod, 'accepted'),
    'forbidden',
    'ordinary member cannot accept a submission'
  );

  -- The submitter may withdraw their own entry, and only their own.
  perform set_submission_status(sub_member, 'withdrawn');
  perform pg_temp.check(
    not exists (select 1 from get_bounty_results(bounty) where submission_id = sub_member),
    'a withdrawn submission disappears from results'
  );
  perform pg_temp.expect_raise(
    format('select set_submission_status(%L, %L)', sub_mod, 'withdrawn'),
    'forbidden',
    'cannot withdraw someone else''s submission'
  );

  perform pg_temp.act_as(owner_id);
  perform set_submission_status(sub_mod, 'accepted');
  perform set_bounty_status(bounty, 'closed');

  -- A closed bounty is final: no reopening.
  perform pg_temp.expect_raise(
    format('select set_bounty_status(%L, %L)', bounty, 'open'),
    'forbidden',
    'a closed bounty cannot be reopened'
  );

  -- =========================================================================
  -- Moderation and the audit log.
  -- =========================================================================
  perform pg_temp.act_as(member_id);
  perform report_content('submission', sub_mod::text, 'spam');
  perform report_content('submission', sub_mod::text, 'spam again');  -- Idempotent.
  select count(*) into cnt from creator_reports
  where target_id = sub_mod::text and reporter_id = member_id;
  perform pg_temp.check(cnt = 1, 're-reporting the same target does not stack');

  -- A member cannot see or resolve the moderation queue.
  perform pg_temp.expect_raise(
    format('select * from list_club_reports(%L)', club),
    'forbidden',
    'ordinary member cannot read the moderation queue'
  );

  perform pg_temp.act_as(mod_id);
  select id into report from list_club_reports(club) limit 1;
  perform pg_temp.check(report is not null, 'staff can read the moderation queue');
  perform resolve_report(report, 'dismissed', club);
  perform pg_temp.expect_raise(
    format('select resolve_report(%L, %L, %L)', report, 'dismissed', club),
    'forbidden',
    'an already-resolved report cannot be resolved twice'
  );

  -- The audit log recorded the whole story, and is staff-only.
  perform pg_temp.check(
    (select count(*) from get_club_audit(club)) > 5,
    'audit log recorded the club/bounty/vote/report actions'
  );
  perform pg_temp.check(
    exists (select 1 from get_club_audit(club) where action = 'bounty.status'),
    'bounty status transitions are audited'
  );
  perform pg_temp.check(
    exists (select 1 from get_club_audit(club) where action = 'report.resolve'),
    'report resolutions are audited'
  );

  perform pg_temp.act_as(member_id);
  perform pg_temp.expect_raise(
    format('select * from get_club_audit(%L)', club),
    'forbidden',
    'ordinary member cannot read the audit log'
  );

  -- The audit log is append-only: there is no UPDATE or DELETE policy, so even
  -- the owner cannot rewrite history through the API.
  perform pg_temp.check(
    not exists (
      select 1 from pg_policies
      where tablename = 'creator_audit_log' and cmd in ('UPDATE', 'DELETE')
    ),
    'audit log has no update/delete policy (append-only)'
  );

  -- Likewise, no client-writable path to move a bounty status or a verdict.
  perform pg_temp.check(
    not exists (
      select 1 from pg_policies
      where tablename in ('creator_bounties', 'bounty_submissions', 'bounty_votes')
        and cmd in ('UPDATE', 'DELETE')
    ),
    'bounties/submissions/votes have no direct update policy (RPC-only)'
  );

  -- =========================================================================
  -- Scope boundary: no money anywhere in this feature.
  -- =========================================================================
  perform pg_temp.check(
    not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name in ('creator_clubs', 'creator_bounties', 'bounty_submissions')
        and (column_name like '%amount%' or column_name like '%price%'
             or column_name like '%currency%' or column_name like '%payout%'
             or column_name like '%reward%')
    ),
    'no payment/reward columns exist (handoff scope boundary)'
  );

  -- Unauthenticated callers are turned away.
  perform set_config('request.jwt.claims', null, true);
  perform pg_temp.expect_raise(
    'select * from list_my_clubs()',
    'unauthenticated',
    'unauthenticated caller is rejected'
  );

  raise notice 'ALL PHASE 20C TESTS PASSED';
end;
$$;

rollback;
