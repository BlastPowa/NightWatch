-- Phase 14: persistent community rooms (ADR-012).
-- Apply via Supabase Dashboard → SQL Editor → paste & run.

create table public.rooms (
  code text primary key,
  name text not null,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  scheduled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint rooms_code_format check (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$'),
  constraint rooms_name_length check (char_length(name) between 1 and 50)
);

alter table public.rooms enable row level security;

-- Owners manage only their own rooms. No public SELECT: rooms cannot be
-- enumerated; join-by-code goes through get_room_by_code below.
create policy "rooms_select_own" on public.rooms
  for select using (auth.uid() = owner_id);
create policy "rooms_insert_own" on public.rooms
  for insert with check (auth.uid() = owner_id);
create policy "rooms_update_own" on public.rooms
  for update using (auth.uid() = owner_id);
create policy "rooms_delete_own" on public.rooms
  for delete using (auth.uid() = owner_id);

-- Cap: 10 persistent rooms per owner.
create or replace function public.enforce_room_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.rooms where owner_id = new.owner_id) >= 10 then
    raise exception 'room limit reached (10 per user)';
  end if;
  return new;
end;
$$;

create trigger rooms_cap
  before insert on public.rooms
  for each row execute function public.enforce_room_cap();

-- Knowing a code reveals exactly one room's name/schedule, nothing else.
create or replace function public.get_room_by_code(room_code text)
returns table (name text, scheduled_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select name, scheduled_at from public.rooms where code = upper(room_code);
$$;

grant execute on function public.get_room_by_code(text) to anon, authenticated;
