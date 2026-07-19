-- Phase 32 corrective migration: PostgreSQL has jsonb_array_length but no
-- jsonb_object_length. Migration 0026's validator caught that undefined
-- function internally and returned false for every otherwise-valid mode.
-- Keep exact-key validation by counting jsonb_object_keys instead.

set lock_timeout = '10s';

create or replace function public.valid_room_media_mode(p_mode jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_descriptor jsonb;
  v_kind text;
  v_size numeric;
  v_mode_key_count integer;
  v_descriptor_key_count integer;
begin
  if jsonb_typeof(p_mode) <> 'object'
     or p_mode ->> 'modeVersion' <> '2'
     or p_mode ->> 'mode' not in ('youtube', 'file-watch', 'live-share') then
    return false;
  end if;

  select count(*) into v_mode_key_count from jsonb_object_keys(p_mode);

  if p_mode ->> 'mode' = 'live-share' then
    return v_mode_key_count = 5
      and coalesce(p_mode ->> 'sessionId', '') ~ '^[0-9a-f]{32}$'
      and char_length(coalesce(p_mode ->> 'sharerId', '')) between 1 and 64
      and char_length(coalesce(p_mode ->> 'sourceLabel', '')) between 1 and 80;
  end if;

  v_descriptor := p_mode -> 'descriptor';
  if jsonb_typeof(v_descriptor) <> 'object'
     or v_descriptor ->> 'schemaVersion' <> '1' then
    return false;
  end if;
  select count(*) into v_descriptor_key_count from jsonb_object_keys(v_descriptor);

  if p_mode ->> 'mode' = 'youtube' then
    return v_mode_key_count = 3
      and v_descriptor_key_count = 3
      and v_descriptor ->> 'kind' = 'youtube'
      and coalesce(v_descriptor ->> 'videoId', '') ~ '^[A-Za-z0-9_-]{11}$';
  end if;

  if v_mode_key_count <> 4
     or p_mode ->> 'readiness' not in ('all-ready', 'majority-ready', 'host-only') then
    return false;
  end if;
  v_kind := v_descriptor ->> 'kind';
  if v_kind not in ('local', 'drive')
     or coalesce(v_descriptor ->> 'fingerprint', '') !~ '^sha256:[0-9a-f]{64}$'
     or char_length(trim(coalesce(v_descriptor ->> 'title', ''))) not between 1 and 300
     or v_descriptor ->> 'mimeType' not in ('video/mp4', 'video/webm')
     or jsonb_typeof(v_descriptor -> 'size') <> 'number' then
    return false;
  end if;
  v_size := (v_descriptor ->> 'size')::numeric;
  if v_size <> trunc(v_size) or v_size <= 0 or v_size > 34359738368 then
    return false;
  end if;
  if v_kind = 'local' then
    return v_descriptor_key_count = 6;
  end if;
  return v_descriptor_key_count = 7
    and coalesce(v_descriptor ->> 'fileId', '') ~ '^[A-Za-z0-9_-]{10,128}$';
exception when others then
  return false;
end;
$$;

revoke execute on function public.valid_room_media_mode(jsonb)
  from public, anon, authenticated;
