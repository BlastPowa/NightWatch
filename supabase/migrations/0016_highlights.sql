-- Phase 21: highlight reels.
-- Apply AFTER 0015_club_discovery.sql. Rollback notes at the bottom.
--
-- Scoped in Phase 16 (ADR-014) and never built. A highlight reel is the moment
-- the room reacted hardest — derived from the reaction density we already
-- record, clustered into peaks.
--
-- COMPLIANCE (CLAUDE.md, ARCHITECTURE.md §7): a "reel" here is a list of
-- TIMESTAMPS, not video. Nothing downloads, re-hosts, proxies, clips, or
-- re-encodes a single frame. Playback of a highlight is the official IFrame
-- player seeking to a position in the original video, and an exported reel is a
-- set of youtube.com links with a ?t= offset. There is deliberately no column,
-- RPC, or export path in this migration that could carry media, because the
-- feature name invites exactly that mistake.
--
-- Prerequisite fixed here: session_events records a reaction's POSITION but not
-- which VIDEO it was in, so a session spanning two videos produced highlights
-- that could not be attributed to either. Without this column the feature is
-- silently wrong rather than absent, which is worse.

alter table public.session_events
  add column if not exists video_id text
  check (video_id is null or video_id ~ '^[A-Za-z0-9_-]{11}$');

-- Reaction peaks are found per (video, time bucket), so index that way.
create index if not exists session_events_reactions
  on public.session_events (session_id, video_id, value)
  where kind = 'reaction';

-- ---------------------------------------------------------------------------
-- The reel.
--
-- Reactions are bucketed into fixed windows and the busiest windows win. A
-- bucket is coarse on purpose: people react a beat AFTER the thing that made
-- them react, and a tight window splits one moment into two half-strength ones.
-- The clip start is pulled back by a lead-in so the export lands before the
-- payoff rather than on top of it.
-- ---------------------------------------------------------------------------

create or replace function public.get_session_highlights(
  p_session uuid,
  p_limit integer default 10
)
returns table (
  video_id text,
  position_seconds double precision,
  reaction_count bigint
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  me uuid := public.require_auth();
  bucket_seconds constant double precision := 15;
  lead_in_seconds constant double precision := 5;
begin
  -- Insights are the room owner's, and only theirs (ADR-014). security definer
  -- bypasses the RLS that would otherwise enforce this, so it is enforced here.
  if not exists (
    select 1
    from room_sessions s
    join rooms r on r.code = s.room_code
    where s.id = p_session and r.owner_id = me
  ) then
    raise exception 'forbidden';
  end if;

  return query
  select
    e.video_id,
    -- Clip start: the bucket's opening edge, pulled back by the lead-in and
    -- never below zero.
    greatest(floor(e.value / bucket_seconds) * bucket_seconds - lead_in_seconds, 0),
    count(*)
  from session_events e
  where e.session_id = p_session
    and e.kind = 'reaction'
    -- Events logged before 0016 have no video_id and cannot be attributed to a
    -- video. They are dropped rather than guessed at.
    and e.video_id is not null
  group by e.video_id, floor(e.value / bucket_seconds)
  having count(*) > 1  -- One person reacting once is not a highlight.
  order by count(*) desc, 2 asc
  limit least(greatest(coalesce(p_limit, 10), 1), 25);
end;
$$;

grant execute on function public.get_session_highlights(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- ROLLBACK (run before 0015's rollback)
-- ---------------------------------------------------------------------------
--   drop function if exists public.get_session_highlights(uuid, integer);
--   drop index if exists public.session_events_reactions;
--   alter table public.session_events drop column if exists video_id;
