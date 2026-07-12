-- Phase 23: privacy-safe social profiles.
-- Apply AFTER 0019_list_my_clubs_visibility.sql. Rollback notes at the bottom.
--
-- Implements the four contracts in PHASE_23_SOCIAL_UI_BACKEND_HANDOFF.md:
--   1. get_social_profile        -- privacy-safe profile, block-aware
--   2. list_blocked_users        -- real unblock management, no client shadow list
--   3. get_conversation_members  -- membership-authorised member profiles
--   4. friend -> persistent-room invitations, with expiry/revocation/audit
-- plus avatars and selected borders on the friend/member results.
--
-- THE RULE THIS MIGRATION EXISTS TO ENFORCE: a profile is a set of fields each
-- of which is separately permitted. Nothing here returns "the user row" and
-- trusts the client to hide the private parts -- every field is gated
-- server-side, because a field the client is trusted to hide is a field that
-- leaks the first time somebody reads the network tab.

-- ---------------------------------------------------------------------------
-- Schema.
-- ---------------------------------------------------------------------------

-- Avatars come from Discord. The host allowlist is not decoration: this URL is
-- rendered as an <img> in OTHER people's clients, so an arbitrary URL here is a
-- tracking beacon that hands the setter every viewer's IP address and user
-- agent. Constrain it at the column, where it cannot be bypassed by a future
-- RPC that forgets to check.
alter table public.player_stats
  add column if not exists avatar_url text
  check (
    avatar_url is null
    or avatar_url ~ '^https://cdn\.discordapp\.com/[A-Za-z0-9/_.-]+$'
  );

-- Achievements are opt-in and SEPARATE from stats: "show my watch time" and
-- "show what I have unlocked" are different disclosures, and bundling them
-- means a user who wanted one is forced into both.
alter table public.player_stats
  add column if not exists share_achievements boolean not null default false;

-- ---------------------------------------------------------------------------
-- Field helpers. Each answers one question, so a caller cannot accidentally
-- widen disclosure by reaching for a convenient composite.
-- ---------------------------------------------------------------------------

create or replace function public.safe_display_name(p_user uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(nullif(ps.display_name, ''), 'Someone')
  from player_stats ps where ps.user_id = p_user;
$$;

create or replace function public.safe_avatar_url(p_user uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select ps.avatar_url from player_stats ps where ps.user_id = p_user;
$$;

-- A selected border is only real if it was actually unlocked. Returning the raw
-- column would let anyone display any border by writing to their own row: the
-- unlock check lives here so a forged selection renders as nothing rather than
-- as a badge they never earned.
create or replace function public.validated_border(p_user uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select ps.selected_border_id
  from player_stats ps
  where ps.user_id = p_user
    and ps.selected_border_id is not null
    and (
      exists (
        select 1 from player_border_unlocks u
        where u.user_id = p_user and u.border_id = ps.selected_border_id
      )
      -- A border with no achievement requirement is available to everyone.
      or exists (
        select 1 from profile_borders b
        where b.id = ps.selected_border_id and b.required_achievement_id is null
      )
    );
$$;

-- The caller writes their own avatar; nobody writes anyone else's.
create or replace function public.set_profile_avatar(p_url text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
begin
  update player_stats
  set avatar_url = nullif(trim(coalesce(p_url, '')), ''), updated_at = now()
  where user_id = me;
  return 'ok';
end;
$$;

create or replace function public.set_share_achievements(p_share boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
begin
  update player_stats
  set share_achievements = coalesce(p_share, false), updated_at = now()
  where user_id = me;
  return 'ok';
end;
$$;

grant execute on function public.set_profile_avatar(text) to authenticated;
grant execute on function public.set_share_achievements(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 1. The profile.
--
-- jsonb rather than a wide row: the shape is nested (stats, achievements,
-- mutual rooms) and a client that ignores a key it does not know about is
-- exactly the forward compatibility we want.
-- ---------------------------------------------------------------------------

create or replace function public.get_social_profile(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  me uuid := public.require_auth();
  friends boolean;
  shares_stats boolean;
  shares_achievements boolean;
  result jsonb;
begin
  if p_user is null or not exists (select 1 from auth.users where id = p_user) then
    raise exception 'forbidden';
  end if;

  -- A block is total. Not a filtered profile, not an empty profile -- no
  -- profile: the existence of the row is itself information.
  if public.is_blocked(me, p_user) then
    raise exception 'blocked';
  end if;

  friends := public.are_friends(me, p_user) or me = p_user;

  select coalesce(ps.share_stats, false), coalesce(ps.share_achievements, false)
    into shares_stats, shares_achievements
  from player_stats ps where ps.user_id = p_user;

  -- Your own profile is always fully visible to you, whatever your flags say.
  if me = p_user then
    shares_stats := true;
    shares_achievements := true;
  end if;

  result := jsonb_build_object(
    'userId', p_user,
    'displayName', public.safe_display_name(p_user),
    'avatarUrl', public.safe_avatar_url(p_user),
    'selectedBorderId', public.validated_border(p_user),
    'isSelf', me = p_user,
    'isFriend', public.are_friends(me, p_user),
    'canMessage', friends,
    'canInvite', friends,
    'sharesStats', shares_stats,
    'sharesAchievements', shares_achievements
  );

  -- Stats: opt-in, and never itemised beyond what the leaderboard already shows.
  if shares_stats then
    result := result || jsonb_build_object(
      'stats',
      (select jsonb_build_object(
         'roomsJoined', ps.rooms_joined,
         'watchSeconds', ps.watch_seconds,
         'reactionsSent', ps.reactions_sent,
         'streakDays', ps.streak_days
       )
       from player_stats ps where ps.user_id = p_user)
    );
  end if;

  if shares_achievements then
    result := result || jsonb_build_object(
      'achievements',
      coalesce(
        (select jsonb_agg(jsonb_build_object('id', a.achievement_id, 'unlockedAt', a.unlocked_at)
                          order by a.unlocked_at desc)
         from player_achievements a where a.user_id = p_user),
        '[]'::jsonb)
    );
  end if;

  -- Mutual rooms: persistent rooms BOTH of you can reach. A room only one of
  -- you can access is not a shared context, and naming it would disclose where
  -- this person spends time -- so the join is what protects the code, and the
  -- code is only ever emitted for a room the caller could already open.
  if friends then
    result := result || jsonb_build_object(
      'mutualRooms',
      coalesce(
        (select jsonb_agg(jsonb_build_object('code', r.code, 'name', r.name))
         from rooms r
         where public.can_access_room(me, r.code)
           and public.can_access_room(p_user, r.code)
         limit 20),
        '[]'::jsonb)
    );
  end if;

  return result;
end;
$$;

-- Access to a persistent room: you own it, you were invited, or you have been
-- in it. Defined once so the profile and the invite path cannot drift apart.
create or replace function public.can_access_room(p_user uuid, p_room text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from rooms r where r.code = p_room and r.owner_id = p_user)
      or exists (select 1 from room_invites i where i.room_code = p_room and i.user_id = p_user)
      or exists (select 1 from room_participants pt where pt.room_code = p_room and pt.user_id = p_user);
$$;

grant execute on function public.get_social_profile(uuid) to authenticated;
grant execute on function public.can_access_room(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Blocked-user management.
--
-- Without this the frontend has to keep a client-side shadow list of who it
-- blocked, which is wrong the moment the user blocks someone on another device.
-- ---------------------------------------------------------------------------

create or replace function public.list_blocked_users()
returns table (
  user_id uuid,
  display_name text,
  avatar_url text,
  blocked_at timestamptz
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
  select
    b.blocked_id,
    public.safe_display_name(b.blocked_id),
    public.safe_avatar_url(b.blocked_id),
    b.created_at
  from user_blocks b
  where b.blocker_id = me
  order by b.created_at desc
  limit 200;
end;
$$;

grant execute on function public.list_blocked_users() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Conversation members.
--
-- The frontend currently falls back to a shortened UUID for a non-friend in a
-- group, which is both ugly and a small privacy leak in its own right (a raw
-- user id is a stable cross-room identifier). Membership is the authorisation:
-- if you are in the room you may see who else is, and removal revokes it.
-- ---------------------------------------------------------------------------

create or replace function public.get_conversation_members(p_conversation uuid)
returns table (
  user_id uuid,
  display_name text,
  avatar_url text,
  selected_border_id text,
  role text,
  joined_at timestamptz
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
  if not public.is_active_member(p_conversation, me) then
    raise exception 'forbidden';
  end if;

  return query
  select
    m.user_id,
    public.safe_display_name(m.user_id),
    public.safe_avatar_url(m.user_id),
    public.validated_border(m.user_id),
    m.role,
    m.joined_at
  from conversation_members m
  where m.conversation_id = p_conversation
    and m.left_at is null
    -- A block hides you from each other even inside a shared group. You stay a
    -- member; you simply do not render for one another.
    and not public.is_blocked(me, m.user_id)
  order by m.joined_at asc;
end;
$$;

grant execute on function public.get_conversation_members(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Friend -> persistent-room invitations.
-- ---------------------------------------------------------------------------

create table if not exists public.room_friend_invites (
  id uuid primary key default gen_random_uuid(),
  room_code text not null references public.rooms (code) on delete cascade,
  inviter_id uuid not null references auth.users (id) on delete cascade,
  invitee_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'revoked')),
  created_at timestamptz not null default now(),
  -- Expiry is not politeness: an invitation is standing access to a room, and
  -- one that never expires is a permanent key handed out and forgotten.
  expires_at timestamptz not null default now() + interval '7 days',
  responded_at timestamptz,
  check (inviter_id <> invitee_id)
);

-- One live invitation per (room, invitee). Re-inviting refreshes rather than
-- stacking, so a determined inviter cannot flood someone's list.
create unique index if not exists room_friend_invites_live
  on public.room_friend_invites (room_code, invitee_id)
  where status = 'pending';

create index if not exists room_friend_invites_invitee
  on public.room_friend_invites (invitee_id, created_at desc);

alter table public.room_friend_invites enable row level security;

-- Readable by the two people involved and nobody else. All writes go through
-- the RPCs below -- there is deliberately no INSERT/UPDATE policy.
create policy room_friend_invites_party_select on public.room_friend_invites
  for select using (auth.uid() in (inviter_id, invitee_id));

-- A social audit trail, separate from creator_audit_log (which is club-scoped).
-- Append-only: a SELECT policy and nothing else, so not even the actor can
-- rewrite what they did.
create table if not exists public.social_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid not null references auth.users (id) on delete cascade,
  subject_id uuid references auth.users (id) on delete set null,
  action text not null check (char_length(action) <= 40),
  detail text not null default '' check (char_length(detail) <= 200),
  created_at timestamptz not null default now()
);

create index if not exists social_audit_actor on public.social_audit_log (actor_id, created_at desc);

alter table public.social_audit_log enable row level security;

create policy social_audit_own_select on public.social_audit_log
  for select using (auth.uid() in (actor_id, subject_id));

create or replace function public.social_audit(
  p_actor uuid,
  p_subject uuid,
  p_action text,
  p_detail text default ''
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into social_audit_log (actor_id, subject_id, action, detail)
  values (p_actor, p_subject, left(p_action, 40), left(coalesce(p_detail, ''), 200));
$$;

-- 20 room invitations a day. The same ceiling as friend requests, for the same
-- reason: an invitation is an unsolicited notification.
create or replace function public.under_limit_room_invites(p_user uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select count(*) < 20
  from room_friend_invites
  where inviter_id = p_user and created_at > now() - interval '1 day';
$$;

create or replace function public.invite_friend_to_room(p_room text, p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
  new_id uuid;
begin
  if not exists (select 1 from rooms where code = p_room) then
    raise exception 'forbidden';
  end if;
  -- You cannot hand out access you do not have.
  if not public.can_access_room(me, p_room) then
    raise exception 'forbidden';
  end if;
  if public.is_blocked(me, p_user) then
    raise exception 'blocked';
  end if;
  -- Friends only. An invitation from a stranger is a message from a stranger.
  if not public.are_friends(me, p_user) then
    raise exception 'forbidden';
  end if;
  if not public.under_limit_room_invites(me) then
    raise exception 'rate-limited';
  end if;

  -- Deliberately NOT gated on presence consent: share_online governs whether
  -- friends see you online, not whether a friend may invite you. Conflating the
  -- two would let a privacy setting silently swallow invitations, leaving the
  -- inviter believing one landed. Declining is the invitee's answer to give.

  insert into room_friend_invites (room_code, inviter_id, invitee_id)
  values (p_room, me, p_user)
  on conflict (room_code, invitee_id) where status = 'pending'
  do update set created_at = now(), expires_at = now() + interval '7 days'
  returning id into new_id;

  perform public.emit_notification(
    p_user, me, 'room.invite',
    jsonb_build_object('roomCode', p_room, 'inviteId', new_id,
                       'from', public.safe_display_name(me))
  );
  perform public.social_audit(me, p_user, 'room.invite', p_room);

  return new_id;
end;
$$;

create or replace function public.respond_room_invite(p_invite uuid, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
  invite record;
begin
  select * into invite from room_friend_invites where id = p_invite;
  if not found or invite.invitee_id <> me then
    raise exception 'forbidden';
  end if;
  if invite.status <> 'pending' then
    raise exception 'forbidden';
  end if;
  -- An expired invitation is not a slow one. It is gone.
  if invite.expires_at < now() then
    raise exception 'forbidden';
  end if;

  update room_friend_invites
  set status = case when p_accept then 'accepted' else 'declined' end,
      responded_at = now()
  where id = p_invite;

  -- Accepting is what grants access: the invitation is a request, and
  -- room_invites is the grant.
  if p_accept then
    insert into room_invites (room_code, user_id)
    values (invite.room_code, me)
    on conflict (room_code, user_id) do nothing;
  end if;

  perform public.social_audit(
    me, invite.inviter_id,
    case when p_accept then 'room.invite.accept' else 'room.invite.decline' end,
    invite.room_code);

  return 'ok';
end;
$$;

create or replace function public.revoke_room_invite(p_invite uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
  invite record;
begin
  select * into invite from room_friend_invites where id = p_invite;
  if not found or invite.inviter_id <> me then
    raise exception 'forbidden';
  end if;

  update room_friend_invites
  set status = 'revoked', responded_at = now()
  where id = p_invite and status = 'pending';

  perform public.social_audit(me, invite.invitee_id, 'room.invite.revoke', invite.room_code);
  return 'ok';  -- Idempotent.
end;
$$;

-- Invitations addressed to you. Expired ones are filtered out rather than
-- deleted: the row is the audit record of what was offered.
create or replace function public.list_room_invites()
returns table (
  id uuid,
  room_code text,
  room_name text,
  inviter_id uuid,
  inviter_name text,
  inviter_avatar text,
  created_at timestamptz,
  expires_at timestamptz
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
  select
    i.id,
    i.room_code,
    r.name,
    i.inviter_id,
    public.safe_display_name(i.inviter_id),
    public.safe_avatar_url(i.inviter_id),
    i.created_at,
    i.expires_at
  from room_friend_invites i
  join rooms r on r.code = i.room_code
  where i.invitee_id = me
    and i.status = 'pending'
    and i.expires_at > now()
    and not public.is_blocked(me, i.inviter_id)
  order by i.created_at desc
  limit 50;
end;
$$;

grant execute on function public.invite_friend_to_room(text, uuid) to authenticated;
grant execute on function public.respond_room_invite(uuid, boolean) to authenticated;
grant execute on function public.revoke_room_invite(uuid) to authenticated;
grant execute on function public.list_room_invites() to authenticated;

-- ---------------------------------------------------------------------------
-- Avatars and borders on the friend graph.
-- Columns are APPENDED, so a client reading the old five positionally is
-- unaffected.
-- ---------------------------------------------------------------------------

drop function if exists public.get_social_graph();

create or replace function public.get_social_graph()
returns table (
  kind text,
  user_id uuid,
  display_name text,
  request_id uuid,
  created_at timestamptz,
  avatar_url text,
  selected_border_id text
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
  select
    'friend'::text, f.other, public.safe_display_name(f.other), null::uuid, f.since,
    public.safe_avatar_url(f.other), public.validated_border(f.other)
  from (
    select
      case when fr.user_low = me then fr.user_high else fr.user_low end as other,
      fr.created_at as since
    from friendships fr
    where me in (fr.user_low, fr.user_high)
  ) f
  where not public.is_blocked(me, f.other)

  union all

  select
    'incoming'::text, r.sender_id, public.safe_display_name(r.sender_id), r.id, r.created_at,
    public.safe_avatar_url(r.sender_id), public.validated_border(r.sender_id)
  from friend_requests r
  where r.recipient_id = me and r.status = 'pending'
    and not public.is_blocked(me, r.sender_id)

  union all

  select
    'outgoing'::text, r.recipient_id, public.safe_display_name(r.recipient_id), r.id, r.created_at,
    public.safe_avatar_url(r.recipient_id), public.validated_border(r.recipient_id)
  from friend_requests r
  where r.sender_id = me and r.status = 'pending'
    and not public.is_blocked(me, r.recipient_id)

  union all

  -- Phase 19 co-watcher suggestions: people you have shared a persistent room
  -- with, who are not already friends, not already in a live request, and not
  -- blocked. Only surfaces users who opted into sharing.
  --
  -- The share_stats gate is CONSENT, not a filter -- dropping it would surface
  -- people who never agreed to be discoverable. This branch is copied verbatim
  -- from 0009 with only the two new columns appended.
  select
    'suggestion'::text,
    theirs.user_id,
    coalesce(nullif(ps.display_name, ''), 'Someone'),
    null::uuid,
    max(theirs.last_seen_at),
    ps.avatar_url,
    public.validated_border(theirs.user_id)
  from room_participants mine
  join room_participants theirs on theirs.room_code = mine.room_code
  join player_stats ps on ps.user_id = theirs.user_id
  where mine.user_id = me
    and theirs.user_id <> me
    and ps.share_stats = true
    and not public.are_friends(me, theirs.user_id)
    and not public.is_blocked(me, theirs.user_id)
    and not exists (
      select 1 from friend_requests r
      where r.status = 'pending'
        and least(r.sender_id, r.recipient_id) = least(me, theirs.user_id)
        and greatest(r.sender_id, r.recipient_id) = greatest(me, theirs.user_id)
    )
  group by theirs.user_id, ps.display_name, ps.avatar_url;
end;
$$;

grant execute on function public.get_social_graph() to authenticated;

-- ---------------------------------------------------------------------------
-- ROLLBACK (run before 0019's rollback)
-- ---------------------------------------------------------------------------
--   -- restore get_social_graph from 0009 first
--   drop function if exists public.list_room_invites();
--   drop function if exists public.revoke_room_invite(uuid);
--   drop function if exists public.respond_room_invite(uuid, boolean);
--   drop function if exists public.invite_friend_to_room(text, uuid);
--   drop function if exists public.under_limit_room_invites(uuid);
--   drop function if exists public.social_audit(uuid, uuid, text, text);
--   drop table if exists public.social_audit_log;
--   drop table if exists public.room_friend_invites;
--   drop function if exists public.get_conversation_members(uuid);
--   drop function if exists public.list_blocked_users();
--   drop function if exists public.can_access_room(uuid, text);
--   drop function if exists public.get_social_profile(uuid);
--   drop function if exists public.set_share_achievements(boolean);
--   drop function if exists public.set_profile_avatar(text);
--   drop function if exists public.validated_border(uuid);
--   drop function if exists public.safe_avatar_url(uuid);
--   drop function if exists public.safe_display_name(uuid);
--   alter table public.player_stats drop column if exists share_achievements;
--   alter table public.player_stats drop column if exists avatar_url;
