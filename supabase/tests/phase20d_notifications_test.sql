-- Phase 20D acceptance tests: notification emitters.
--
-- HOW TO RUN. Paste into the Supabase SQL Editor and run. It creates throwaway
-- users, asserts, and ROLLS BACK — safe against the live project. Any failed
-- assertion aborts with a message naming the case.
--
-- Requires 0011, 0012, and 0013.

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

-- How many notifications of this kind is this user holding?
create or replace function pg_temp.inbox(p_user uuid, p_kind text)
returns bigint
language sql
as $$
  select count(*) from notifications where user_id = p_user and kind = p_kind;
$$;

do $$
declare
  owner_id uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid();
  rival_id uuid := gen_random_uuid();
  blocked_id uuid := gen_random_uuid();
  club uuid;
  bounty uuid;
  sub_member uuid;
  sub_blocked uuid;
  report_id uuid;
  unread integer;
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (owner_id,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n-owner@test.local'),
    (member_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n-member@test.local'),
    (rival_id,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n-rival@test.local'),
    (blocked_id,'00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n-blocked@test.local');

  insert into player_stats (user_id, display_name) values
    (owner_id, 'Owner'), (member_id, 'Member'), (rival_id, 'Rival'), (blocked_id, 'Blocked');

  perform pg_temp.act_as(owner_id);
  club := create_club('Notify Club', 'emitters');

  perform pg_temp.act_as(member_id);
  perform join_club(club);
  perform pg_temp.act_as(rival_id);
  perform join_club(club);

  -- blocked_id joins BEFORE the block exists, so their membership is real and
  -- the only thing suppressing delivery later is the block itself.
  perform pg_temp.act_as(blocked_id);
  perform join_club(club);

  -- =========================================================================
  -- bounty.open fans out to the club — but not to its author.
  -- =========================================================================
  perform pg_temp.act_as(owner_id);
  bounty := create_bounty(club, 'Best edit', 'brief');

  perform pg_temp.check(pg_temp.inbox(member_id, 'bounty.open') = 0,
    'a draft bounty notifies nobody');

  perform set_bounty_status(bounty, 'open');

  perform pg_temp.check(pg_temp.inbox(member_id, 'bounty.open') = 1,
    'opening a bounty notifies club members');
  perform pg_temp.check(pg_temp.inbox(rival_id, 'bounty.open') = 1,
    'opening a bounty notifies every member');
  perform pg_temp.check(pg_temp.inbox(owner_id, 'bounty.open') = 0,
    'the staffer who opened the bounty is not notified of their own action');

  -- Idempotent re-set must not re-notify: the trigger is on an actual change.
  perform set_bounty_status(bounty, 'open');
  perform pg_temp.check(pg_temp.inbox(member_id, 'bounty.open') = 1,
    're-setting the same status does not send a second notification');

  -- =========================================================================
  -- Blocks sever notification delivery.
  -- =========================================================================
  perform pg_temp.act_as(blocked_id);
  perform block_user(owner_id);

  perform pg_temp.act_as(owner_id);
  bounty := create_bounty(club, 'Second', 'brief');
  perform set_bounty_status(bounty, 'open');

  perform pg_temp.check(pg_temp.inbox(blocked_id, 'bounty.open') = 0,
    'a member who blocked the actor receives no notification');
  perform pg_temp.check(pg_temp.inbox(member_id, 'bounty.open') = 2,
    'one blocked member does not suppress the fan-out for everyone else');

  -- =========================================================================
  -- Submission verdicts reach the submitter.
  -- =========================================================================
  perform pg_temp.act_as(member_id);
  sub_member := submit_to_bounty(bounty, 'vid00000001', 'my entry');

  perform pg_temp.act_as(blocked_id);
  sub_blocked := submit_to_bounty(bounty, 'vid00000002', 'their entry');

  perform pg_temp.act_as(owner_id);
  perform set_submission_status(sub_member, 'accepted');

  perform pg_temp.check(pg_temp.inbox(member_id, 'submission.accepted') = 1,
    'an accepted submission notifies its submitter');
  perform pg_temp.check(pg_temp.inbox(rival_id, 'submission.accepted') = 0,
    'a verdict is private to the submitter, not broadcast to the club');

  perform set_submission_status(sub_blocked, 'rejected');
  perform pg_temp.check(pg_temp.inbox(blocked_id, 'submission.rejected') = 0,
    'a block suppresses the verdict notification too');

  -- A withdrawal is the submitter's own action and notifies nobody.
  perform pg_temp.act_as(rival_id);
  perform submit_to_bounty(bounty, 'vid00000003', 'rival entry');
  perform set_submission_status(
    (select id from bounty_submissions where bounty_id = bounty and submitter_id = rival_id),
    'withdrawn');
  perform pg_temp.check(pg_temp.inbox(rival_id, 'submission.withdrawn') = 0,
    'withdrawing your own entry notifies nobody');

  -- =========================================================================
  -- judging / closed reach entrants only, and skip the withdrawn.
  -- =========================================================================
  perform pg_temp.act_as(owner_id);
  perform set_bounty_status(bounty, 'judging');

  perform pg_temp.check(pg_temp.inbox(member_id, 'bounty.judging') = 1,
    'judging notifies people with an entry at stake');
  perform pg_temp.check(pg_temp.inbox(rival_id, 'bounty.judging') = 0,
    'a withdrawn entrant is not notified that judging began');

  perform set_bounty_status(bounty, 'closed');
  perform pg_temp.check(pg_temp.inbox(member_id, 'bounty.closed') = 1,
    'closing notifies entrants');

  -- =========================================================================
  -- Club role changes.
  -- =========================================================================
  perform set_club_role(club, member_id, 'moderator');
  perform pg_temp.check(pg_temp.inbox(member_id, 'club.role') = 1,
    'being promoted notifies you');
  perform pg_temp.check(pg_temp.inbox(rival_id, 'club.role') = 0,
    'someone else being promoted does not notify you');

  -- =========================================================================
  -- Report resolution closes the loop for the reporter, anonymously.
  -- =========================================================================
  perform pg_temp.act_as(rival_id);
  perform report_content('bounty', bounty::text, 'spam');
  select id into report_id from creator_reports
    where reporter_id = rival_id and target_id = bounty::text;

  perform pg_temp.check(pg_temp.inbox(rival_id, 'report.resolved') = 0,
    'filing a report does not immediately notify the reporter');

  perform pg_temp.act_as(owner_id);
  perform resolve_report(report_id, 'actioned', club);

  perform pg_temp.check(pg_temp.inbox(rival_id, 'report.resolved') = 1,
    'resolving a report notifies the reporter');
  perform pg_temp.check(
    not exists (
      select 1 from notifications
      where user_id = rival_id and kind = 'report.resolved'
        and payload ? 'resolvedBy'
    ),
    'the resolution notification does not name the moderator who handled it');

  -- =========================================================================
  -- Unread count and mark-all-read.
  -- =========================================================================
  perform pg_temp.act_as(member_id);
  unread := count_unread_notifications();
  perform pg_temp.check(unread > 0, 'unread count sees the notifications');

  perform mark_all_notifications_read();
  perform pg_temp.check(count_unread_notifications() = 0,
    'mark-all-read zeroes the unread count');

  -- Someone else marking their inbox read leaves yours alone.
  perform pg_temp.act_as(rival_id);
  perform pg_temp.check(count_unread_notifications() > 0,
    'one user marking read does not clear another user''s inbox');

  -- =========================================================================
  -- A client cannot forge a notification: there is no INSERT policy.
  -- =========================================================================
  perform pg_temp.check(
    not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'notifications' and cmd = 'INSERT'
    ),
    'notifications has no INSERT policy — only the server writes them');

  raise notice 'ALL PHASE 20D TESTS PASSED';
end;
$$;

rollback;
