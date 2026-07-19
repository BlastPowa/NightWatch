-- Phase 32: room media state, privacy-safe people discovery, room-people
-- actions, and ephemeral WebRTC signaling.
--
-- Depends on: 0006 (friendships/user_blocks/is_blocked), 0020
-- (safe_display_name/safe_avatar_url/validated_border/require_auth,
--  social_audit), 0023 (live_room_key_hash/live_room_social_presence),
-- 0025 (helper lockdown conventions — every new internal helper here is
-- locked the same way in the same file that creates it).
--
-- Every table is RPC-only: RLS forced, zero client privileges, all access
-- through security-definer functions that authenticate, authorize against
-- live room membership, enforce blocks, and rate-limit. No media bytes, no
-- OAuth tokens, no local paths, and no raw room codes are ever stored here.

set lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. Public handle + discovery consent (handoff §3).
--    player_stats is the de-facto profile row (0004/0006/0020).
-- ---------------------------------------------------------------------------

create extension if not exists citext with schema extensions;

alter table public.player_stats
  add column if not exists public_handle extensions.citext,
  add column if not exists discoverable boolean not null default false;

-- Unique, case-insensitive, and format-bound. Handles are opt-in identity:
-- NULL until the user sets one.
alter table public.player_stats
  add constraint player_stats_handle_format
  check (
    public_handle is null
    or public_handle::text ~ '^[a-z0-9_]{3,20}$'
  );

create unique index if not exists player_stats_handle_unique
  on public.player_stats (public_handle)
  where public_handle is not null;

create or replace function public.set_public_handle(p_handle text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := public.require_auth();
  v_handle extensions.citext;
begin
  if p_handle is null or trim(p_handle) = '' then
    update player_stats set public_handle = null where user_id = v_user;
    return;
  end if;
  v_handle := lower(trim(p_handle));
  if v_handle::text !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'invalid-handle';
  end if;
  insert into player_stats (user_id, public_handle)
  values (v_user, v_handle)
  on conflict (user_id) do update set public_handle = excluded.public_handle;
exception
  when unique_violation then
    raise exception 'handle-taken';
end;
$$;

create or replace function public.set_discoverable(p_discoverable boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.require_auth();
begin
  insert into player_stats (user_id, discoverable)
  values (v_user, coalesce(p_discoverable, false))
  on conflict (user_id) do update set discoverable = excluded.discoverable;
end;
$$;

grant execute on function public.set_public_handle(text) to authenticated;
grant execute on function public.set_discoverable(boolean) to authenticated;
revoke execute on function public.set_public_handle(text) from public, anon;
revoke execute on function public.set_discoverable(boolean) from public, anon;

-- ---------------------------------------------------------------------------
-- 2. Relationship state helper (internal). Single definition of the states
--    the discovery/room-people RPCs return.
-- ---------------------------------------------------------------------------

create or replace function public.relationship_state_between(p_viewer uuid, p_other uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select case
    when p_viewer = p_other then 'self'
    when exists (
      select 1 from friendships
      where user_low = least(p_viewer, p_other)
        and user_high = greatest(p_viewer, p_other)
    ) then 'friends'
    when exists (
      select 1 from friend_requests
      where status = 'pending' and sender_id = p_viewer and recipient_id = p_other
    ) then 'pending-outgoing'
    when exists (
      select 1 from friend_requests
      where status = 'pending' and sender_id = p_other and recipient_id = p_viewer
    ) then 'pending-incoming'
    else 'none'
  end;
$$;

revoke execute on function public.relationship_state_between(uuid, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Discovery search rate limiting (internal).
-- ---------------------------------------------------------------------------

create table if not exists public.discovery_search_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  searched_at timestamptz not null default now()
);

create index if not exists discovery_search_log_user_idx
  on public.discovery_search_log (user_id, searched_at desc);

alter table public.discovery_search_log enable row level security;
alter table public.discovery_search_log force row level security;
revoke all on public.discovery_search_log from public, anon, authenticated;

create or replace function public.under_limit_discovery(p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_minute integer;
  v_day integer;
begin
  select count(*) into v_minute
  from discovery_search_log
  where user_id = p_user and searched_at > now() - interval '1 minute';
  select count(*) into v_day
  from discovery_search_log
  where user_id = p_user and searched_at > now() - interval '1 day';
  if v_minute >= 12 or v_day >= 500 then
    return false;
  end if;
  insert into discovery_search_log (user_id) values (p_user);
  -- Opportunistic pruning keeps the log from growing without a job runner.
  delete from discovery_search_log
  where user_id = p_user and searched_at < now() - interval '2 days';
  return true;
end;
$$;

revoke execute on function public.under_limit_discovery(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. search_people (handoff §3): explicit handle or display-name search.
-- ---------------------------------------------------------------------------

create or replace function public.search_people(p_query text)
returns table (
  user_id uuid,
  handle text,
  display_name text,
  avatar_url text,
  border text,
  relationship text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := public.require_auth();
  v_query text := lower(trim(coalesce(p_query, '')));
begin
  if char_length(v_query) < 3 then
    raise exception 'query-too-short';
  end if;
  if char_length(v_query) > 40 then
    v_query := left(v_query, 40);
  end if;
  if not public.under_limit_discovery(v_user) then
    raise exception 'rate-limited';
  end if;

  return query
  select
    ps.user_id,
    ps.public_handle::text,
    public.safe_display_name(ps.user_id),
    public.safe_avatar_url(ps.user_id),
    public.validated_border(ps.user_id),
    public.relationship_state_between(v_user, ps.user_id)
  from player_stats ps
  where ps.discoverable = true
    and ps.user_id <> v_user
    and not public.is_blocked(v_user, ps.user_id)
    and not public.is_blocked(ps.user_id, v_user)
    and (
      ps.public_handle::text = v_query
      or ps.public_handle::text like v_query || '%'
      or lower(ps.display_name) = v_query
      or lower(ps.display_name) like v_query || '%'
    )
  order by
    (ps.public_handle::text = v_query) desc,
    (lower(ps.display_name) = v_query) desc,
    ps.public_handle nulls last
  limit 10;
end;
$$;

grant execute on function public.search_people(text) to authenticated;
revoke execute on function public.search_people(text) from public, anon;

-- ---------------------------------------------------------------------------
-- 5. Live-room membership helper (internal) + get_room_people (handoff §3).
--    Membership = a fresh heartbeat row in live_room_social_presence (0023).
-- ---------------------------------------------------------------------------

create or replace function public.is_live_room_member_hash(p_user uuid, p_hash text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from live_room_social_presence
    where room_key_hash = p_hash
      and user_id = p_user
      and last_seen_at > now() - interval '90 seconds'
  );
$$;

revoke execute on function public.is_live_room_member_hash(uuid, text)
  from public, anon, authenticated;

create or replace function public.get_room_people(p_room_code text)
returns table (
  user_id uuid,
  handle text,
  display_name text,
  avatar_url text,
  border text,
  relationship text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := public.require_auth();
  v_hash text := public.live_room_key_hash(p_room_code);
begin
  -- The caller must themselves be a fresh member; a room code alone is not
  -- enough to enumerate who is inside.
  if not public.is_live_room_member_hash(v_user, v_hash) then
    raise exception 'forbidden';
  end if;

  return query
  select
    p.user_id,
    ps.public_handle::text,
    public.safe_display_name(p.user_id),
    public.safe_avatar_url(p.user_id),
    public.validated_border(p.user_id),
    public.relationship_state_between(v_user, p.user_id)
  from live_room_social_presence p
  left join player_stats ps on ps.user_id = p.user_id
  where p.room_key_hash = v_hash
    and p.last_seen_at > now() - interval '90 seconds'
    and p.user_id <> v_user
    -- A block in EITHER direction removes the pair from each other's view.
    and not public.is_blocked(v_user, p.user_id)
    and not public.is_blocked(p.user_id, v_user)
  limit 64;
end;
$$;

grant execute on function public.get_room_people(text) to authenticated;
revoke execute on function public.get_room_people(text) from public, anon;

-- ---------------------------------------------------------------------------
-- 6. Versioned room-media state and file-watch readiness (handoff §1/§6).
--    The first fresh member to publish becomes the server-side controller.
--    Only that controller may update until its live heartbeat expires, at
--    which point another fresh member may claim control (host migration).
-- ---------------------------------------------------------------------------

create or replace function public.valid_room_media_mode(p_mode jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_descriptor jsonb;
  v_kind text;
  v_size numeric;
  v_mode_key_count integer;
  v_descriptor_key_count integer;
begin
  if jsonb_typeof(p_mode) <> 'object'
     or p_mode ->> 'modeVersion' <> '2'
     or p_mode ->> 'mode' not in ('youtube', 'file-watch', 'live-share') then
    return false;
  end if;

  select count(*) into v_mode_key_count from jsonb_object_keys(p_mode);

  if p_mode ->> 'mode' = 'live-share' then
    return v_mode_key_count = 5
      and coalesce(p_mode ->> 'sessionId', '') ~ '^[0-9a-f]{32}$'
      and char_length(coalesce(p_mode ->> 'sharerId', '')) between 1 and 64
      and char_length(coalesce(p_mode ->> 'sourceLabel', '')) between 1 and 80;
  end if;

  v_descriptor := p_mode -> 'descriptor';
  if jsonb_typeof(v_descriptor) <> 'object'
     or v_descriptor ->> 'schemaVersion' <> '1' then
    return false;
  end if;
  select count(*) into v_descriptor_key_count from jsonb_object_keys(v_descriptor);

  if p_mode ->> 'mode' = 'youtube' then
    return v_mode_key_count = 3
      and v_descriptor_key_count = 3
      and v_descriptor ->> 'kind' = 'youtube'
      and coalesce(v_descriptor ->> 'videoId', '') ~ '^[A-Za-z0-9_-]{11}$';
  end if;

  if v_mode_key_count <> 4
     or p_mode ->> 'readiness' not in ('all-ready', 'majority-ready', 'host-only') then
    return false;
  end if;
  v_kind := v_descriptor ->> 'kind';
  if v_kind not in ('local', 'drive')
     or coalesce(v_descriptor ->> 'fingerprint', '') !~ '^sha256:[0-9a-f]{64}$'
     or char_length(trim(coalesce(v_descriptor ->> 'title', ''))) not between 1 and 300
     or v_descriptor ->> 'mimeType' not in ('video/mp4', 'video/webm')
     or jsonb_typeof(v_descriptor -> 'size') <> 'number' then
    return false;
  end if;
  v_size := (v_descriptor ->> 'size')::numeric;
  if v_size <> trunc(v_size) or v_size <= 0 or v_size > 34359738368 then
    return false;
  end if;
  if v_kind = 'local' then
    return v_descriptor_key_count = 6;
  end if;
  return v_descriptor_key_count = 7
    and coalesce(v_descriptor ->> 'fileId', '') ~ '^[A-Za-z0-9_-]{10,128}$';
exception when others then
  return false;
end;
$$;

revoke execute on function public.valid_room_media_mode(jsonb)
  from public, anon, authenticated;

create table if not exists public.room_media_state (
  room_key_hash text primary key,
  controller_id uuid not null references auth.users (id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  mode jsonb not null check (public.valid_room_media_mode(mode)),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '6 hours'
);

create index if not exists room_media_state_expiry_idx
  on public.room_media_state (expires_at);

create table if not exists public.room_media_readiness (
  room_key_hash text not null,
  revision bigint not null check (revision > 0),
  user_id uuid not null references auth.users (id) on delete cascade,
  readiness text not null check (readiness in (
    'ready', 'missing-file', 'permission-required', 'fingerprint-mismatch',
    'unsupported-codec', 'buffering', 'offline', 'rate-limited'
  )),
  updated_at timestamptz not null default now(),
  primary key (room_key_hash, user_id)
);

create index if not exists room_media_readiness_revision_idx
  on public.room_media_readiness (room_key_hash, revision);

alter table public.room_media_state enable row level security;
alter table public.room_media_state force row level security;
alter table public.room_media_readiness enable row level security;
alter table public.room_media_readiness force row level security;
revoke all on public.room_media_state from public, anon, authenticated;
revoke all on public.room_media_readiness from public, anon, authenticated;

create or replace function public.publish_room_media_descriptor(
  p_room_code text,
  p_expected_revision bigint,
  p_mode jsonb
)
returns table (
  revision bigint,
  controller_id uuid,
  mode jsonb,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.require_auth();
  v_hash text := public.live_room_key_hash(p_room_code);
  v_controller uuid;
  v_revision bigint;
begin
  if not public.is_live_room_member_hash(v_user, v_hash) then
    raise exception 'forbidden';
  end if;
  if not public.valid_room_media_mode(p_mode) then
    raise exception 'invalid-media-mode';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_hash, 0));
  select s.controller_id, s.revision
    into v_controller, v_revision
  from room_media_state s
  where s.room_key_hash = v_hash and s.expires_at > now()
  for update;

  if not found then
    if p_expected_revision is not null and p_expected_revision <> 0 then
      raise exception 'revision-conflict';
    end if;
    insert into room_media_state
      (room_key_hash, controller_id, revision, mode, updated_at, expires_at)
    values (v_hash, v_user, 1, p_mode, now(), now() + interval '6 hours')
    on conflict (room_key_hash) do update set
      controller_id = excluded.controller_id,
      revision = room_media_state.revision + 1,
      mode = excluded.mode,
      updated_at = now(),
      expires_at = now() + interval '6 hours';
  else
    if v_controller <> v_user
       and public.is_live_room_member_hash(v_controller, v_hash) then
      raise exception 'forbidden';
    end if;
    if p_expected_revision is not null and p_expected_revision <> v_revision then
      raise exception 'revision-conflict';
    end if;
    update room_media_state s set
      controller_id = v_user,
      revision = s.revision + 1,
      mode = p_mode,
      updated_at = now(),
      expires_at = now() + interval '6 hours'
    where s.room_key_hash = v_hash;
  end if;

  delete from room_media_readiness r where r.room_key_hash = v_hash;
  delete from room_media_state s where s.expires_at < now();

  return query
  select s.revision, s.controller_id, s.mode, s.updated_at
  from room_media_state s where s.room_key_hash = v_hash;
end;
$$;

create or replace function public.get_room_media_descriptor(p_room_code text)
returns table (
  revision bigint,
  controller_id uuid,
  mode jsonb,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_user uuid := public.require_auth();
  v_hash text := public.live_room_key_hash(p_room_code);
begin
  if not public.is_live_room_member_hash(v_user, v_hash) then
    raise exception 'forbidden';
  end if;
  return query
  select s.revision, s.controller_id, s.mode, s.updated_at
  from room_media_state s
  where s.room_key_hash = v_hash and s.expires_at > now();
end;
$$;

create or replace function public.report_media_readiness(
  p_room_code text,
  p_revision bigint,
  p_readiness text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.require_auth();
  v_hash text := public.live_room_key_hash(p_room_code);
begin
  if not public.is_live_room_member_hash(v_user, v_hash) then
    raise exception 'forbidden';
  end if;
  if p_readiness not in (
    'ready', 'missing-file', 'permission-required', 'fingerprint-mismatch',
    'unsupported-codec', 'buffering', 'offline', 'rate-limited'
  ) then
    raise exception 'invalid-readiness';
  end if;
  if not exists (
    select 1 from room_media_state s
    where s.room_key_hash = v_hash
      and s.revision = p_revision
      and s.expires_at > now()
      and s.mode ->> 'mode' = 'file-watch'
  ) then
    raise exception 'revision-conflict';
  end if;
  insert into room_media_readiness
    (room_key_hash, revision, user_id, readiness, updated_at)
  values (v_hash, p_revision, v_user, p_readiness, now())
  on conflict (room_key_hash, user_id) do update set
    revision = excluded.revision,
    readiness = excluded.readiness,
    updated_at = now();
end;
$$;

create or replace function public.get_media_readiness_roster(
  p_room_code text,
  p_revision bigint
)
returns table (
  user_id uuid,
  display_name text,
  avatar_url text,
  border text,
  readiness text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_user uuid := public.require_auth();
  v_hash text := public.live_room_key_hash(p_room_code);
begin
  if not public.is_live_room_member_hash(v_user, v_hash) then
    raise exception 'forbidden';
  end if;
  if not exists (
    select 1 from room_media_state s
    where s.room_key_hash = v_hash
      and s.revision = p_revision
      and s.expires_at > now()
      and s.mode ->> 'mode' = 'file-watch'
  ) then
    raise exception 'revision-conflict';
  end if;
  return query
  select
    p.user_id,
    public.safe_display_name(p.user_id),
    public.safe_avatar_url(p.user_id),
    public.validated_border(p.user_id),
    coalesce(r.readiness, 'offline'),
    r.updated_at
  from live_room_social_presence p
  left join room_media_readiness r
    on r.room_key_hash = p.room_key_hash
   and r.user_id = p.user_id
   and r.revision = p_revision
  where p.room_key_hash = v_hash
    and p.last_seen_at > now() - interval '90 seconds'
    and not public.is_blocked(v_user, p.user_id)
    and not public.is_blocked(p.user_id, v_user)
  order by (p.user_id = v_user) desc, public.safe_display_name(p.user_id)
  limit 64;
end;
$$;

grant execute on function public.publish_room_media_descriptor(text, bigint, jsonb)
  to authenticated;
grant execute on function public.get_room_media_descriptor(text) to authenticated;
grant execute on function public.report_media_readiness(text, bigint, text)
  to authenticated;
grant execute on function public.get_media_readiness_roster(text, bigint)
  to authenticated;
revoke execute on function public.publish_room_media_descriptor(text, bigint, jsonb)
  from public, anon;
revoke execute on function public.get_room_media_descriptor(text) from public, anon;
revoke execute on function public.report_media_readiness(text, bigint, text)
  from public, anon;
revoke execute on function public.get_media_readiness_roster(text, bigint)
  from public, anon;

-- Side-effect-free deployment discovery for capability-gated clients. This
-- intentionally reports only which contracts exist; authentication and room
-- membership are still enforced by every operation above.
create or replace function public.get_room_comms_capabilities()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'peopleDiscovery', true,
    'roomPeople', true,
    'roomMedia', true,
    'signaling', true
  );
$$;

grant execute on function public.get_room_comms_capabilities()
  to anon, authenticated;
revoke execute on function public.get_room_comms_capabilities() from public;

-- ---------------------------------------------------------------------------
-- 7. Ephemeral WebRTC signaling (handoff §4). RPC-only table with expiry.
--    Payloads are opaque SDP/ICE text — never media, never above 16 KiB.
-- ---------------------------------------------------------------------------

create table if not exists public.rtc_signals (
  id bigint generated always as identity primary key,
  room_key_hash text not null,
  sender_id uuid not null references auth.users (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  purpose text not null check (purpose in ('voice', 'screen-share')),
  kind text not null check (kind in ('offer', 'answer', 'ice', 'bye')),
  session_id text not null check (session_id ~ '^[0-9a-f]{32}$'),
  payload text not null check (char_length(payload) <= 16384),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '60 seconds',
  constraint rtc_signals_not_self check (sender_id <> recipient_id)
);

create index if not exists rtc_signals_inbox_idx
  on public.rtc_signals (recipient_id, id);
create index if not exists rtc_signals_expiry_idx
  on public.rtc_signals (expires_at);
create index if not exists rtc_signals_sender_recent_idx
  on public.rtc_signals (sender_id, created_at desc);

alter table public.rtc_signals enable row level security;
alter table public.rtc_signals force row level security;
revoke all on public.rtc_signals from public, anon, authenticated;

create or replace function public.send_rtc_signal(
  p_room_code text,
  p_recipient uuid,
  p_purpose text,
  p_kind text,
  p_session_id text,
  p_payload text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.require_auth();
  v_hash text := public.live_room_key_hash(p_room_code);
  v_recent integer;
begin
  if p_recipient is null or p_recipient = v_user then
    raise exception 'forbidden';
  end if;
  if p_purpose not in ('voice', 'screen-share')
     or p_kind not in ('offer', 'answer', 'ice', 'bye') then
    raise exception 'forbidden';
  end if;
  if p_session_id is null or p_session_id !~ '^[0-9a-f]{32}$' then
    raise exception 'forbidden';
  end if;
  if p_kind = 'bye' then
    if coalesce(p_payload, '') <> '' then
      raise exception 'forbidden';
    end if;
  elsif p_payload is null
     or char_length(p_payload) = 0
     or char_length(p_payload) > 16384 then
    raise exception 'forbidden';
  end if;

  -- Both endpoints must be fresh members of the same room.
  if not public.is_live_room_member_hash(v_user, v_hash)
     or not public.is_live_room_member_hash(p_recipient, v_hash) then
    raise exception 'forbidden';
  end if;

  -- Blocks kill signaling in both directions.
  if public.is_blocked(v_user, p_recipient) or public.is_blocked(p_recipient, v_user) then
    raise exception 'blocked';
  end if;

  -- Rate cap: ICE trickles in bursts, so the window is short and generous
  -- for a mesh of RTC_MESH_MAX_PEERS but hostile to floods.
  select count(*) into v_recent
  from rtc_signals
  where sender_id = v_user and created_at > now() - interval '10 seconds';
  if v_recent >= 80 then
    raise exception 'rate-limited';
  end if;

  insert into rtc_signals
    (room_key_hash, sender_id, recipient_id, purpose, kind, session_id, payload)
  values
    (v_hash, v_user, p_recipient, p_purpose, p_kind, p_session_id, coalesce(p_payload, ''));

  -- Opportunistic expiry sweep: ephemerality without a scheduler.
  delete from rtc_signals where expires_at < now();
end;
$$;

create or replace function public.fetch_rtc_signals(
  p_room_code text,
  p_after bigint default 0
)
returns table (
  id bigint,
  sender_id uuid,
  purpose text,
  kind text,
  session_id text,
  payload text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.require_auth();
  v_hash text := public.live_room_key_hash(p_room_code);
begin
  if not public.is_live_room_member_hash(v_user, v_hash) then
    raise exception 'forbidden';
  end if;

  return query
  select s.id, s.sender_id, s.purpose, s.kind, s.session_id, s.payload, s.created_at
  from rtc_signals s
  where s.recipient_id = v_user
    and s.room_key_hash = v_hash
    and s.id > coalesce(p_after, 0)
    and s.expires_at > now()
    and public.is_live_room_member_hash(s.sender_id, v_hash)
    -- A block created mid-session silences already-queued signals too.
    and not public.is_blocked(v_user, s.sender_id)
    and not public.is_blocked(s.sender_id, v_user)
  order by s.id
  limit 100;
end;
$$;

grant execute on function public.send_rtc_signal(text, uuid, text, text, text, text)
  to authenticated;
grant execute on function public.fetch_rtc_signals(text, bigint) to authenticated;
revoke execute on function public.send_rtc_signal(text, uuid, text, text, text, text)
  from public, anon;
revoke execute on function public.fetch_rtc_signals(text, bigint) from public, anon;

-- ---------------------------------------------------------------------------
-- 8. TURN authorization (service-role only; called by the turn-credentials
--    Edge Function, never by clients).
-- ---------------------------------------------------------------------------

create table if not exists public.turn_credential_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  issued_at timestamptz not null default now()
);

create index if not exists turn_credential_log_user_idx
  on public.turn_credential_log (user_id, issued_at desc);

alter table public.turn_credential_log enable row level security;
alter table public.turn_credential_log force row level security;
revoke all on public.turn_credential_log from public, anon, authenticated;

create or replace function public.authorize_turn_access(p_user uuid, p_room_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_today integer;
begin
  if p_user is null then
    return 'forbidden';
  end if;
  begin
    v_hash := public.live_room_key_hash(p_room_code);
  exception when others then
    return 'forbidden';
  end;
  if not public.is_live_room_member_hash(p_user, v_hash) then
    return 'forbidden';
  end if;
  select count(*) into v_today
  from turn_credential_log
  where user_id = p_user and issued_at > now() - interval '1 day';
  if v_today >= 120 then
    return 'rate-limited';
  end if;
  insert into turn_credential_log (user_id) values (p_user);
  delete from turn_credential_log
  where user_id = p_user and issued_at < now() - interval '2 days';
  return 'allowed';
end;
$$;

-- Service role only: no client role may probe TURN authorization directly.
grant execute on function public.authorize_turn_access(uuid, text) to service_role;
revoke execute on function public.authorize_turn_access(uuid, text)
  from public, anon, authenticated;
