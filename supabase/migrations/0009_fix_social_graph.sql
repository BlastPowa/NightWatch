-- Phase 20B fix: resolve the variable/column ambiguity in get_social_graph.
-- Apply AFTER 0008_message_ordering.sql. Rollback notes at the bottom.
--
-- WHY. In a plpgsql RETURNS TABLE function the OUT column names (kind, user_id,
-- display_name, request_id, created_at) are also VARIABLES in scope. The
-- friends branch selected a bare `created_at` from friendships, which matches
-- both the table column and the OUT variable, so Postgres raised 42702 rather
-- than pick one. The other RETURNS TABLE functions avoided this only by
-- accident — they happen to alias-qualify every column.
--
-- Two belts here, deliberately:
--   1. `#variable_conflict use_column` makes a bare name resolve to the COLUMN,
--      which is what every query in this function actually wants.
--   2. Every column is alias-qualified anyway, so the function does not depend
--      on that pragma to be correct.

create or replace function public.get_social_graph()
returns table (
  kind text,
  user_id uuid,
  display_name text,
  request_id uuid,
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
  -- Accepted friends.
  select
    'friend'::text,
    f.other,
    coalesce(nullif(ps.display_name, ''), 'Someone'),
    null::uuid,
    f.since
  from (
    select
      case when fr.user_low = me then fr.user_high else fr.user_low end as other,
      fr.created_at as since
    from friendships fr
    where me in (fr.user_low, fr.user_high)
  ) f
  left join player_stats ps on ps.user_id = f.other
  where not public.is_blocked(me, f.other)

  union all

  -- Incoming pending requests.
  select
    'incoming'::text,
    r.sender_id,
    coalesce(nullif(ps.display_name, ''), 'Someone'),
    r.id,
    r.created_at
  from friend_requests r
  left join player_stats ps on ps.user_id = r.sender_id
  where r.recipient_id = me
    and r.status = 'pending'
    and not public.is_blocked(me, r.sender_id)

  union all

  -- Outgoing pending requests.
  select
    'outgoing'::text,
    r.recipient_id,
    coalesce(nullif(ps.display_name, ''), 'Someone'),
    r.id,
    r.created_at
  from friend_requests r
  left join player_stats ps on ps.user_id = r.recipient_id
  where r.sender_id = me
    and r.status = 'pending'
    and not public.is_blocked(me, r.recipient_id)

  union all

  -- Phase 19 co-watcher suggestions: people you have shared a persistent room
  -- with, who are not already friends, not already in a live request, and not
  -- blocked. Only surfaces users who opted into sharing.
  select
    'suggestion'::text,
    theirs.user_id,
    coalesce(nullif(ps.display_name, ''), 'Someone'),
    null::uuid,
    max(theirs.last_seen_at)
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
  -- GROUP BY collapses the several rooms you may share with the same person
  -- into one suggestion, carrying the most recent co-watch. (The previous
  -- SELECT DISTINCT here was redundant with this.)
  group by theirs.user_id, ps.display_name;
end;
$$;

grant execute on function public.get_social_graph() to authenticated;

-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
--   Re-run 0007's get_social_graph definition (which is the broken one, so
--   there is no reason to; drop the function instead if reverting the phase).
