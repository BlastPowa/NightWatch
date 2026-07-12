-- Phase 19: scheduled watch parties (RSVP) + the co-watcher "friend" graph.
-- Apply via Supabase Dashboard → SQL Editor → paste & run.
--
-- PRIVACY NOTE. 0003 deliberately kept session analytics anonymous ("numeric
-- values, never identities"). room_participants below is the first table that
-- records WHO watched WITH WHOM, and it exists only to make the friend
-- leaderboard promised in Phase 18 real. It is therefore written only for
-- signed-in users who have opted into sharing (player_stats.share_stats), it
-- is never readable across users directly (RLS allows reading only your own
-- rows), and the friend graph is reachable only through the security-definer
-- function at the bottom, which still honours share_stats. Guests and
-- opted-out users leave no trace here. Ephemeral rooms leave no trace either:
-- the FK to rooms means only persistent rooms can record participation.

create table public.room_invites (
  room_code text not null references public.rooms (code) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  rsvp text not null default 'going' check (rsvp in ('going', 'maybe', 'declined')),
  created_at timestamptz not null default now(),
  primary key (room_code, user_id)
);

create table public.room_participants (
  room_code text not null references public.rooms (code) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  primary key (room_code, user_id)
);

create index room_participants_user_idx on public.room_participants (user_id);

alter table public.room_invites enable row level security;
alter table public.room_participants enable row level security;

-- You manage exactly your own RSVP.
create policy invites_own_select on public.room_invites
  for select using (auth.uid() = user_id);
create policy invites_own_insert on public.room_invites
  for insert with check (auth.uid() = user_id);
create policy invites_own_update on public.room_invites
  for update using (auth.uid() = user_id);
create policy invites_own_delete on public.room_invites
  for delete using (auth.uid() = user_id);

-- A room owner may see the RSVPs for rooms they own.
create policy invites_owner_select on public.room_invites
  for select using (
    exists (
      select 1 from public.rooms r
      where r.code = room_invites.room_code and r.owner_id = auth.uid()
    )
  );

-- Participation is write-your-own, read-your-own. The friend graph is only
-- ever exposed through get_friend_leaderboard, never by direct select.
create policy participants_own_select on public.room_participants
  for select using (auth.uid() = user_id);
create policy participants_own_insert on public.room_participants
  for insert with check (auth.uid() = user_id);
create policy participants_own_update on public.room_participants
  for update using (auth.uid() = user_id);

-- Rooms you own or RSVP'd to, in the next week. Needed because `rooms` has no
-- public SELECT policy (ADR-012: rooms cannot be enumerated), so an invited
-- non-owner otherwise cannot see the name or schedule of a room they are going
-- to. Scoped strictly to rooms the caller already has a relationship with.
create or replace function public.get_upcoming_rooms()
returns table (
  code text,
  name text,
  scheduled_at timestamptz,
  rsvp text,
  is_owner boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    r.code,
    r.name,
    r.scheduled_at,
    coalesce(i.rsvp, '') as rsvp,
    (r.owner_id = auth.uid()) as is_owner
  from rooms r
  left join room_invites i
    on i.room_code = r.code and i.user_id = auth.uid()
  where auth.uid() is not null
    and r.scheduled_at is not null
    -- A party that just started is still "upcoming" enough to show/join.
    and r.scheduled_at > now() - interval '2 hours'
    and r.scheduled_at < now() + interval '7 days'
    and (r.owner_id = auth.uid() or i.user_id = auth.uid())
  order by r.scheduled_at asc
  limit 20;
$$;

grant execute on function public.get_upcoming_rooms() to authenticated;

-- Owner-only guest list. display_name lives in player_stats, so members who
-- never synced show as 'Someone'.
create or replace function public.get_room_rsvps(p_room_code text)
returns table (display_name text, rsvp text)
language sql
security definer
set search_path = public
stable
as $$
  select
    coalesce(nullif(ps.display_name, ''), 'Someone') as display_name,
    i.rsvp
  from room_invites i
  left join player_stats ps on ps.user_id = i.user_id
  where i.room_code = upper(p_room_code)
    and exists (
      select 1 from rooms r
      where r.code = upper(p_room_code) and r.owner_id = auth.uid()
    )
  order by i.created_at asc
  limit 50;
$$;

grant execute on function public.get_room_rsvps(text) to authenticated;

-- The friend leaderboard Phase 18's UI already promised. "Friends" = people
-- you have actually shared a persistent room with. Still gated on share_stats,
-- so opting out removes you from everyone's board, and the metric stays on a
-- fixed allowlist (no injection through format()).
create or replace function public.get_friend_leaderboard(metric text)
returns table (display_name text, value bigint, is_self boolean)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'auth required';
  end if;
  if metric not in ('watch_seconds', 'rooms_joined', 'reactions_sent', 'streak_days') then
    raise exception 'invalid metric';
  end if;
  return query execute format(
    'select
       coalesce(nullif(ps.display_name, ''''), ''Someone'') as display_name,
       ps.%I::bigint as value,
       (ps.user_id = $1) as is_self
     from player_stats ps
     where ps.share_stats = true
       and ps.%I > 0
       and (
         ps.user_id = $1
         or ps.user_id in (
           select theirs.user_id
           from room_participants mine
           join room_participants theirs on theirs.room_code = mine.room_code
           where mine.user_id = $1 and theirs.user_id <> $1
         )
       )
     order by ps.%I desc, ps.updated_at asc
     limit 20',
    metric, metric, metric
  ) using me;
end;
$$;

grant execute on function public.get_friend_leaderboard(text) to authenticated;
