-- Phase 31 acceptance tests: internal helper lockdown (0025).
--
-- HOW TO RUN. Paste the whole file into the Supabase SQL Editor and run it (or
-- run it against a disposable database). It creates throwaway users, asserts,
-- and ROLLS BACK — nothing is persisted. Any failed assertion aborts with a
-- message naming the case.
--
-- Covers: internal predicates are not client-callable in either role, the
-- policy-bound membership helpers still work for authenticated (their RLS
-- policies depend on them), and the social RPC surface still functions after
-- the revokes (the definer path is unaffected).

begin;

create or replace function pg_temp.act_as(p_user uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.act_as_anon()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
end;
$$;

create or replace function pg_temp.act_as_admin()
returns void
language plpgsql
as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.check(p_condition boolean, p_case text)
returns void
language plpgsql
as $$
begin
  if not p_condition then
    raise exception 'FAILED: %', p_case;
  end if;
end;
$$;

create or replace function pg_temp.expect_denied(p_sql text, p_case text)
returns void
language plpgsql
as $$
begin
  begin
    execute p_sql;
  exception
    when insufficient_privilege then
      return;
    when others then
      raise exception 'FAILED: % (expected permission denied, got "%")', p_case, sqlerrm;
  end;
  raise exception 'FAILED (expected permission denied): %', p_case;
end;
$$;

do $$
declare
  v_alice uuid := gen_random_uuid();
  v_bob uuid := gen_random_uuid();
  v_graph_rows integer;
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (v_alice, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'alice-p31g@test.local'),
    (v_bob,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bob-p31g@test.local');

  insert into public.user_blocks (blocker_id, blocked_id) values (v_alice, v_bob);
  insert into public.friendships (user_low, user_high)
    values (least(v_alice, v_bob), greatest(v_alice, v_bob));

  -- -------------------------------------------------------------------------
  -- The relationship predicates are not client-callable in either role.
  -- -------------------------------------------------------------------------

  perform pg_temp.act_as(v_alice);
  perform pg_temp.expect_denied(
    format('select public.is_blocked(%L, %L)', v_alice, v_bob),
    'authenticated cannot query block relationships');
  perform pg_temp.expect_denied(
    format('select public.are_friends(%L, %L)', v_alice, v_bob),
    'authenticated cannot query the friendship graph');
  perform pg_temp.expect_denied(
    format('select public.under_limit_friend_requests(%L)', v_bob),
    'authenticated cannot query another user''s rate state');
  perform pg_temp.expect_denied(
    format('select public.display_name_of(%L)', v_bob),
    'authenticated cannot resolve arbitrary user ids to names');
  perform pg_temp.expect_denied(
    format('select public.can_access_room(%L, ''ABC234'')', v_bob),
    'authenticated cannot probe room access');
  perform pg_temp.expect_denied(
    'select public.require_auth()',
    'require_auth is internal');

  perform pg_temp.act_as_anon();
  perform pg_temp.expect_denied(
    format('select public.is_blocked(%L, %L)', v_alice, v_bob),
    'anon cannot query block relationships');
  perform pg_temp.expect_denied(
    format('select public.are_friends(%L, %L)', v_alice, v_bob),
    'anon cannot query the friendship graph');
  perform pg_temp.expect_denied(
    format('select public.validated_border(%L)', v_bob),
    'anon cannot query borders');

  -- -------------------------------------------------------------------------
  -- Policy-bound helpers keep working for authenticated: the conversations
  -- and club SELECT policies call them as the querying role.
  -- -------------------------------------------------------------------------

  perform pg_temp.act_as(v_alice);
  perform pg_temp.check(
    public.is_active_member(gen_random_uuid(), v_alice) = false,
    'is_active_member remains callable (RLS policies depend on it)');
  perform pg_temp.check(
    public.is_club_member(gen_random_uuid(), v_alice) = false,
    'is_club_member remains callable (RLS policies depend on it)');
  perform pg_temp.check(
    public.is_club_staff(gen_random_uuid(), v_alice) = false,
    'is_club_staff remains callable (RLS policies depend on it)');

  -- Policies actually evaluate: selecting policy-guarded tables still works.
  perform count(*) from public.conversations;
  perform count(*) from public.creator_clubs;

  -- -------------------------------------------------------------------------
  -- The definer RPC surface is unaffected by the revokes.
  -- -------------------------------------------------------------------------

  select count(*) into v_graph_rows from public.get_social_graph();
  perform pg_temp.check(v_graph_rows >= 0, 'get_social_graph still executes');
  perform pg_temp.check(
    public.heartbeat_presence('online', null) = 'ok',
    'heartbeat_presence still executes (calls require_auth internally)');

  perform pg_temp.act_as_admin();
  raise notice 'Phase 31 helper-grant tests: ALL CHECKS PASSED';
end;
$$;

rollback;
