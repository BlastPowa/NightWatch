-- Phase 20C RPCs: clubs, bounties, submissions, votes, moderation.
-- Apply AFTER 0011_creator_clubs.sql. Rollback notes at the bottom.
--
-- Same rules as 20B: security definer, so each function is only as safe as its
-- own checks. auth via require_auth(), blocking via is_blocked() (20B), and
-- every state change writes creator_audit_log — the log is append-only, so not
-- even a club owner can rewrite the record of what they did.

-- Explicit, audited status machine. A client can never UPDATE a bounty row
-- directly (there is no update policy), so this is the only way status moves.
create or replace function public.audit(
  p_club uuid,
  p_actor uuid,
  p_action text,
  p_target_kind text,
  p_target_id text,
  p_detail text default ''
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into creator_audit_log (club_id, actor_id, action, target_kind, target_id, detail)
  values (p_club, p_actor, p_action, p_target_kind, p_target_id, left(coalesce(p_detail, ''), 500));
$$;

-- ---------------------------------------------------------------------------
-- Clubs.
-- ---------------------------------------------------------------------------

create or replace function public.create_club(p_name text, p_description text default '')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
  new_id uuid;
begin
  if p_name is null or char_length(trim(p_name)) = 0 then
    raise exception 'forbidden';
  end if;
  if not public.under_limit_clubs(me) then
    raise exception 'rate-limited';
  end if;

  insert into creator_clubs (name, description, owner_id)
  values (left(trim(p_name), 60), left(coalesce(p_description, ''), 500), me)
  returning id into new_id;

  insert into creator_club_members (club_id, user_id, role)
  values (new_id, me, 'owner');

  perform public.audit(new_id, me, 'club.create', 'club', new_id::text, p_name);
  return new_id;
end;
$$;

create or replace function public.join_club(p_club uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
  owner uuid;
begin
  select owner_id into owner from creator_clubs where id = p_club;
  if not found then
    raise exception 'forbidden';
  end if;
  -- A club owner who blocked you (or whom you blocked) is not somewhere you go.
  if public.is_blocked(me, owner) then
    raise exception 'blocked';
  end if;

  insert into creator_club_members (club_id, user_id)
  values (p_club, me)
  on conflict (club_id, user_id) do update
    set left_at = null, joined_at = now();

  perform public.audit(p_club, me, 'club.join', 'user', me::text);
  return 'ok';
end;
$$;

create or replace function public.leave_club(p_club uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
begin
  -- An owner leaving would orphan the club; transfer or delete it instead.
  if exists (select 1 from creator_clubs where id = p_club and owner_id = me) then
    raise exception 'forbidden';
  end if;

  update creator_club_members set left_at = now()
  where club_id = p_club and user_id = me and left_at is null;

  perform public.audit(p_club, me, 'club.leave', 'user', me::text);
  return 'ok';
end;
$$;

create or replace function public.set_club_role(p_club uuid, p_user uuid, p_role text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
begin
  -- Only the owner promotes/demotes: a moderator cannot mint moderators.
  if not exists (select 1 from creator_clubs where id = p_club and owner_id = me) then
    raise exception 'forbidden';
  end if;
  if p_role not in ('moderator', 'member') then
    raise exception 'forbidden';  -- Ownership moves via transfer_club, not here.
  end if;
  if p_user = me then
    raise exception 'forbidden';  -- The owner cannot demote themselves.
  end if;
  if not public.is_club_member(p_club, p_user) then
    raise exception 'forbidden';
  end if;

  update creator_club_members set role = p_role
  where club_id = p_club and user_id = p_user;

  perform public.audit(p_club, me, 'club.role', 'user', p_user::text, p_role);
  return 'ok';
end;
$$;

create or replace function public.remove_club_member(p_club uuid, p_user uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
begin
  if not public.is_club_staff(p_club, me) then
    raise exception 'forbidden';
  end if;
  if exists (select 1 from creator_clubs where id = p_club and owner_id = p_user) then
    raise exception 'forbidden';  -- The owner cannot be removed.
  end if;

  update creator_club_members set left_at = now()
  where club_id = p_club and user_id = p_user and left_at is null;

  perform public.audit(p_club, me, 'club.remove_member', 'user', p_user::text);
  return 'ok';
end;
$$;

grant execute on function public.create_club(text, text) to authenticated;
grant execute on function public.join_club(uuid) to authenticated;
grant execute on function public.leave_club(uuid) to authenticated;
grant execute on function public.set_club_role(uuid, uuid, text) to authenticated;
grant execute on function public.remove_club_member(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Bounties: an explicit, audited status machine.
--   draft → open → judging → closed
--   draft|open|judging → cancelled
-- Anything else is rejected. Submissions are only accepted while 'open', and
-- votes only while 'judging' — which is what stops someone voting before the
-- field is complete, or submitting after seeing the competition.
-- ---------------------------------------------------------------------------

create or replace function public.create_bounty(
  p_club uuid,
  p_title text,
  p_brief text default '',
  p_closes_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
  new_id uuid;
begin
  if not public.is_club_staff(p_club, me) then
    raise exception 'forbidden';
  end if;
  if p_title is null or char_length(trim(p_title)) = 0 then
    raise exception 'forbidden';
  end if;

  insert into creator_bounties (club_id, title, brief, created_by, closes_at)
  values (p_club, left(trim(p_title), 100), left(coalesce(p_brief, ''), 1000), me, p_closes_at)
  returning id into new_id;

  perform public.audit(p_club, me, 'bounty.create', 'bounty', new_id::text, p_title);
  return new_id;
end;
$$;

create or replace function public.set_bounty_status(p_bounty uuid, p_status text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
  club uuid;
  current_status text;
  allowed boolean;
begin
  select club_id, status into club, current_status
  from creator_bounties where id = p_bounty;
  if not found then
    raise exception 'forbidden';
  end if;
  if not public.is_club_staff(club, me) then
    raise exception 'forbidden';
  end if;

  -- Idempotent: setting the status it already has is a no-op, not an error.
  if current_status = p_status then
    return 'ok';
  end if;

  allowed := case
    when current_status = 'draft'   and p_status in ('open', 'cancelled') then true
    when current_status = 'open'    and p_status in ('judging', 'cancelled') then true
    when current_status = 'judging' and p_status in ('closed', 'cancelled') then true
    else false
  end;

  if not allowed then
    raise exception 'forbidden';
  end if;

  update creator_bounties
  set status = p_status,
      opens_at = case when p_status = 'open' then now() else opens_at end,
      updated_at = now()
  where id = p_bounty;

  perform public.audit(
    club, me, 'bounty.status', 'bounty', p_bounty::text,
    format('%s → %s', current_status, p_status)
  );
  return 'ok';
end;
$$;

grant execute on function public.create_bounty(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.set_bounty_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Submissions.
-- ---------------------------------------------------------------------------

create or replace function public.submit_to_bounty(
  p_bounty uuid,
  p_video_id text,
  p_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
  club uuid;
  bounty_status text;
  new_id uuid;
begin
  select club_id, status into club, bounty_status
  from creator_bounties where id = p_bounty;
  if not found then
    raise exception 'forbidden';
  end if;
  if not public.is_club_member(club, me) then
    raise exception 'forbidden';
  end if;
  -- Entries close when judging starts: no submitting after seeing the field.
  if bounty_status <> 'open' then
    raise exception 'forbidden';
  end if;

  insert into bounty_submissions (bounty_id, submitter_id, video_id, note)
  values (p_bounty, me, p_video_id, left(coalesce(p_note, ''), 500))
  on conflict (bounty_id, submitter_id) do update
    set video_id = excluded.video_id,
        note = excluded.note,
        status = 'submitted',
        updated_at = now()
  returning id into new_id;

  perform public.audit(club, me, 'submission.create', 'submission', new_id::text, p_video_id);
  return new_id;
end;
$$;

create or replace function public.set_submission_status(p_submission uuid, p_status text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
  club uuid;
  submitter uuid;
begin
  select b.club_id, s.submitter_id into club, submitter
  from bounty_submissions s
  join creator_bounties b on b.id = s.bounty_id
  where s.id = p_submission;
  if not found then
    raise exception 'forbidden';
  end if;

  if p_status = 'withdrawn' then
    -- Only the submitter withdraws their own entry.
    if submitter <> me then
      raise exception 'forbidden';
    end if;
  elsif p_status in ('accepted', 'rejected') then
    -- Only staff judge.
    if not public.is_club_staff(club, me) then
      raise exception 'forbidden';
    end if;
  else
    raise exception 'forbidden';
  end if;

  update bounty_submissions
  set status = p_status, updated_at = now()
  where id = p_submission;

  perform public.audit(club, me, 'submission.status', 'submission', p_submission::text, p_status);
  return 'ok';
end;
$$;

grant execute on function public.submit_to_bounty(uuid, text, text) to authenticated;
grant execute on function public.set_submission_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Voting. One vote per voter per bounty (the table's primary key enforces it —
-- an RPC-level check would lose a concurrent double-vote race). Re-voting moves
-- your vote rather than adding one.
-- ---------------------------------------------------------------------------

create or replace function public.cast_vote(p_submission uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
  club uuid;
  bounty uuid;
  bounty_status text;
  submitter uuid;
  submission_status text;
begin
  select b.id, b.club_id, b.status, s.submitter_id, s.status
    into bounty, club, bounty_status, submitter, submission_status
  from bounty_submissions s
  join creator_bounties b on b.id = s.bounty_id
  where s.id = p_submission;
  if not found then
    raise exception 'forbidden';
  end if;

  if not public.is_club_member(club, me) then
    raise exception 'forbidden';
  end if;
  -- Votes only count once the field is closed and judging has begun.
  if bounty_status <> 'judging' then
    raise exception 'forbidden';
  end if;
  if submission_status = 'withdrawn' or submission_status = 'rejected' then
    raise exception 'forbidden';
  end if;
  -- No voting for yourself.
  if submitter = me then
    raise exception 'forbidden';
  end if;
  -- You cannot boost, or be boosted by, someone a block stands between.
  if public.is_blocked(me, submitter) then
    raise exception 'blocked';
  end if;

  insert into bounty_votes (bounty_id, voter_id, submission_id)
  values (bounty, me, p_submission)
  on conflict (bounty_id, voter_id) do update
    set submission_id = excluded.submission_id, created_at = now();

  perform public.audit(club, me, 'vote.cast', 'submission', p_submission::text);
  return 'ok';
end;
$$;

create or replace function public.retract_vote(p_bounty uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
begin
  delete from bounty_votes where bounty_id = p_bounty and voter_id = me;
  return 'ok';  -- Idempotent.
end;
$$;

-- Tallies, never individual ballots: who voted for whom is not exposed, only
-- the count. Members see the standings; nobody sees another member's choice.
create or replace function public.get_bounty_results(p_bounty uuid)
returns table (
  submission_id uuid,
  submitter_id uuid,
  display_name text,
  video_id text,
  note text,
  status text,
  votes bigint,
  is_mine boolean,
  voted_by_me boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
#variable_conflict use_column
declare
  me uuid := public.require_auth();
  club uuid;
begin
  select b.club_id into club from creator_bounties b where b.id = p_bounty;
  if not found or not public.is_club_member(club, me) then
    raise exception 'forbidden';
  end if;

  return query
  select
    s.id,
    s.submitter_id,
    coalesce(nullif(ps.display_name, ''), 'Someone'),
    s.video_id,
    s.note,
    s.status,
    (select count(*) from bounty_votes v where v.submission_id = s.id),
    (s.submitter_id = me),
    exists (
      select 1 from bounty_votes v
      where v.submission_id = s.id and v.voter_id = me
    )
  from bounty_submissions s
  left join player_stats ps on ps.user_id = s.submitter_id
  where s.bounty_id = p_bounty
    and s.status <> 'withdrawn'
    and not public.is_blocked(me, s.submitter_id)
  order by (select count(*) from bounty_votes v where v.submission_id = s.id) desc,
           s.created_at asc;
end;
$$;

grant execute on function public.cast_vote(uuid) to authenticated;
grant execute on function public.retract_vote(uuid) to authenticated;
grant execute on function public.get_bounty_results(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Listing.
-- ---------------------------------------------------------------------------

create or replace function public.list_my_clubs()
returns table (id uuid, name text, description text, owner_id uuid, role text, member_count bigint)
language plpgsql
security definer
set search_path = public
stable
as $$
#variable_conflict use_column
declare
  me uuid := public.require_auth();
begin
  return query
  select
    c.id,
    c.name,
    c.description,
    c.owner_id,
    m.role,
    (select count(*) from creator_club_members cm
      where cm.club_id = c.id and cm.left_at is null)
  from creator_clubs c
  join creator_club_members m
    on m.club_id = c.id and m.user_id = me and m.left_at is null
  order by c.created_at asc
  limit 50;
end;
$$;

create or replace function public.list_bounties(p_club uuid)
returns table (
  id uuid,
  title text,
  brief text,
  status text,
  closes_at timestamptz,
  submission_count bigint
)
language plpgsql
security definer
set search_path = public
stable
as $$
#variable_conflict use_column
declare
  me uuid := public.require_auth();
begin
  if not public.is_club_member(p_club, me) then
    raise exception 'forbidden';
  end if;

  return query
  select
    b.id,
    b.title,
    b.brief,
    b.status,
    b.closes_at,
    (select count(*) from bounty_submissions s
      where s.bounty_id = b.id and s.status <> 'withdrawn')
  from creator_bounties b
  where b.club_id = p_club
    -- A draft is not visible to ordinary members.
    and (b.status <> 'draft' or public.is_club_staff(p_club, me))
  order by b.created_at desc
  limit 50;
end;
$$;

grant execute on function public.list_my_clubs() to authenticated;
grant execute on function public.list_bounties(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Moderation. Reports are a queue for humans; nothing here auto-actions.
-- ---------------------------------------------------------------------------

create or replace function public.report_content(
  p_target_kind text,
  p_target_id text,
  p_reason text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
begin
  if p_target_kind not in ('club', 'bounty', 'submission', 'user') then
    raise exception 'forbidden';
  end if;
  if p_reason is null or char_length(trim(p_reason)) = 0 then
    raise exception 'forbidden';
  end if;
  if not public.under_limit_reports(me) then
    raise exception 'rate-limited';
  end if;

  insert into creator_reports (target_kind, target_id, reporter_id, reason)
  values (p_target_kind, p_target_id, me, left(trim(p_reason), 500))
  on conflict (target_kind, target_id, reporter_id) do nothing;  -- Idempotent.

  return 'ok';
end;
$$;

create or replace function public.list_club_reports(p_club uuid)
returns table (
  id uuid,
  target_kind text,
  target_id text,
  reason text,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
#variable_conflict use_column
declare
  me uuid := public.require_auth();
begin
  if not public.is_club_staff(p_club, me) then
    raise exception 'forbidden';
  end if;

  return query
  select r.id, r.target_kind, r.target_id, r.reason, r.status, r.created_at
  from creator_reports r
  where r.status = 'open'
    and (
      (r.target_kind = 'club' and r.target_id = p_club::text)
      or (r.target_kind = 'bounty' and r.target_id in (
        select b.id::text from creator_bounties b where b.club_id = p_club))
      or (r.target_kind = 'submission' and r.target_id in (
        select s.id::text from bounty_submissions s
        join creator_bounties b on b.id = s.bounty_id
        where b.club_id = p_club))
    )
  order by r.created_at asc
  limit 100;
end;
$$;

create or replace function public.resolve_report(
  p_report uuid,
  p_status text,
  p_club uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
begin
  if p_status not in ('actioned', 'dismissed') then
    raise exception 'forbidden';
  end if;
  if not public.is_club_staff(p_club, me) then
    raise exception 'forbidden';
  end if;

  update creator_reports
  set status = p_status, resolved_by = me, resolved_at = now()
  where id = p_report and status = 'open';

  if not found then
    raise exception 'forbidden';
  end if;

  perform public.audit(p_club, me, 'report.resolve', 'report', p_report::text, p_status);
  return 'ok';
end;
$$;

create or replace function public.get_club_audit(p_club uuid, p_limit integer default 100)
returns table (
  actor_id uuid,
  display_name text,
  action text,
  target_kind text,
  target_id text,
  detail text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
#variable_conflict use_column
declare
  me uuid := public.require_auth();
begin
  if not public.is_club_staff(p_club, me) then
    raise exception 'forbidden';
  end if;

  return query
  select
    a.actor_id,
    coalesce(nullif(ps.display_name, ''), 'Someone'),
    a.action,
    a.target_kind,
    a.target_id,
    a.detail,
    a.created_at
  from creator_audit_log a
  left join player_stats ps on ps.user_id = a.actor_id
  where a.club_id = p_club
  order by a.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
end;
$$;

grant execute on function public.report_content(text, text, text) to authenticated;
grant execute on function public.list_club_reports(uuid) to authenticated;
grant execute on function public.resolve_report(uuid, text, uuid) to authenticated;
grant execute on function public.get_club_audit(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Notifications.
-- ---------------------------------------------------------------------------

create or replace function public.list_notifications(p_limit integer default 50)
returns table (
  id uuid,
  kind text,
  payload jsonb,
  read_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
#variable_conflict use_column
declare
  me uuid := public.require_auth();
begin
  return query
  select n.id, n.kind, n.payload, n.read_at, n.created_at
  from notifications n
  where n.user_id = me
  order by n.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

create or replace function public.mark_notification_read(p_notification uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
begin
  update notifications set read_at = now()
  where id = p_notification and user_id = me and read_at is null;
  return 'ok';  -- Idempotent.
end;
$$;

grant execute on function public.list_notifications(integer) to authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- ROLLBACK (run before 0011's rollback)
-- ---------------------------------------------------------------------------
--   drop function if exists public.mark_notification_read(uuid);
--   drop function if exists public.list_notifications(integer);
--   drop function if exists public.get_club_audit(uuid, integer);
--   drop function if exists public.resolve_report(uuid, text, uuid);
--   drop function if exists public.list_club_reports(uuid);
--   drop function if exists public.report_content(text, text, text);
--   drop function if exists public.list_bounties(uuid);
--   drop function if exists public.list_my_clubs();
--   drop function if exists public.get_bounty_results(uuid);
--   drop function if exists public.retract_vote(uuid);
--   drop function if exists public.cast_vote(uuid);
--   drop function if exists public.set_submission_status(uuid, text);
--   drop function if exists public.submit_to_bounty(uuid, text, text);
--   drop function if exists public.set_bounty_status(uuid, text);
--   drop function if exists public.create_bounty(uuid, text, text, timestamptz);
--   drop function if exists public.remove_club_member(uuid, uuid);
--   drop function if exists public.set_club_role(uuid, uuid, text);
--   drop function if exists public.leave_club(uuid);
--   drop function if exists public.join_club(uuid);
--   drop function if exists public.create_club(text, text);
--   drop function if exists public.audit(uuid, uuid, text, text, text, text);
