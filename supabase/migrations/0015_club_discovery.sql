-- Phase 21: club discovery.
-- Apply AFTER 0014_system_messages.sql. Rollback notes at the bottom.
--
-- 20C shipped clubs you could create, join by id, and list your own — but no
-- directory, deliberately: a public directory is a moderation surface, and
-- shipping the list without the controls is how you get a spam farm.
--
-- The controls, therefore, come with the list:
--
--   * Clubs are PRIVATE by default. A club only becomes discoverable when its
--     owner opts in. An existing club does not silently become public.
--   * A suspended club vanishes from the directory AND stops accepting joins.
--     Suspension is a moderator action, is audited, and is reversible.
--   * The directory never reveals a private club, a suspended club, or a club
--     owned by someone you have blocked.

-- ---------------------------------------------------------------------------
-- Schema.
-- ---------------------------------------------------------------------------

alter table public.creator_clubs
  add column if not exists visibility text not null default 'private'
    check (visibility in ('private', 'public'));

-- Nullable timestamp rather than a boolean: "when was this suspended, and is it
-- still" in one column, and it reads correctly in the audit trail.
alter table public.creator_clubs
  add column if not exists suspended_at timestamptz;

-- The directory's read path: public, not suspended, ordered by size. A partial
-- index because that is the only slice anyone ever lists.
create index if not exists creator_clubs_directory
  on public.creator_clubs (created_at desc)
  where visibility = 'public' and suspended_at is null;

-- Name search. Trigram would be better for fuzzy matching, but pg_trgm is an
-- extension and this stays within the box: prefix/substring on a lowercased
-- name is enough for a directory of this size, and it degrades honestly.
create index if not exists creator_clubs_name_lower
  on public.creator_clubs (lower(name));

-- ---------------------------------------------------------------------------
-- Directory.
-- ---------------------------------------------------------------------------

create or replace function public.search_clubs(
  p_query text default '',
  p_limit integer default 30
)
returns table (
  id uuid,
  name text,
  description text,
  owner_id uuid,
  member_count bigint,
  is_member boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
#variable_conflict use_column
declare
  me uuid := public.require_auth();
  needle text := lower(trim(coalesce(p_query, '')));
begin
  return query
  select
    c.id,
    c.name,
    c.description,
    c.owner_id,
    (
      select count(*) from creator_club_members m
      where m.club_id = c.id and m.left_at is null
    ),
    public.is_club_member(c.id, me)
  from creator_clubs c
  where c.visibility = 'public'
    and c.suspended_at is null
    -- A block cuts discovery in both directions: you do not surface in each
    -- other's world, and that includes each other's clubs.
    and not public.is_blocked(me, c.owner_id)
    and (needle = '' or lower(c.name) like '%' || needle || '%')
  order by
    (select count(*) from creator_club_members m
     where m.club_id = c.id and m.left_at is null) desc,
    c.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 50);
end;
$$;

create or replace function public.set_club_visibility(p_club uuid, p_visibility text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
begin
  -- Owner only. Listing the club in a public directory is not a moderator's
  -- call to make on the owner's behalf.
  if not exists (
    select 1 from creator_clubs where id = p_club and owner_id = me
  ) then
    raise exception 'forbidden';
  end if;
  if p_visibility not in ('private', 'public') then
    raise exception 'forbidden';
  end if;

  update creator_clubs set visibility = p_visibility where id = p_club;

  perform public.audit(p_club, me, 'club.visibility', 'club', p_club::text, p_visibility);
  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- Suspension. The moderation half of the directory.
--
-- Deliberately NOT self-service: a club owner cannot suspend their own club to
-- duck a report and then quietly unsuspend it. Suspension is for staff of the
-- club (owner/moderator) acting on their own house — a platform-wide admin role
-- does not exist yet, and inventing one here would be scope creep. What this
-- gives you today is the ability to pull a club out of the directory
-- immediately, with an audit record, and to put it back.
-- ---------------------------------------------------------------------------

create or replace function public.set_club_suspended(p_club uuid, p_suspended boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
begin
  if not public.is_club_staff(p_club, me) then
    raise exception 'forbidden';
  end if;

  update creator_clubs
  set suspended_at = case when p_suspended then now() else null end
  where id = p_club;

  perform public.audit(
    p_club, me, 'club.suspend', 'club', p_club::text,
    case when p_suspended then 'suspended' else 'reinstated' end
  );
  return 'ok';  -- Idempotent.
end;
$$;

-- ---------------------------------------------------------------------------
-- Joining. join_club (0012) predates the directory and would happily let anyone
-- with a club id join a suspended club, so it is replaced here rather than left
-- to drift.
-- ---------------------------------------------------------------------------

create or replace function public.join_club(p_club uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
  owner uuid;
  suspended timestamptz;
begin
  select owner_id, suspended_at into owner, suspended
  from creator_clubs where id = p_club;
  if not found then
    raise exception 'forbidden';
  end if;
  -- A suspended club is closed. Holding an old invite link is not a bypass.
  if suspended is not null then
    raise exception 'forbidden';
  end if;
  if public.is_blocked(me, owner) then
    raise exception 'blocked';
  end if;

  insert into creator_club_members (club_id, user_id)
  values (p_club, me)
  on conflict (club_id, user_id) do update
    set left_at = null, joined_at = now();

  perform public.audit(p_club, me, 'club.join', 'user', me::text);
  return 'ok';
end;
$$;

grant execute on function public.search_clubs(text, integer) to authenticated;
grant execute on function public.set_club_visibility(uuid, text) to authenticated;
grant execute on function public.set_club_suspended(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- ROLLBACK (run before 0014's rollback)
-- ---------------------------------------------------------------------------
--   drop function if exists public.set_club_suspended(uuid, boolean);
--   drop function if exists public.set_club_visibility(uuid, text);
--   drop function if exists public.search_clubs(text, integer);
--   drop index if exists public.creator_clubs_name_lower;
--   drop index if exists public.creator_clubs_directory;
--   alter table public.creator_clubs drop column if exists suspended_at;
--   alter table public.creator_clubs drop column if exists visibility;
--   -- NOTE: join_club reverts to its 0012 definition — re-run that block.
