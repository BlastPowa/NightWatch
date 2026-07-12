-- Phase 20D: notification emitters.
-- Apply AFTER 0012_creator_rpcs.sql. Rollback notes at the bottom.
--
-- 0011 shipped the notifications table, its RLS, and the read/mark-read RPCs,
-- but nothing ever WROTE a row: clubs were silent. This adds the writers.
--
-- They are AFTER triggers on the tables, not edits to the 20C RPCs. Two reasons:
-- the RPC bodies are already tested and duplicating them to sprinkle in a
-- `perform notify(...)` leaves two copies to drift, and a trigger on the column
-- fires however the row changed — so a future RPC, a backfill, or an admin
-- console cannot silently skip the notification.
--
-- Every trigger function is SECURITY DEFINER on purpose. `notifications` has a
-- SELECT and an UPDATE policy and deliberately NO INSERT policy, so a client
-- cannot forge a notification to itself or anyone else. A trigger runs as the
-- invoking user unless it is definer, which would mean these inserts hit that
-- same wall. Definer is what lets the server — and only the server — write.

-- ---------------------------------------------------------------------------
-- The primitive.
-- ---------------------------------------------------------------------------

-- One recipient. Silently drops the notification when there is nobody to tell,
-- when you would be telling someone about their own action, or when a block
-- stands between the two — a notification is contact, and a block means no
-- contact. Returning void rather than raising keeps a delivery failure from
-- rolling back the state change that caused it: the vote still counts even if
-- the ping does not land.
create or replace function public.emit_notification(
  p_user uuid,
  p_actor uuid,
  p_kind text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user is null or p_kind is null then
    return;
  end if;
  -- Nobody needs to be told what they just did themselves.
  if p_actor is not null and p_user = p_actor then
    return;
  end if;
  if p_actor is not null and public.is_blocked(p_user, p_actor) then
    return;
  end if;

  insert into notifications (user_id, kind, payload)
  values (p_user, left(p_kind, 40), coalesce(p_payload, '{}'::jsonb));
end;
$$;

-- Fan-out to every active member of a club. Block-aware per recipient, so one
-- blocked member does not suppress the notification for everyone else.
create or replace function public.emit_club_notification(
  p_club uuid,
  p_actor uuid,
  p_kind text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notifications (user_id, kind, payload)
  select m.user_id, left(p_kind, 40), coalesce(p_payload, '{}'::jsonb)
  from creator_club_members m
  where m.club_id = p_club
    and m.left_at is null
    and (p_actor is null or m.user_id <> p_actor)
    and (p_actor is null or not public.is_blocked(m.user_id, p_actor));
end;
$$;

-- ---------------------------------------------------------------------------
-- Bounty lifecycle.
-- ---------------------------------------------------------------------------

-- auth.uid() still reads the request's JWT claim inside a definer function, so
-- the actor is the real caller, not the table owner. It is null for a change
-- made from the SQL editor, which emit_notification() treats as "no actor".
create or replace function public.on_bounty_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  body jsonb;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  body := jsonb_build_object(
    'clubId', new.club_id,
    'bountyId', new.id,
    'title', new.title,
    'status', new.status
  );

  if new.status = 'open' then
    -- The whole club hears that a challenge is live. This is the only
    -- club-wide fan-out; the rest go to people with an entry at stake.
    perform public.emit_club_notification(new.club_id, actor, 'bounty.open', body);
  elsif new.status in ('judging', 'closed', 'cancelled') then
    insert into notifications (user_id, kind, payload)
    select s.submitter_id, 'bounty.' || new.status, body
    from bounty_submissions s
    where s.bounty_id = new.id
      and s.status <> 'withdrawn'
      and (actor is null or s.submitter_id <> actor)
      and (actor is null or not public.is_blocked(s.submitter_id, actor));
  end if;

  return new;
end;
$$;

drop trigger if exists bounty_status_notify on public.creator_bounties;
create trigger bounty_status_notify
  after update of status on public.creator_bounties
  for each row
  execute function public.on_bounty_status_change();

-- ---------------------------------------------------------------------------
-- Submission verdicts. The one people actually care about.
-- ---------------------------------------------------------------------------

create or replace function public.on_submission_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  club uuid;
  bounty_title text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  -- A withdrawal is the submitter's own doing; nobody is waiting to hear it.
  if new.status not in ('accepted', 'rejected') then
    return new;
  end if;

  select b.club_id, b.title into club, bounty_title
  from creator_bounties b where b.id = new.bounty_id;

  perform public.emit_notification(
    new.submitter_id,
    actor,
    'submission.' || new.status,
    jsonb_build_object(
      'clubId', club,
      'bountyId', new.bounty_id,
      'title', bounty_title,
      'submissionId', new.id,
      'status', new.status
    )
  );

  return new;
end;
$$;

drop trigger if exists submission_status_notify on public.bounty_submissions;
create trigger submission_status_notify
  after update of status on public.bounty_submissions
  for each row
  execute function public.on_submission_status_change();

-- ---------------------------------------------------------------------------
-- Club role changes.
-- ---------------------------------------------------------------------------

create or replace function public.on_club_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  club_name text;
begin
  if new.role is not distinct from old.role then
    return new;
  end if;

  select c.name into club_name from creator_clubs c where c.id = new.club_id;

  perform public.emit_notification(
    new.user_id,
    actor,
    'club.role',
    jsonb_build_object('clubId', new.club_id, 'name', club_name, 'role', new.role)
  );

  return new;
end;
$$;

drop trigger if exists club_role_notify on public.creator_club_members;
create trigger club_role_notify
  after update of role on public.creator_club_members
  for each row
  execute function public.on_club_role_change();

-- ---------------------------------------------------------------------------
-- Report resolution. Closing the loop for the person who bothered to report.
-- ---------------------------------------------------------------------------

create or replace function public.on_report_resolved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if new.status is not distinct from old.status or new.status = 'open' then
    return new;
  end if;

  -- Deliberately does NOT say who resolved it or how the target was actioned:
  -- a reporter learns their report was handled, not who handled it. Naming the
  -- moderator to the reporter is how moderators get harassed.
  perform public.emit_notification(
    new.reporter_id,
    null,
    'report.resolved',
    jsonb_build_object(
      'targetKind', new.target_kind,
      'targetId', new.target_id,
      'status', new.status
    )
  );

  return new;
end;
$$;

drop trigger if exists report_resolved_notify on public.creator_reports;
create trigger report_resolved_notify
  after update of status on public.creator_reports
  for each row
  execute function public.on_report_resolved();

-- ---------------------------------------------------------------------------
-- Read helpers the bell needs.
-- ---------------------------------------------------------------------------

create or replace function public.count_unread_notifications()
returns integer
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  me uuid := public.require_auth();
  total integer;
begin
  select count(*) into total
  from notifications
  where user_id = me and read_at is null;
  return coalesce(total, 0);
end;
$$;

create or replace function public.mark_all_notifications_read()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
begin
  update notifications set read_at = now()
  where user_id = me and read_at is null;
  return 'ok';  -- Idempotent.
end;
$$;

grant execute on function public.count_unread_notifications() to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime. Without this the bell only updates on a poll or a refresh — the
-- table has to be in the publication for Realtime to replay it at all, and
-- replica identity full is what lets RLS authorise the UPDATE (mark-read)
-- events rather than dropping them.
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.notifications;
alter table public.notifications replica identity full;

-- ---------------------------------------------------------------------------
-- ROLLBACK (run before 0012's rollback)
-- ---------------------------------------------------------------------------
--   alter publication supabase_realtime drop table public.notifications;
--   drop trigger if exists report_resolved_notify on public.creator_reports;
--   drop trigger if exists club_role_notify on public.creator_club_members;
--   drop trigger if exists submission_status_notify on public.bounty_submissions;
--   drop trigger if exists bounty_status_notify on public.creator_bounties;
--   drop function if exists public.on_report_resolved();
--   drop function if exists public.on_club_role_change();
--   drop function if exists public.on_submission_status_change();
--   drop function if exists public.on_bounty_status_change();
--   drop function if exists public.mark_all_notifications_read();
--   drop function if exists public.count_unread_notifications();
--   drop function if exists public.emit_club_notification(uuid, uuid, text, jsonb);
--   drop function if exists public.emit_notification(uuid, uuid, text, jsonb);
