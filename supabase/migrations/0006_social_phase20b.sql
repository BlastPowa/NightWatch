-- Phase 20B: friends, presence consent, blocks, messaging, moment notes,
-- profile borders. Apply via Supabase Dashboard → SQL Editor → paste & run.
--
-- Rollback notes are at the bottom of this file.
--
-- DESIGN NOTE. Every RPC below is `security definer`, which means it bypasses
-- RLS by construction — each function is therefore only as safe as its own
-- internal checks. Blocking is the permission that overrides all others, so it
-- is centralised in is_blocked() and called from every read and every
-- transition rather than reimplemented per function. Forgetting it in one
-- place would silently defeat blocking everywhere.

-- LOCK ORDER. Everything that touches the EXISTING player_stats table is
-- deferred to the end of this file. ALTER TABLE takes an AccessExclusiveLock
-- for the remainder of the transaction, so taking it up front means holding it
-- while we create a dozen unrelated objects — long enough for PostgREST, the
-- dashboard, or a running client to deadlock against us. Creating the new
-- objects first keeps that lock window as short as possible.
--
-- lock_timeout makes a busy table fail fast and cleanly instead of deadlocking.
set lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- Friends, blocks, presence consent.
-- ---------------------------------------------------------------------------

create table public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint friend_requests_not_self check (sender_id <> recipient_id)
);

-- "One live request per pair" — partial, so resolved requests accumulate as
-- history without blocking a future request. Unordered pair: a pending request
-- in either direction blocks a new one in either direction.
create unique index friend_requests_one_live
  on public.friend_requests (
    least(sender_id, recipient_id),
    greatest(sender_id, recipient_id)
  )
  where status = 'pending';

create index friend_requests_inbox on public.friend_requests (recipient_id, status);
create index friend_requests_outbox on public.friend_requests (sender_id, status);

-- Canonically ordered pair: the check constraint makes a mirrored duplicate
-- impossible, and the PK makes a concurrent double-accept a no-op rather than
-- two rows.
create table public.friendships (
  user_low uuid not null references auth.users (id) on delete cascade,
  user_high uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_low, user_high),
  constraint friendships_ordered check (user_low < user_high)
);

create index friendships_high on public.friendships (user_high);

create table public.user_blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_not_self check (blocker_id <> blocked_id)
);

create index user_blocks_blocked on public.user_blocks (blocked_id);

create table public.presence_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  share_online boolean not null default false,
  share_activity boolean not null default false,
  -- Activity never carries a room code (see get_friend_presence).
  status text not null default 'offline'
    check (status in ('offline', 'online', 'watching', 'in_party')),
  video_title text check (video_title is null or char_length(video_title) <= 120),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Messaging.
-- ---------------------------------------------------------------------------

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct', 'group')),
  title text check (title is null or char_length(title) between 1 and 60),
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index conversations_owner on public.conversations (owner_id);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'moderator', 'member')),
  joined_at timestamptz not null default now(),
  last_read_message_id uuid,
  left_at timestamptz,
  primary key (conversation_id, user_id)
);

create index conversation_members_user on public.conversation_members (user_id)
  where left_at is null;

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  kind text not null default 'message' check (kind in ('message', 'system')),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

-- Message cursor: newest-first paging within a conversation.
create index messages_cursor on public.messages (conversation_id, created_at desc, id desc);

-- ---------------------------------------------------------------------------
-- Video moment notes.
-- ---------------------------------------------------------------------------

create table public.video_moment_notes (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users (id) on delete cascade,
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  position_seconds integer not null check (position_seconds >= 0),
  visibility text not null check (visibility in ('private', 'friends', 'room')),
  room_code text references public.rooms (code) on delete cascade,
  body text not null default '' check (char_length(body) <= 500),
  -- Allowlist matches shared/reactions.ts REACTION_EMOJIS.
  emoji text check (emoji is null or emoji in ('😂', '❤️', '🔥', '😮', '👏', '💀')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- Room visibility is meaningless without the room it refers to.
  constraint moment_room_requires_code
    check (visibility <> 'room' or room_code is not null),
  -- A note with neither text nor emoji carries no information.
  constraint moment_has_content
    check (char_length(body) > 0 or emoji is not null)
);

create index moment_notes_video on public.video_moment_notes (video_id, position_seconds)
  where deleted_at is null;
create index moment_notes_author on public.video_moment_notes (author_id)
  where deleted_at is null;
create index moment_notes_room on public.video_moment_notes (room_code)
  where deleted_at is null and visibility = 'room';

-- ---------------------------------------------------------------------------
-- Profile borders.
-- ---------------------------------------------------------------------------

create table public.profile_borders (
  id text primary key check (char_length(id) <= 40),
  label text not null,
  -- Achievement that grants it, or null for borders everyone has.
  required_achievement_id text
);

create table public.player_border_unlocks (
  user_id uuid not null references auth.users (id) on delete cascade,
  border_id text not null references public.profile_borders (id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, border_id)
);

insert into public.profile_borders (id, label, required_achievement_id) values
  ('default', 'Default', null),
  ('streak-3', 'Warming Up', 'streak-3'),
  ('streak-7', 'Weekly Ritual', 'streak-7'),
  ('streak-30', 'Night Sovereign', 'streak-30'),
  ('first-room', 'First Night', 'first-room');

-- ---------------------------------------------------------------------------
-- Shared predicates. Every RPC calls these rather than inlining the logic.
-- ---------------------------------------------------------------------------

-- Blocking is symmetric for permission purposes: a block in EITHER direction
-- severs discovery, presence, invites, messages, and friends-only notes.
create or replace function public.is_blocked(a uuid, b uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from user_blocks
    where (blocker_id = a and blocked_id = b)
       or (blocker_id = b and blocked_id = a)
  );
$$;

create or replace function public.are_friends(a uuid, b uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from friendships
    where user_low = least(a, b) and user_high = greatest(a, b)
  );
$$;

create or replace function public.is_active_member(p_conversation uuid, p_user uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from conversation_members
    where conversation_id = p_conversation
      and user_id = p_user
      and left_at is null
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS. Direct table access is minimal: reads go through the RPCs below, which
-- apply the block filter. These policies are the backstop, not the interface.
-- ---------------------------------------------------------------------------

alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.user_blocks enable row level security;
alter table public.presence_preferences enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.video_moment_notes enable row level security;
alter table public.profile_borders enable row level security;
alter table public.player_border_unlocks enable row level security;

-- You may read only rows involving you.
create policy requests_involving_me on public.friend_requests
  for select using (auth.uid() in (sender_id, recipient_id));

create policy friendships_involving_me on public.friendships
  for select using (auth.uid() in (user_low, user_high));

create policy blocks_own on public.user_blocks
  for select using (auth.uid() = blocker_id);

-- Presence rows: your own row is yours to manage. Reading OTHERS' presence is
-- deliberately not granted here — it goes through get_friend_presence, which
-- applies the consent flags and the block filter.
create policy presence_own_select on public.presence_preferences
  for select using (auth.uid() = user_id);
create policy presence_own_insert on public.presence_preferences
  for insert with check (auth.uid() = user_id);
create policy presence_own_update on public.presence_preferences
  for update using (auth.uid() = user_id);

-- Conversations and messages are readable only by ACTIVE members.
create policy conversations_member_select on public.conversations
  for select using (public.is_active_member(id, auth.uid()));

create policy members_member_select on public.conversation_members
  for select using (public.is_active_member(conversation_id, auth.uid()));

create policy messages_member_select on public.messages
  for select using (public.is_active_member(conversation_id, auth.uid()));

-- Borders: the catalog is public; unlocks are your own.
create policy borders_public_select on public.profile_borders
  for select using (true);
create policy border_unlocks_own on public.player_border_unlocks
  for select using (auth.uid() = user_id);
create policy border_unlocks_own_insert on public.player_border_unlocks
  for insert with check (auth.uid() = user_id);

-- Moment notes: private = author only. Friends/room visibility is resolved by
-- list_moment_notes (which applies blocks); this policy covers direct access.
create policy moments_author_all on public.video_moment_notes
  for select using (auth.uid() = author_id);
create policy moments_author_insert on public.video_moment_notes
  for insert with check (auth.uid() = author_id);
create policy moments_author_update on public.video_moment_notes
  for update using (auth.uid() = author_id);

-- ---------------------------------------------------------------------------
-- Rate limits, enforced in the database (a per-instance counter cannot work
-- here). Each returns true when the caller is still under the limit.
-- ---------------------------------------------------------------------------

create or replace function public.under_limit_friend_requests(p_user uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select count(*) < 20
  from friend_requests
  where sender_id = p_user and created_at > now() - interval '1 day';
$$;

create or replace function public.under_limit_messages(p_user uuid, p_conversation uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select count(*) < 30
  from messages
  where sender_id = p_user
    and conversation_id = p_conversation
    and created_at > now() - interval '1 minute';
$$;

create or replace function public.under_limit_groups(p_user uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select count(*) < 5
  from conversations
  where owner_id = p_user and kind = 'group' and created_at > now() - interval '1 day';
$$;

create or replace function public.under_limit_moments(p_user uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select count(*) < 20
  from video_moment_notes
  where author_id = p_user and created_at > now() - interval '1 minute';
$$;

-- ---------------------------------------------------------------------------
-- player_stats changes — LAST, so the AccessExclusiveLock on this live,
-- actively-read table is held for as little of the transaction as possible.
-- ---------------------------------------------------------------------------

-- Both column changes in one statement = one table rewrite, one lock.
alter table public.player_stats
  add column selected_border_id text references public.profile_borders (id),
  alter column share_stats set default false;

-- Consent alignment. Phase 18 shipped share_stats defaulting TRUE; the handoff
-- mandates presence consent defaults FALSE. Two opt-in surfaces with opposite
-- defaults is how privacy incidents happen, so existing rows are reset too:
-- all sharing in NightWatch is now explicitly opted into. Leaderboard and
-- co-watcher visibility goes dark until users re-consent — intended, and the
-- one step of this migration that cannot be undone.
update public.player_stats set share_stats = false where share_stats = true;

-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- Run 0007's rollback first (it drops the RPCs that depend on these tables).
--
--   drop function if exists public.under_limit_moments(uuid);
--   drop function if exists public.under_limit_groups(uuid);
--   drop function if exists public.under_limit_messages(uuid, uuid);
--   drop function if exists public.under_limit_friend_requests(uuid);
--   drop function if exists public.is_active_member(uuid, uuid);
--   drop function if exists public.are_friends(uuid, uuid);
--   drop function if exists public.is_blocked(uuid, uuid);
--   alter table public.player_stats drop column if exists selected_border_id;
--   drop table if exists public.player_border_unlocks;
--   drop table if exists public.profile_borders;
--   drop table if exists public.video_moment_notes;
--   drop table if exists public.messages;
--   drop table if exists public.conversation_members;
--   drop table if exists public.conversations;
--   drop table if exists public.presence_preferences;
--   drop table if exists public.user_blocks;
--   drop table if exists public.friendships;
--   drop table if exists public.friend_requests;
--   alter table public.player_stats alter column share_stats set default true;
--
-- NOTE: the share_stats backfill (true → false) is NOT reversible — the prior
-- per-user values are not retained. Restoring the default does not restore
-- anyone's opt-in; users must re-consent. This is intentional.
