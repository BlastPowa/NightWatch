-- Phase 17: opt-in host session analytics + premiere events (ADR-014).
-- Apply via Supabase Dashboard → SQL Editor → paste & run.

-- Room settings: insights are OFF by default and per-room (ADR-014).
alter table public.rooms
  add column insights_enabled boolean not null default false;
alter table public.rooms
  add column premiere_video_id text
  check (premiere_video_id is null or premiere_video_id ~ '^[A-Za-z0-9_-]{11}$');

create table public.room_sessions (
  id uuid primary key default gen_random_uuid(),
  room_code text not null references public.rooms (code) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create index room_sessions_room_idx on public.room_sessions (room_code, started_at desc);

-- Anonymized events only: numeric values, never identities or content.
create table public.session_events (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.room_sessions (id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null check (kind in ('members', 'play', 'pause', 'seek', 'reaction')),
  value double precision not null default 0
);

create index session_events_session_idx on public.session_events (session_id, at);

-- RLS: the room OWNER may read; nobody writes directly (writes go through
-- the log-session Edge Function using the service role).
alter table public.room_sessions enable row level security;
alter table public.session_events enable row level security;

create policy sessions_owner_select on public.room_sessions
  for select using (
    exists (
      select 1 from public.rooms r
      where r.code = room_code and r.owner_id = auth.uid()
    )
  );

create policy events_owner_select on public.session_events
  for select using (
    exists (
      select 1
      from public.room_sessions s
      join public.rooms r on r.code = s.room_code
      where s.id = session_id and r.owner_id = auth.uid()
    )
  );

-- get_room_by_code now also exposes the insights flag (members must be
-- able to see that insights are on — ADR-014 transparency) and the
-- premiere video.
drop function if exists public.get_room_by_code(text);

create or replace function public.get_room_by_code(room_code text)
returns table (
  name text,
  scheduled_at timestamptz,
  insights_enabled boolean,
  premiere_video_id text
)
language sql
security definer
set search_path = public
stable
as $$
  select name, scheduled_at, insights_enabled, premiere_video_id
  from public.rooms
  where code = upper(room_code);
$$;

grant execute on function public.get_room_by_code(text) to anon, authenticated;
