-- Phase 21 acceptance tests: notification dismissal + retention.
--
-- HOW TO RUN. Paste into the Supabase SQL Editor and run. Creates throwaway
-- users, asserts, and ROLLS BACK — safe against the live project.
--
-- Requires 0011–0018.

begin;

create or replace function pg_temp.act_as(p_user uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
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

do $$
declare
  alice uuid := gen_random_uuid();
  bob uuid := gen_random_uuid();
  keep_id uuid;
  drop_id uuid;
  pruned integer;
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (alice, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'r-alice@test.local'),
    (bob,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'r-bob@test.local');

  insert into player_stats (user_id, display_name) values (alice, 'Alice'), (bob, 'Bob');

  -- =========================================================================
  -- Dismissal.
  -- =========================================================================
  insert into notifications (user_id, kind) values (alice, 'bounty.open')
    returning id into drop_id;
  insert into notifications (user_id, kind) values (alice, 'bounty.closed')
    returning id into keep_id;

  perform pg_temp.act_as(alice);
  perform dismiss_notification(drop_id);

  perform pg_temp.check(
    not exists (select 1 from notifications where id = drop_id),
    'dismissing a notification removes it');
  perform pg_temp.check(
    exists (select 1 from notifications where id = keep_id),
    'dismissing one notification leaves the others alone');

  -- Idempotent, and not an error.
  perform dismiss_notification(drop_id);

  -- You cannot dismiss someone else's.
  insert into notifications (user_id, kind) values (bob, 'bounty.open')
    returning id into drop_id;
  perform pg_temp.act_as(alice);
  perform dismiss_notification(drop_id);
  perform pg_temp.check(
    exists (select 1 from notifications where id = drop_id),
    'you cannot dismiss another user''s notification');

  -- =========================================================================
  -- Clearing read-only clears the READ ones.
  -- =========================================================================
  perform pg_temp.act_as(alice);
  insert into notifications (user_id, kind, read_at) values (alice, 'club.role', now());
  perform pg_temp.check(count_unread_notifications() = 1,
    'the unread one is still unread before clearing');

  perform clear_read_notifications();

  perform pg_temp.check(count_unread_notifications() = 1,
    'clearing read notifications never touches an unread one');
  perform pg_temp.check(
    not exists (
      select 1 from notifications where user_id = alice and read_at is not null
    ),
    'the read notifications are gone');

  -- =========================================================================
  -- Retention. Read expires at 30 days, unread is kept for 90.
  -- =========================================================================
  delete from notifications where user_id in (alice, bob);

  insert into notifications (user_id, kind, read_at, created_at) values
    -- Read and old → pruned.
    (alice, 'a', now() - interval '31 days', now() - interval '31 days'),
    -- Read but recent → kept.
    (alice, 'b', now() - interval '3 days',  now() - interval '3 days'),
    -- Unread and old, but inside 90 days → KEPT. Deleting something a user
    -- never saw is destroying information, not tidying up.
    (alice, 'c', null, now() - interval '60 days'),
    -- Unread and past 90 days → pruned.
    (alice, 'd', null, now() - interval '91 days'),
    -- Fresh unread → kept.
    (alice, 'e', null, now());

  select prune_notifications() into pruned;
  perform pg_temp.check(pruned = 2, 'prune removes exactly the expired rows');

  perform pg_temp.check(
    exists (select 1 from notifications where user_id = alice and kind = 'c'),
    'an unread notification is kept well past the read-retention window');
  perform pg_temp.check(
    not exists (select 1 from notifications where user_id = alice and kind = 'a'),
    'an old read notification is pruned');
  perform pg_temp.check(
    not exists (select 1 from notifications where user_id = alice and kind = 'd'),
    'an unread notification is eventually pruned too');
  perform pg_temp.check(
    (select count(*) from notifications where user_id = alice) = 3,
    'prune leaves everything still within retention');

  -- =========================================================================
  -- A client cannot mass-delete. prune is service_role only.
  -- =========================================================================
  perform pg_temp.check(
    not has_function_privilege('authenticated', 'public.prune_notifications()', 'execute'),
    'an ordinary user cannot invoke the global prune');

  raise notice 'ALL PHASE 21 RETENTION TESTS PASSED';
end;
$$;

rollback;
