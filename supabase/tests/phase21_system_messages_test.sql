-- Phase 21 acceptance tests: group system messages.
--
-- HOW TO RUN. Paste into the Supabase SQL Editor and run. It creates throwaway
-- users, asserts, and ROLLS BACK — safe against the live project.
--
-- Requires 0006–0014.

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

-- How many system lines in this conversation match this fragment?
create or replace function pg_temp.notices(p_conversation uuid, p_like text)
returns bigint
language sql
as $$
  select count(*) from messages
  where conversation_id = p_conversation
    and kind = 'system'
    and body like '%' || p_like || '%';
$$;

create or replace function pg_temp.system_count(p_conversation uuid)
returns bigint
language sql
as $$
  select count(*) from messages
  where conversation_id = p_conversation and kind = 'system';
$$;

do $$
declare
  alice uuid := gen_random_uuid();
  bob uuid := gen_random_uuid();
  carol uuid := gen_random_uuid();
  grp uuid;
  direct uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (alice, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's-alice@test.local'),
    (bob,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's-bob@test.local'),
    (carol, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's-carol@test.local');

  insert into player_stats (user_id, display_name) values
    (alice, 'Alice'), (bob, 'Bob'), (carol, 'Carol');

  -- Everyone is friends: add_group_member requires it.
  perform pg_temp.act_as(alice);
  perform send_friend_request(bob);
  perform send_friend_request(carol);
  perform pg_temp.act_as(bob);
  perform accept_friend_request(alice);
  perform send_friend_request(carol);
  perform pg_temp.act_as(carol);
  perform accept_friend_request(alice);
  perform accept_friend_request(bob);

  -- =========================================================================
  -- Creating a group is silent.
  -- =========================================================================
  perform pg_temp.act_as(alice);
  grp := create_group_conversation('Movie Night');

  perform pg_temp.check(pg_temp.system_count(grp) = 0,
    'creating a group posts no system message for the founding owner');

  -- =========================================================================
  -- Adds name the actor, not just the subject.
  -- =========================================================================
  perform add_group_member(grp, bob);
  perform pg_temp.check(pg_temp.notices(grp, 'Alice added Bob') = 1,
    'adding a member records who added them');

  perform add_group_member(grp, carol);
  perform pg_temp.check(pg_temp.system_count(grp) = 2,
    'each add posts exactly one line');

  -- =========================================================================
  -- Leaving vs being removed are different events.
  -- =========================================================================
  perform pg_temp.act_as(carol);
  perform leave_conversation(grp);
  perform pg_temp.check(pg_temp.notices(grp, 'Carol left the group') = 1,
    'leaving under your own steam says "left"');
  perform pg_temp.check(pg_temp.notices(grp, 'removed Carol') = 0,
    'leaving is not recorded as a removal');

  -- Rejoining arrives as an UPDATE (left_at back to null), not an INSERT.
  perform pg_temp.act_as(alice);
  perform add_group_member(grp, carol);
  perform pg_temp.check(pg_temp.notices(grp, 'Alice added Carol') = 2,
    'a rejoin is narrated, not swallowed by the upsert');

  perform remove_group_member(grp, carol);
  perform pg_temp.check(pg_temp.notices(grp, 'Alice removed Carol') = 1,
    'being removed names the moderator who did it');

  -- =========================================================================
  -- Rename.
  -- =========================================================================
  perform rename_group(grp, 'Horror Night');
  perform pg_temp.check(pg_temp.notices(grp, 'renamed the group to "Horror Night"') = 1,
    'renaming a group is recorded with the new title');

  -- =========================================================================
  -- Roles and ownership transfer.
  -- =========================================================================
  perform set_conversation_role(grp, bob, 'moderator');
  perform pg_temp.check(pg_temp.notices(grp, 'Bob is now a moderator') = 1,
    'promotion is recorded');

  perform transfer_conversation_ownership(grp, bob);
  perform pg_temp.check(pg_temp.notices(grp, 'Bob is now the owner') = 1,
    'ownership transfer is recorded');
  -- The other half of a transfer demotes Alice owner → member. That must not
  -- print "Alice is no longer a moderator": she never was one.
  perform pg_temp.check(pg_temp.notices(grp, 'Alice is no longer a moderator') = 0,
    'the demoted former owner is not mislabelled as a demoted moderator');

  -- =========================================================================
  -- Direct conversations have no membership to narrate.
  -- =========================================================================
  perform pg_temp.act_as(alice);
  direct := create_direct_conversation(carol);
  perform pg_temp.check(pg_temp.system_count(direct) = 0,
    'a direct conversation posts no system messages');

  -- =========================================================================
  -- System messages are real messages: they stream, and they page by seq.
  -- =========================================================================
  perform pg_temp.check(
    not exists (
      select 1 from messages
      where conversation_id = grp and kind = 'system' and seq is null
    ),
    'system messages carry a seq, so the message cursor does not skip them');

  raise notice 'ALL PHASE 21 SYSTEM MESSAGE TESTS PASSED';
end;
$$;

rollback;
