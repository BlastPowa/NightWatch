-- Phase 20C: creator clubs, bounties, submissions, votes, moderation.
-- Apply AFTER 0010_social_realtime.sql. Rollback notes at the bottom.
--
-- SCOPE BOUNDARY (from the handoff). No payments, cash rewards, YouTube account
-- scopes, downloads, subscriptions, or channel administration. A "bounty" here
-- is a social challenge whose prize is recognition. That boundary is structural,
-- not just policy: there is deliberately no amount, currency, or payout column
-- anywhere below, so a payment feature cannot be bolted on without a migration
-- that makes the change obvious in review.
--
-- Blocking (20B) is honoured throughout: a blocked user cannot submit to, vote
-- on, or be notified about someone who blocked them.

set lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- Clubs.
-- ---------------------------------------------------------------------------

create table public.creator_clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  description text not null default '' check (char_length(description) <= 500),
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index creator_clubs_owner on public.creator_clubs (owner_id);

create table public.creator_club_members (
  club_id uuid not null references public.creator_clubs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'moderator', 'member')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (club_id, user_id)
);

create index creator_club_members_user on public.creator_club_members (user_id)
  where left_at is null;

-- ---------------------------------------------------------------------------
-- Bounties. Status transitions are explicit and audited — never a raw UPDATE
-- from a client (there is no update policy on this table at all).
-- ---------------------------------------------------------------------------

create table public.creator_bounties (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.creator_clubs (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  brief text not null default '' check (char_length(brief) <= 1000),
  status text not null default 'draft'
    check (status in ('draft', 'open', 'judging', 'closed', 'cancelled')),
  created_by uuid not null references auth.users (id) on delete cascade,
  opens_at timestamptz,
  closes_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index creator_bounties_club on public.creator_bounties (club_id, status);

create table public.bounty_submissions (
  id uuid primary key default gen_random_uuid(),
  bounty_id uuid not null references public.creator_bounties (id) on delete cascade,
  submitter_id uuid not null references auth.users (id) on delete cascade,
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  note text not null default '' check (char_length(note) <= 500),
  status text not null default 'submitted'
    check (status in ('submitted', 'accepted', 'rejected', 'withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One entry per person per bounty: without this, a submitter could flood a
  -- bounty and split the vote.
  unique (bounty_id, submitter_id)
);

create index bounty_submissions_bounty on public.bounty_submissions (bounty_id, status);

-- ---------------------------------------------------------------------------
-- Votes. This is the first thing in NightWatch with a competitive outcome, so
-- it is the first thing anyone has an incentive to game.
--
-- Uniqueness is a DATABASE CONSTRAINT, not an RPC check: two concurrent vote
-- requests both pass a read-then-write check and both insert. The primary key
-- is what actually makes double-voting impossible.
--
-- Rule (decided): ONE VOTE PER BOUNTY — you pick a single winner.
-- ---------------------------------------------------------------------------

create table public.bounty_votes (
  bounty_id uuid not null references public.creator_bounties (id) on delete cascade,
  voter_id uuid not null references auth.users (id) on delete cascade,
  submission_id uuid not null references public.bounty_submissions (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- One vote per voter per bounty. Changing your vote updates this row.
  primary key (bounty_id, voter_id)
);

create index bounty_votes_submission on public.bounty_votes (submission_id);

-- ---------------------------------------------------------------------------
-- Moderation. The audit log is append-only: it has a SELECT policy and nothing
-- else, so not even a club owner can rewrite the record of what they did.
-- ---------------------------------------------------------------------------

create table public.creator_reports (
  id uuid primary key default gen_random_uuid(),
  target_kind text not null check (target_kind in ('club', 'bounty', 'submission', 'user')),
  target_id text not null,
  reporter_id uuid not null references auth.users (id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 500),
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  -- One open report per person per target: re-reporting is not a vote.
  unique (target_kind, target_id, reporter_id)
);

create index creator_reports_open on public.creator_reports (status, created_at);

create table public.creator_audit_log (
  id bigint generated always as identity primary key,
  club_id uuid references public.creator_clubs (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (char_length(action) <= 60),
  target_kind text not null check (char_length(target_kind) <= 20),
  target_id text not null,
  detail text not null default '' check (char_length(detail) <= 500),
  created_at timestamptz not null default now()
);

create index creator_audit_club on public.creator_audit_log (club_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Notifications.
-- ---------------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (char_length(kind) <= 40),
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_unread on public.notifications (user_id, created_at desc)
  where read_at is null;

-- ---------------------------------------------------------------------------
-- Shared predicates.
-- ---------------------------------------------------------------------------

create or replace function public.is_club_member(p_club uuid, p_user uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from creator_club_members
    where club_id = p_club and user_id = p_user and left_at is null
  );
$$;

create or replace function public.is_club_staff(p_club uuid, p_user uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from creator_club_members
    where club_id = p_club
      and user_id = p_user
      and left_at is null
      and role in ('owner', 'moderator')
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS. Reads go through the RPCs in 0012; these policies are the backstop.
-- Note the absence of UPDATE/DELETE policies on bounties, submissions, votes,
-- and the audit log: every mutation must go through an audited RPC.
-- ---------------------------------------------------------------------------

alter table public.creator_clubs enable row level security;
alter table public.creator_club_members enable row level security;
alter table public.creator_bounties enable row level security;
alter table public.bounty_submissions enable row level security;
alter table public.bounty_votes enable row level security;
alter table public.creator_reports enable row level security;
alter table public.creator_audit_log enable row level security;
alter table public.notifications enable row level security;

-- Members see their club; everyone else sees nothing.
create policy clubs_member_select on public.creator_clubs
  for select using (public.is_club_member(id, auth.uid()));

create policy club_members_member_select on public.creator_club_members
  for select using (public.is_club_member(club_id, auth.uid()));

create policy bounties_member_select on public.creator_bounties
  for select using (public.is_club_member(club_id, auth.uid()));

create policy submissions_member_select on public.bounty_submissions
  for select using (
    exists (
      select 1 from creator_bounties b
      where b.id = bounty_submissions.bounty_id
        and public.is_club_member(b.club_id, auth.uid())
    )
  );

-- You can see your own vote. Tallies come from the RPC, so an individual's
-- choice is not readable by others.
create policy votes_own_select on public.bounty_votes
  for select using (auth.uid() = voter_id);

-- A reporter sees their own report; staff see reports for their club's targets
-- via the moderation RPC (security definer), not through this policy.
create policy reports_own_select on public.creator_reports
  for select using (auth.uid() = reporter_id);

-- Append-only: SELECT for club staff, and no insert/update/delete policy at
-- all. Only the security-definer RPCs write here.
create policy audit_staff_select on public.creator_audit_log
  for select using (public.is_club_staff(club_id, auth.uid()));

create policy notifications_own_select on public.notifications
  for select using (auth.uid() = user_id);
create policy notifications_own_update on public.notifications
  for update using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Rate limits.
-- ---------------------------------------------------------------------------

create or replace function public.under_limit_clubs(p_user uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select count(*) < 5
  from creator_clubs
  where owner_id = p_user and created_at > now() - interval '1 day';
$$;

create or replace function public.under_limit_reports(p_user uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select count(*) < 20
  from creator_reports
  where reporter_id = p_user and created_at > now() - interval '1 day';
$$;

-- ---------------------------------------------------------------------------
-- ROLLBACK (run 0012's rollback first)
-- ---------------------------------------------------------------------------
--   drop function if exists public.under_limit_reports(uuid);
--   drop function if exists public.under_limit_clubs(uuid);
--   drop function if exists public.is_club_staff(uuid, uuid);
--   drop function if exists public.is_club_member(uuid, uuid);
--   drop table if exists public.notifications;
--   drop table if exists public.creator_audit_log;
--   drop table if exists public.creator_reports;
--   drop table if exists public.bounty_votes;
--   drop table if exists public.bounty_submissions;
--   drop table if exists public.creator_bounties;
--   drop table if exists public.creator_club_members;
--   drop table if exists public.creator_clubs;
