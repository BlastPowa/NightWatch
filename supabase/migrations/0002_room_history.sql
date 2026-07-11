-- Phase 16: room watch history (Discovery Hub "Previously watched").
-- Apply via Supabase Dashboard → SQL Editor → paste & run.

create table public.room_history (
  id uuid primary key default gen_random_uuid(),
  room_code text not null references public.rooms (code) on delete cascade,
  video_id text not null,
  title text not null,
  watched_at timestamptz not null default now(),
  constraint room_history_video_format check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  constraint room_history_title_length check (char_length(title) between 1 and 120)
);

create index room_history_room_idx on public.room_history (room_code, watched_at desc);

-- RLS on with NO direct policies: the table is only reachable through the
-- two security-definer functions below (write is capped, read is bounded),
-- so knowing a code lets you log/read that room's history and nothing else.
alter table public.room_history enable row level security;

-- Record a watch. Dedupes consecutive repeats and keeps only the newest
-- 50 entries per room.
create or replace function public.add_room_history(
  p_room_code text,
  p_video_id text,
  p_title text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(p_room_code);
  v_last text;
begin
  if not exists (select 1 from rooms where code = v_code) then
    return; -- ephemeral room: history is persistent-room-only
  end if;

  select video_id into v_last
  from room_history
  where room_code = v_code
  order by watched_at desc
  limit 1;

  if v_last = p_video_id then
    return; -- consecutive duplicate (drift reloads etc.)
  end if;

  insert into room_history (room_code, video_id, title)
  values (v_code, p_video_id, left(coalesce(nullif(trim(p_title), ''), 'Untitled'), 120));

  delete from room_history
  where room_code = v_code
    and id not in (
      select id from room_history
      where room_code = v_code
      order by watched_at desc
      limit 50
    );
end;
$$;

-- Read the newest entries for a room.
create or replace function public.get_room_history(p_room_code text)
returns table (video_id text, title text, watched_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select video_id, title, watched_at
  from room_history
  where room_code = upper(p_room_code)
  order by watched_at desc
  limit 25;
$$;

grant execute on function public.add_room_history(text, text, text) to anon, authenticated;
grant execute on function public.get_room_history(text) to anon, authenticated;
