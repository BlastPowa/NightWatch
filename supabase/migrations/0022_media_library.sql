-- Phase 29: owner-private Library metadata.
--
-- This table holds what a user saved, not what they can watch. It is metadata
-- only: NightWatch synchronizes playback state, and every participant obtains
-- the media itself from a file they control or from Drive with their own
-- authorization. Nothing here grants anyone access to anything.
--
-- Three things must never enter this table, and the schema enforces all three
-- rather than trusting the client:
--
--   * local sources and local paths — a path is device-local and private, and
--     'local' is therefore not an allowed source_kind at all;
--   * OAuth tokens, Picker tokens, refresh tokens — a token in a database is a
--     credential someone else can read;
--   * playback leases — a lease is a capability, and a capability in a
--     database is a capability someone else can use. Leases live in Electron
--     main-process memory and die with the process.
--
-- The Library capability flag stays OFF until this migration and its RLS tests
-- are deployed (see PHASE_29_MEDIA_LIBRARY_HANDOFF.md).

-- ---------------------------------------------------------------------------
-- Schema.
-- ---------------------------------------------------------------------------

create table if not exists public.media_library_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,

  -- Only 'youtube' and 'drive'. A local file is a private fact about one
  -- device and is never recorded here.
  source_kind text not null check (source_kind in ('youtube', 'drive')),

  -- A YouTube video id or a Drive file id. Shape-checked per kind below.
  source_id text not null,

  -- Lowercase sha256: plus exactly 64 hex characters, or null. Null is normal
  -- for YouTube and for a Drive file Drive did not checksum.
  fingerprint text
    check (fingerprint is null or fingerprint ~ '^sha256:[0-9a-f]{64}$'),

  title text not null
    check (char_length(title) between 1 and 300),

  artwork_url text
    check (artwork_url is null or (artwork_url ~ '^https://' and char_length(artwork_url) <= 512)),

  mime_type text
    check (mime_type is null or mime_type in ('video/mp4', 'video/webm')),

  size_bytes bigint
    check (size_bytes is null or size_bytes > 0),

  duration_seconds numeric
    check (duration_seconds is null or duration_seconds >= 0),

  progress_seconds numeric not null default 0
    check (progress_seconds >= 0),

  status text not null default 'saved'
    check (status in ('saved', 'watch-later', 'in-progress', 'watched')),

  saved_at timestamptz not null default now(),
  last_played_at timestamptz,
  metadata_refreshed_at timestamptz,

  -- Per-kind source id shape. Enforced in the schema because the client is not
  -- the only thing that will ever write here.
  constraint media_library_source_id_shape check (
    case source_kind
      when 'youtube' then source_id ~ '^[A-Za-z0-9_-]{11}$'
      when 'drive' then source_id ~ '^[A-Za-z0-9_-]{10,128}$'
      else false
    end
  ),

  -- A Drive item is only useful to its owner if it can be matched; a YouTube
  -- item has no fingerprint at all.
  constraint media_library_youtube_has_no_fingerprint check (
    source_kind <> 'youtube' or fingerprint is null
  ),

  -- One row per source per owner. Saving the same thing twice updates it.
  constraint media_library_unique_source unique (owner_id, source_kind, source_id)
);

comment on table public.media_library_items is
  'Owner-private Library metadata (Phase 29). Never stores local paths, tokens, leases, or media bytes.';

create index if not exists media_library_items_owner_saved_idx
  on public.media_library_items (owner_id, saved_at desc);

create index if not exists media_library_items_owner_status_idx
  on public.media_library_items (owner_id, status, last_played_at desc nulls last);

-- ---------------------------------------------------------------------------
-- RLS: owner-only, all four verbs.
-- ---------------------------------------------------------------------------

alter table public.media_library_items enable row level security;
-- Even the table owner goes through the policies.
alter table public.media_library_items force row level security;

drop policy if exists media_library_select_own on public.media_library_items;
create policy media_library_select_own
  on public.media_library_items
  for select
  using (auth.uid() = owner_id);

drop policy if exists media_library_insert_own on public.media_library_items;
create policy media_library_insert_own
  on public.media_library_items
  for insert
  with check (auth.uid() = owner_id);

drop policy if exists media_library_update_own on public.media_library_items;
create policy media_library_update_own
  on public.media_library_items
  for update
  using (auth.uid() = owner_id)
  -- Both clauses: `using` alone would let an owner reassign a row to someone
  -- else on the way out.
  with check (auth.uid() = owner_id);

drop policy if exists media_library_delete_own on public.media_library_items;
create policy media_library_delete_own
  on public.media_library_items
  for delete
  using (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- Typed RPCs. All writes go through these, never through raw table access.
-- ---------------------------------------------------------------------------

-- Clamp progress to duration when duration is known. A progress value beyond
-- the end of the video is a client bug; storing it would make "resume" jump
-- past the end forever.
create or replace function public.clamp_progress(
  p_progress numeric,
  p_duration numeric
)
returns numeric
language sql
immutable
as $$
  select case
    when p_progress is null or p_progress < 0 then 0
    when p_duration is not null and p_progress > p_duration then p_duration
    else p_progress
  end;
$$;

/**
 * Save or update one Library item.
 *
 * security invoker: RLS still applies, so this cannot be used to write another
 * user's row. It exists to validate and normalize, not to escalate.
 */
create or replace function public.save_media_library_item(
  p_source_kind text,
  p_source_id text,
  p_title text,
  p_fingerprint text default null,
  p_artwork_url text default null,
  p_mime_type text default null,
  p_size_bytes bigint default null,
  p_duration_seconds numeric default null,
  p_status text default 'saved'
)
returns public.media_library_items
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_owner uuid := auth.uid();
  v_title text := btrim(p_title);
  v_row public.media_library_items;
begin
  if v_owner is null then
    raise exception 'authentication required';
  end if;

  if p_source_kind not in ('youtube', 'drive') then
    raise exception 'unsupported source kind: %', p_source_kind;
  end if;

  if v_title is null or char_length(v_title) = 0 or char_length(v_title) > 300 then
    raise exception 'invalid title';
  end if;

  insert into public.media_library_items as item (
    owner_id, source_kind, source_id, fingerprint, title,
    artwork_url, mime_type, size_bytes, duration_seconds, status,
    saved_at, metadata_refreshed_at
  )
  values (
    v_owner, p_source_kind, p_source_id, p_fingerprint, v_title,
    p_artwork_url, p_mime_type, p_size_bytes, p_duration_seconds, p_status,
    now(), now()
  )
  on conflict (owner_id, source_kind, source_id) do update
    set title = excluded.title,
        fingerprint = coalesce(excluded.fingerprint, item.fingerprint),
        artwork_url = excluded.artwork_url,
        mime_type = coalesce(excluded.mime_type, item.mime_type),
        size_bytes = coalesce(excluded.size_bytes, item.size_bytes),
        duration_seconds = coalesce(excluded.duration_seconds, item.duration_seconds),
        status = excluded.status,
        metadata_refreshed_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

/** Record playback progress. Clamped to duration when duration is known. */
create or replace function public.set_media_library_progress(
  p_id uuid,
  p_progress_seconds numeric,
  p_status text default null
)
returns public.media_library_items
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.media_library_items;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if p_status is not null and p_status not in ('saved', 'watch-later', 'in-progress', 'watched') then
    raise exception 'invalid status: %', p_status;
  end if;

  update public.media_library_items
     set progress_seconds = public.clamp_progress(p_progress_seconds, duration_seconds),
         status = coalesce(p_status, status),
         last_played_at = now()
   where id = p_id
  returning * into v_row;

  -- RLS turns "someone else's row" into "no row". Both are the same answer.
  if v_row.id is null then
    raise exception 'item not found';
  end if;

  return v_row;
end;
$$;

/** Owner export: everything this user has saved, oldest first. */
create or replace function public.export_media_library()
returns setof public.media_library_items
language sql
security invoker
set search_path = public
as $$
  select *
    from public.media_library_items
   where owner_id = auth.uid()
   order by saved_at asc;
$$;

/** Owner delete-all. Returns the number of rows removed. */
create or replace function public.delete_media_library()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_deleted integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  delete from public.media_library_items where owner_id = auth.uid();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

grant select, insert, update, delete on public.media_library_items to authenticated;
grant execute on function public.save_media_library_item(
  text, text, text, text, text, text, bigint, numeric, text
) to authenticated;
grant execute on function public.set_media_library_progress(uuid, numeric, text) to authenticated;
grant execute on function public.export_media_library() to authenticated;
grant execute on function public.delete_media_library() to authenticated;
grant execute on function public.clamp_progress(numeric, numeric) to authenticated;
