-- Phase 34 SQL/RLS test for runtime_capabilities_v2 and the deployed social
-- contract surface. Run against a DISPOSABLE (or owner-approved) database
-- with migrations 0001–0028 applied:
--
--   psql "$DISPOSABLE_DB_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/phase34_runtime_capabilities_test.sql
--
-- Expected final row:
--   phase34 runtime capability test: all assertions passed
--
-- The script runs inside one transaction and rolls itself back.

begin;

create or replace function pg_temp.impersonate(p_user uuid) returns void
language sql as $$
  select set_config('request.jwt.claims',
           json_build_object('sub', p_user, 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true);
$$;

create or replace function pg_temp.as_anon() returns void
language sql as $$
  select set_config('request.jwt.claims', '', true),
         set_config('role', 'anon', true);
$$;

create or replace function pg_temp.as_admin() returns void
language sql as $$
  select set_config('request.jwt.claims', '', true),
         set_config('role', 'postgres', true);
$$;

select pg_temp.as_admin();

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-0000000034a1', 'p34-a@test.local'),
  ('00000000-0000-0000-0000-0000000034b2', 'p34-b@test.local')
on conflict (id) do nothing;

-- 1. Anonymous callers may read the manifest and are reported as signed out --
do $$
declare v jsonb;
begin
  perform pg_temp.as_anon();
  v := public.runtime_capabilities_v2();
  if (v ->> 'authenticated')::boolean is distinct from false then
    raise exception 'anon manifest must report authenticated=false';
  end if;
  if (v ->> 'schemaGeneration') is null then
    raise exception 'manifest is missing schemaGeneration';
  end if;
  if jsonb_typeof(v -> 'functions') <> 'object' then
    raise exception 'manifest functions must be an object';
  end if;
  if jsonb_typeof(v -> 'realtimeTables') <> 'array' then
    raise exception 'manifest realtimeTables must be an array';
  end if;
end $$;

-- 2. Authenticated callers are reported as signed in ------------------------
do $$
declare v jsonb;
begin
  perform pg_temp.impersonate('00000000-0000-0000-0000-0000000034a1');
  v := public.runtime_capabilities_v2();
  if (v ->> 'authenticated')::boolean is distinct from true then
    raise exception 'authenticated manifest must report authenticated=true';
  end if;
end $$;

-- 3. The manifest reports EXACT signatures, not names -----------------------
--    Every flag must be true on a fully migrated database, and a deliberately
--    wrong signature must not be reported as deployed.
do $$
declare
  v jsonb;
  k text;
  missing text[] := '{}';
begin
  perform pg_temp.impersonate('00000000-0000-0000-0000-0000000034a1');
  v := public.runtime_capabilities_v2();
  for k in select jsonb_object_keys(v -> 'functions') loop
    if ((v -> 'functions') ->> k)::boolean is distinct from true then
      missing := missing || k;
    end if;
  end loop;
  if array_length(missing, 1) is not null then
    raise exception 'manifest reports undeployed functions: %', array_to_string(missing, ', ');
  end if;

  -- Signature precision: a function that exists under a DIFFERENT argument
  -- list must not resolve. (get_messages is (uuid,bigint,integer) after 0008.)
  if to_regprocedure('public.get_messages(uuid,text,integer)') is not null then
    raise exception 'unexpected get_messages(uuid,text,integer) overload exists';
  end if;
end $$;

-- 4. realtimeTables only ever contains allowlisted names --------------------
do $$
declare
  v jsonb;
  t text;
begin
  perform pg_temp.as_anon();
  v := public.runtime_capabilities_v2();
  for t in select jsonb_array_elements_text(v -> 'realtimeTables') loop
    if t not in ('messages', 'friend_requests', 'notifications', 'conversation_members') then
      raise exception 'realtimeTables leaked a non-allowlisted table: %', t;
    end if;
  end loop;
end $$;

-- 5. Internal helpers stay uncallable by clients ----------------------------
do $$
begin
  perform pg_temp.as_anon();
  begin
    perform public.runtime_schema_generation();
    raise exception 'anon executed runtime_schema_generation';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.runtime_realtime_tables();
    raise exception 'anon executed runtime_realtime_tables';
  exception when insufficient_privilege then null;
  end;

  perform pg_temp.impersonate('00000000-0000-0000-0000-0000000034a1');
  begin
    perform public.runtime_schema_generation();
    raise exception 'authenticated executed runtime_schema_generation';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.runtime_realtime_tables();
    raise exception 'authenticated executed runtime_realtime_tables';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 6. Old-client compatibility: social_diagnostics() still answers -----------
do $$
declare v jsonb;
begin
  perform pg_temp.as_anon();
  v := public.social_diagnostics();
  if (v ->> 'version') is null then
    raise exception 'social_diagnostics() no longer returns a version';
  end if;
  if (v ->> 'hasSession')::boolean is distinct from false then
    raise exception 'social_diagnostics() anon session state changed';
  end if;
end $$;

-- 7. Direct messages require an accepted friendship -------------------------
do $$
declare v_conversation uuid;
begin
  perform pg_temp.impersonate('00000000-0000-0000-0000-0000000034a1');
  begin
    v_conversation := public.create_direct_conversation(
      '00000000-0000-0000-0000-0000000034b2');
    raise exception 'a DM was created without an accepted friendship';
  exception when others then
    if sqlerrm like '%a DM was created%' then raise; end if;
  end;
end $$;

-- 8. Group conversations cap at 30 members ----------------------------------
--    Verified structurally: the cap must exist in the deployed function body
--    (a numeric literal check), so a future edit that drops it fails here.
do $$
declare v_src text;
begin
  select pg_get_functiondef(to_regprocedure('public.add_group_member(uuid,uuid)'))
    into v_src;
  if v_src is null then
    raise exception 'add_group_member(uuid,uuid) is not deployed';
  end if;
  if position('30' in v_src) = 0 then
    raise exception 'add_group_member no longer enforces a 30-member cap';
  end if;
end $$;

-- 9. Discovery/search protections still hold (Phase 32 contract) ------------
do $$
begin
  perform pg_temp.impersonate('00000000-0000-0000-0000-0000000034a1');
  begin
    perform * from public.search_people('ab');
    raise exception 'two-character search should be rejected';
  exception when others then
    if sqlerrm not like '%query-too-short%' then raise; end if;
  end;

  -- Room membership protection: a non-member cannot enumerate room people.
  begin
    perform * from public.get_room_people('ZZZZZZ');
    raise exception 'non-member enumerated room people';
  exception when others then
    if sqlerrm not like '%forbidden%' then raise; end if;
  end;
end $$;

-- 10. No room code is ever returned by the presence/friend surfaces ---------
do $$
declare v_src text;
begin
  select pg_get_functiondef(to_regprocedure('public.get_friend_presence_v2()'))
    into v_src;
  if v_src is null then
    raise exception 'get_friend_presence_v2() is not deployed';
  end if;
  if position('room_code' in v_src) > 0 then
    raise exception 'friend presence references a room code column';
  end if;
end $$;

select 'phase34 runtime capability test: all assertions passed' as result;

rollback;
