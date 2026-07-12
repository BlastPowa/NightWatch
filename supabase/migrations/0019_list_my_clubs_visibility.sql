-- Phase 21: expose club visibility and suspension to the owner's club list.
-- Apply AFTER 0018_notification_retention.sql. Rollback notes at the bottom.
--
-- 0015 gave clubs a `visibility` and a `suspended_at`, and RPCs to change both,
-- but `list_my_clubs` never returned either. So the owner's "list this club
-- publicly" toggle had no way to render its own current state: the UI would
-- have had to either guess, or call set_club_visibility blind and hope.
--
-- The alternative was to have the client derive visibility by searching the
-- public directory for its own club and inferring listedness from whether it
-- came back. That would be wrong as well as slow: search_clubs also hides
-- suspended clubs and clubs whose owner you have blocked, so "absent from the
-- directory" does not mean "private". Deriving state a filter already destroyed
-- is how a toggle ends up lying to the person holding it.
--
-- The added columns are the LAST two, so an older client that positionally
-- ignores them is unaffected.

drop function if exists public.list_my_clubs();

create or replace function public.list_my_clubs()
returns table (
  id uuid,
  name text,
  description text,
  owner_id uuid,
  role text,
  member_count bigint,
  visibility text,
  suspended boolean
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
    c.id,
    c.name,
    c.description,
    c.owner_id,
    m.role,
    (select count(*) from creator_club_members cm
      where cm.club_id = c.id and cm.left_at is null),
    c.visibility,
    -- Surfaced as a boolean, not a timestamp: the UI asks "is this club
    -- suspended", and when it happened is the audit log's business.
    (c.suspended_at is not null)
  from creator_clubs c
  join creator_club_members m
    on m.club_id = c.id and m.user_id = me and m.left_at is null
  order by c.created_at asc
  limit 50;
end;
$$;

grant execute on function public.list_my_clubs() to authenticated;

-- ---------------------------------------------------------------------------
-- ROLLBACK (run before 0018's rollback)
-- ---------------------------------------------------------------------------
--   Restore the 0012 definition of list_my_clubs (six columns, no visibility).
--   drop function if exists public.list_my_clubs();
--   -- then re-run the list_my_clubs block from 0012_creator_rpcs.sql
