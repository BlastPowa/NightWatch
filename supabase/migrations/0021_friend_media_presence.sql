-- Phase 24: consent-safe playable friend activity.
--
-- The Browse shelf wants to show "your friend is watching THIS video, join
-- them" — which means presence must be able to carry a YouTube video id, not
-- just a title. That is strictly more sensitive than 0006 presence, so it ships
-- as NEW, additive surface area:
--
--   * a nullable presence_preferences.video_id column (old heartbeat_presence
--     never writes it, so it stays null for v0.1.22 clients);
--   * heartbeat_media_presence(), a superset of heartbeat_presence() that also
--     accepts a validated 11-character video id;
--   * get_friend_presence_v2(), a superset of get_friend_presence() that adds a
--     server-validated avatar, the validated profile border, and the video id —
--     the id only when the friend explicitly shares activity.
--
-- The originals (heartbeat_presence / get_friend_presence) are left untouched
-- so existing clients keep working unchanged. As with all presence here, a room
-- code is NEVER stored and NEVER returned: presence says a friend is watching,
-- never where to walk in on them.

-- ---------------------------------------------------------------------------
-- Schema: additive, nullable video id with a strict shape check.
-- ---------------------------------------------------------------------------

alter table public.presence_preferences
  add column if not exists video_id text
    check (video_id is null or video_id ~ '^[A-Za-z0-9_-]{11}$');

-- ---------------------------------------------------------------------------
-- Helpers.
-- ---------------------------------------------------------------------------

-- Reduce any stored avatar to a safe-to-expose value. set_profile_avatar (0020)
-- stores whatever the caller wrote, so the allowlist has to be enforced on the
-- way OUT before another user's client ever renders it: only canonical Discord
-- CDN https URLs survive; anything else becomes null (render the initial).
create or replace function public.safe_avatar_url(p_url text)
returns text
language sql
immutable
as $$
  select case
    when p_url is not null
     and p_url ~ '^https://cdn\.discordapp\.com/[^[:space:]]+$'
     and char_length(p_url) <= 256
    then p_url
    else null
  end;
$$;

-- Exact YouTube video id, or null. Anything else is a client bug or an attempt
-- to smuggle a non-id string through presence.
create or replace function public.is_youtube_video_id(p_id text)
returns boolean
language sql
immutable
as $$
  select p_id is not null and p_id ~ '^[A-Za-z0-9_-]{11}$';
$$;

-- ---------------------------------------------------------------------------
-- heartbeat_media_presence: heartbeat_presence + a validated video id.
-- ---------------------------------------------------------------------------

create or replace function public.heartbeat_media_presence(
  p_status text,
  p_video_title text default null,
  p_video_id text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
begin
  if p_status not in ('offline', 'online', 'watching', 'in_party') then
    raise exception 'forbidden';
  end if;

  -- Strict: a non-null id that is not exactly a YouTube id is rejected rather
  -- than silently coerced, so a malformed id can never reach a friend.
  if p_video_id is not null and not public.is_youtube_video_id(p_video_id) then
    raise exception 'forbidden';
  end if;

  insert into presence_preferences (user_id, status, video_title, video_id, updated_at)
  values (me, p_status, left(p_video_title, 120), p_video_id, now())
  on conflict (user_id) do update
    set status = excluded.status,
        video_title = excluded.video_title,
        video_id = excluded.video_id,
        updated_at = now();

  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- get_friend_presence_v2: get_friend_presence + safe avatar, validated border,
-- and the video id (activity-gated). Same friendship/block/consent filtering
-- and the same (client-derived) staleness model as v1 — no row is withheld by
-- age here, exactly as get_friend_presence behaves.
-- ---------------------------------------------------------------------------

create or replace function public.get_friend_presence_v2()
returns table (
  user_id uuid,
  display_name text,
  avatar_url text,
  selected_border_id text,
  status text,
  video_title text,
  video_id text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  me uuid := public.require_auth();
begin
  return query
  select
    pp.user_id,
    coalesce(nullif(ps.display_name, ''), 'Someone'),
    public.safe_avatar_url(ps.avatar_url),
    public.validated_border(pp.user_id),
    pp.status,
    case when pp.share_activity then pp.video_title else null end,
    case when pp.share_activity then pp.video_id else null end,
    pp.updated_at
  from presence_preferences pp
  join friendships f
    on f.user_low = least(me, pp.user_id)
   and f.user_high = greatest(me, pp.user_id)
  left join player_stats ps on ps.user_id = pp.user_id
  where pp.user_id <> me
    and pp.share_online = true
    and not public.is_blocked(me, pp.user_id);
end;
$$;

grant execute on function public.safe_avatar_url(text) to authenticated;
grant execute on function public.is_youtube_video_id(text) to authenticated;
grant execute on function public.heartbeat_media_presence(text, text, text) to authenticated;
grant execute on function public.get_friend_presence_v2() to authenticated;

-- Rollback (manual):
--   drop function if exists public.get_friend_presence_v2();
--   drop function if exists public.heartbeat_media_presence(text, text, text);
--   drop function if exists public.is_youtube_video_id(text);
--   drop function if exists public.safe_avatar_url(text);
--   alter table public.presence_preferences drop column if exists video_id;
