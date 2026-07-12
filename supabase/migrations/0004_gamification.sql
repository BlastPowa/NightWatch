-- Phase 18: cross-device stats/achievements, leaderboards, streaks,
-- room milestones (§14.4). Apply via SQL Editor.

create table public.player_stats (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  share_stats boolean not null default true,
  rooms_joined integer not null default 0 check (rooms_joined >= 0),
  watch_seconds bigint not null default 0 check (watch_seconds >= 0),
  reactions_sent integer not null default 0 check (reactions_sent >= 0),
  chats_sent integer not null default 0 check (chats_sent >= 0),
  videos_loaded integer not null default 0 check (videos_loaded >= 0),
  streak_days integer not null default 0 check (streak_days >= 0),
  last_watch_day date,
  updated_at timestamptz not null default now()ive ran 
);

create table public.player_achievements (
  user_id uuid not null references auth.users (id) on delete cascade,
  achievement_id text not null check (char_length(achievement_id) <= 40),
  unlocked_at timestamptz not null default now(),
  primary key (user_id, achievement_id)
);

alter table public.player_stats enable row level security;
alter table public.player_achievements enable row level security;

-- Each user manages exactly their own rows.
create policy stats_own_select on public.player_stats
  for select using (auth.uid() = user_id);
create policy stats_own_insert on public.player_stats
  for insert with check (auth.uid() = user_id);
create policy stats_own_update on public.player_stats
  for update using (auth.uid() = user_id);

create policy ach_own_select on public.player_achievements
  for select using (auth.uid() = user_id);
create policy ach_own_insert on public.player_achievements
  for insert with check (auth.uid() = user_id);

-- Leaderboard: opt-in rows only (share_stats), bounded metrics allowlist.
create or replace function public.get_leaderboard(metric text)
returns table (display_name text, value bigint)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if metric not in ('watch_seconds', 'rooms_joined', 'reactions_sent', 'streak_days') then
    raise exception 'invalid metric';
  end if;
  return query execute format(
    'select display_name, %I::bigint as value
     from player_stats
     where share_stats = true and %I > 0
     order by %I desc, updated_at asc
     limit 20',
    metric, metric, metric
  );
end;
$$;

grant execute on function public.get_leaderboard(text) to anon, authenticated;

-- Room milestones: aggregate what already exists (history + sessions).
create or replace function public.get_room_stats(p_room_code text)
returns table (videos_played bigint, sessions_count bigint, total_minutes bigint)
language sql
security definer
set search_path = public
stable
as $$
  select
    (select count(*) from room_history where room_code = upper(p_room_code)),
    (select count(*) from room_sessions where room_code = upper(p_room_code)),
    (select coalesce(sum(
        extract(epoch from (coalesce(ended_at, started_at + interval '1 minute') - started_at))
      )::bigint / 60, 0)
     from room_sessions where room_code = upper(p_room_code));
$$;

grant execute on function public.get_room_stats(text) to anon, authenticated;
