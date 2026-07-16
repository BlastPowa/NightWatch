-- Phase 31: live-room co-watcher discovery.
--
-- v0.1.25 field report: two signed-in users watching together in an ordinary
-- six-character live room cannot find or add each other. The Phase 19
-- suggestion model records co-watchers only in PERSISTENT rooms, because
-- room_participants has a foreign key to public.rooms — an ephemeral room has
-- no rooms row, so no participant row is ever written and the social graph
-- never sees the pair.
--
-- This migration adds a short-lived presence contract for live rooms:
--
--   * live_room_social_presence — one row per (room, user), keyed by an
--     HMAC of the room code, never the code itself. Direct table access is
--     denied; RLS is enabled AND forced with no policies.
--   * heartbeat_live_room_social(code, presence_id) — upserts only the caller.
--   * list_live_room_co_watchers(code) — other fresh, signed-in users in the
--     same room, minus blocks, existing friends, and pending requests.
--   * leave_live_room_social(code) — deletes only the caller's row.
--
-- Privacy rules, matching 0021 presence:
--   * A raw room code is never stored and never returned. The stored key is
--     hmac(upper(code), per-database secret), so even a database read cannot
--     be replayed into a joinable code.
--   * Listing requires the caller to hold a FRESH heartbeat for that exact
--     room: knowing (or guessing) a code is not enough to enumerate users
--     without first standing in the room, and room-switching heartbeats are
--     rate limited to keep scanning slow.
--   * Guests and old clients simply never call these RPCs; they keep watching
--     and never appear in discovery.

-- ---------------------------------------------------------------------------
-- Keyed hash secret. pgcrypto ships enabled on Supabase in `extensions`; this
-- is a no-op there and makes the migration self-sufficient elsewhere.
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto with schema extensions;

-- One-row secret table. No policies exist, RLS is forced, and no privilege is
-- granted, so only the security-definer functions below can read it.
create table if not exists public.live_room_social_secret (
  id boolean primary key default true check (id),
  key bytea not null
);

alter table public.live_room_social_secret enable row level security;
alter table public.live_room_social_secret force row level security;
revoke all on public.live_room_social_secret from anon, authenticated;

insert into public.live_room_social_secret (id, key)
values (true, extensions.gen_random_bytes(32))
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Presence table. Same lockdown: RPC access only.
-- ---------------------------------------------------------------------------

create table if not exists public.live_room_social_presence (
  room_key_hash text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  presence_id text not null,
  last_seen_at timestamptz not null default now(),
  primary key (room_key_hash, user_id)
);

create index if not exists live_room_social_presence_seen_idx
  on public.live_room_social_presence (last_seen_at);

alter table public.live_room_social_presence enable row level security;
alter table public.live_room_social_presence force row level security;
revoke all on public.live_room_social_presence from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Internal helpers. Deliberately NOT granted to any client role.
-- ---------------------------------------------------------------------------

-- Normalize and strictly validate a live room code (same alphabet as
-- rooms_code_format in 0001 and shared/room.ts), then return its keyed hash.
-- Anything that is not exactly a room code raises 'forbidden'.
create or replace function public.live_room_key_hash(p_room_code text)
returns text
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_code text := upper(trim(coalesce(p_room_code, '')));
  v_key bytea;
begin
  if v_code !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$' then
    raise exception 'forbidden';
  end if;
  select key into v_key from live_room_social_secret where id;
  if v_key is null then
    raise exception 'error';
  end if;
  return encode(extensions.hmac(convert_to(v_code, 'utf8'), v_key, 'sha256'), 'hex');
end;
$$;

-- ---------------------------------------------------------------------------
-- heartbeat_live_room_social: upsert only the caller's row.
-- ---------------------------------------------------------------------------

create or replace function public.heartbeat_live_room_social(
  p_room_code text,
  p_presence_id text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
  v_hash text := public.live_room_key_hash(p_room_code);
begin
  if p_presence_id is null or p_presence_id !~ '^[A-Za-z0-9_-]{1,64}$' then
    raise exception 'forbidden';
  end if;

  -- Rate limit room-switching: moving to a DIFFERENT room more than once
  -- every 10 seconds is scanning, not watching. Re-heartbeating the same room
  -- is always allowed, so a normal client can never hit this.
  if exists (
    select 1 from live_room_social_presence
    where user_id = me
      and room_key_hash <> v_hash
      and last_seen_at > now() - interval '10 seconds'
  ) then
    raise exception 'rate-limited';
  end if;

  -- One live room per user: presence in any previous room ends here.
  delete from live_room_social_presence
  where user_id = me and room_key_hash <> v_hash;

  insert into live_room_social_presence (room_key_hash, user_id, presence_id, last_seen_at)
  values (v_hash, me, p_presence_id, now())
  on conflict (room_key_hash, user_id) do update
    set presence_id = excluded.presence_id,
        last_seen_at = now();

  -- Opportunistic cleanup, piggybacked on ordinary traffic so no scheduler is
  -- required. Ten minutes is far beyond the two-minute freshness horizon.
  delete from live_room_social_presence
  where last_seen_at < now() - interval '10 minutes';

  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- list_live_room_co_watchers: other fresh users in the same room, filtered.
-- ---------------------------------------------------------------------------

create or replace function public.list_live_room_co_watchers(p_room_code text)
returns table (
  user_id uuid,
  display_name text,
  avatar_url text,
  selected_border_id text
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  me uuid := public.require_auth();
  v_hash text := public.live_room_key_hash(p_room_code);
begin
  -- The caller must themselves be freshly present in this exact room. A
  -- guessed code without a prior (rate-limited) heartbeat lists nothing.
  if not exists (
    select 1 from live_room_social_presence
    where room_key_hash = v_hash
      and live_room_social_presence.user_id = me
      and last_seen_at > now() - interval '2 minutes'
  ) then
    raise exception 'forbidden';
  end if;

  return query
  select
    p.user_id,
    coalesce(nullif(ps.display_name, ''), 'Someone'),
    public.safe_avatar_url(ps.avatar_url),
    public.validated_border(p.user_id)
  from live_room_social_presence p
  left join player_stats ps on ps.user_id = p.user_id
  where p.room_key_hash = v_hash
    and p.user_id <> me
    and p.last_seen_at > now() - interval '2 minutes'
    and not public.is_blocked(me, p.user_id)
    and not public.are_friends(me, p.user_id)
    and not exists (
      select 1 from friend_requests fr
      where fr.status = 'pending'
        and ((fr.sender_id = me and fr.recipient_id = p.user_id)
          or (fr.sender_id = p.user_id and fr.recipient_id = me))
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- leave_live_room_social: delete only the caller's row.
-- ---------------------------------------------------------------------------

create or replace function public.leave_live_room_social(p_room_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
  v_hash text := public.live_room_key_hash(p_room_code);
begin
  delete from live_room_social_presence
  where room_key_hash = v_hash and user_id = me;
  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants. Signed-in users only; live_room_key_hash stays internal.
-- ---------------------------------------------------------------------------

grant execute on function public.heartbeat_live_room_social(text, text) to authenticated;
grant execute on function public.list_live_room_co_watchers(text) to authenticated;
grant execute on function public.leave_live_room_social(text) to authenticated;
revoke execute on function public.live_room_key_hash(text) from anon, authenticated;

-- Rollback (manual):
--   drop function if exists public.leave_live_room_social(text);
--   drop function if exists public.list_live_room_co_watchers(text);
--   drop function if exists public.heartbeat_live_room_social(text, text);
--   drop function if exists public.live_room_key_hash(text);
--   drop table if exists public.live_room_social_presence;
--   drop table if exists public.live_room_social_secret;
