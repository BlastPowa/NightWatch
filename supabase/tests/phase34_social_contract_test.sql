-- Phase 34 social contract verification.
--
-- Purpose: prove the DEPLOYED friends / people-search / room-people /
-- messaging / presence / group-chat / blocking contracts behave as the client
-- assumes, using two real accounts. Failures here are contract defects to fix
-- in the backend — never a reason to relax RLS.
--
-- Run against a DISPOSABLE (or owner-approved) database with 0001-0028:
--   psql "$DISPOSABLE_DB_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/phase34_social_contract_test.sql
--
-- Expected final row:
--   phase34 social contract test: all assertions passed

begin;

create or replace function pg_temp.impersonate(p_user uuid) returns void
language sql as $$
  select set_config('request.jwt.claims',
           json_build_object('sub', p_user, 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true);
$$;

create or replace function pg_temp.as_admin() returns void
language sql as $$
  select set_config('request.jwt.claims', '', true),
         set_config('role', 'postgres', true);
$$;

select pg_temp.as_admin();

-- Fixtures: A and B become friends; C stays a stranger.
insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-00000034aa01', 'p34-alice@test.local'),
  ('00000000-0000-0000-0000-00000034bb02', 'p34-bob@test.local'),
  ('00000000-0000-0000-0000-00000034cc03', 'p34-carol@test.local')
on conflict (id) do nothing;

insert into public.player_stats (user_id, display_name, public_handle, discoverable)
values
  ('00000000-0000-0000-0000-00000034aa01', 'Alice', 'p34alice', true),
  ('00000000-0000-0000-0000-00000034bb02', 'Bob', 'p34bob', true),
  ('00000000-0000-0000-0000-00000034cc03', 'Carol', 'p34carol', false)
on conflict (user_id) do update
  set display_name = excluded.display_name,
      public_handle = excluded.public_handle,
      discoverable = excluded.discoverable;

-- 1. Friend request lifecycle -----------------------------------------------
--
-- CONTRACT NOTE (verified against 0007): accept/decline/cancel/remove/block
-- all take the OTHER USER'S ID, never a friend_requests.id. Passing a request
-- id matches no pending row and raises 'forbidden'. Any client calling these
-- with a request id is broken in exactly that way.
do $$
begin
  perform pg_temp.impersonate('00000000-0000-0000-0000-00000034aa01');
  perform public.send_friend_request('00000000-0000-0000-0000-00000034bb02');

  perform pg_temp.as_admin();
  if not exists (
    select 1 from public.friend_requests
    where sender_id = '00000000-0000-0000-0000-00000034aa01'
      and recipient_id = '00000000-0000-0000-0000-00000034bb02'
      and status = 'pending'
  ) then
    raise exception 'friend request was not recorded as pending';
  end if;

  -- Only the RECIPIENT may accept: Carol has no pending request from Alice.
  perform pg_temp.impersonate('00000000-0000-0000-0000-00000034cc03');
  begin
    perform public.accept_friend_request('00000000-0000-0000-0000-00000034aa01');
    raise exception 'a third party accepted someone else''s friend request';
  exception when others then
    if sqlerrm like '%third party%' then raise; end if;
  end;

  -- Recipient accepts by naming the SENDER.
  perform pg_temp.impersonate('00000000-0000-0000-0000-00000034bb02');
  perform public.accept_friend_request('00000000-0000-0000-0000-00000034aa01');

  perform pg_temp.as_admin();
  if not exists (
    select 1 from public.friendships
    where user_low = least('00000000-0000-0000-0000-00000034aa01'::uuid,
                           '00000000-0000-0000-0000-00000034bb02'::uuid)
      and user_high = greatest('00000000-0000-0000-0000-00000034aa01'::uuid,
                               '00000000-0000-0000-0000-00000034bb02'::uuid)
  ) then
    raise exception 'accepted request did not create a friendship';
  end if;

  -- Carol must NOT have been joined to anything by the refused attempt.
  if exists (
    select 1 from public.friendships
    where user_low = least('00000000-0000-0000-0000-00000034aa01'::uuid,
                           '00000000-0000-0000-0000-00000034cc03'::uuid)
      and user_high = greatest('00000000-0000-0000-0000-00000034aa01'::uuid,
                               '00000000-0000-0000-0000-00000034cc03'::uuid)
  ) then
    raise exception 'a refused accept still created a friendship';
  end if;
end $$;

-- 2. Direct messages require an accepted friendship -------------------------
do $$
declare v_conversation uuid;
begin
  -- Friends: allowed.
  perform pg_temp.impersonate('00000000-0000-0000-0000-00000034aa01');
  v_conversation := public.create_direct_conversation(
    '00000000-0000-0000-0000-00000034bb02');
  if v_conversation is null then
    raise exception 'friends could not open a direct conversation';
  end if;

  -- Strangers: refused.
  begin
    perform public.create_direct_conversation('00000000-0000-0000-0000-00000034cc03');
    raise exception 'a DM opened with a non-friend';
  exception when others then
    if sqlerrm like '%a DM opened%' then raise; end if;
  end;
end $$;

-- 3. Message send / read cursor / edit / delete ownership -------------------
do $$
declare
  v_conversation uuid;
  v_message uuid;
begin
  perform pg_temp.impersonate('00000000-0000-0000-0000-00000034aa01');
  v_conversation := public.create_direct_conversation(
    '00000000-0000-0000-0000-00000034bb02');
  v_message := public.send_message(v_conversation, 'phase34 probe');

  -- A non-member cannot read the thread.
  perform pg_temp.impersonate('00000000-0000-0000-0000-00000034cc03');
  begin
    -- Explicit cast: 0007 and 0008 both define get_messages overloads, so an
    -- untyped NULL is ambiguous. The client contract is the 0008 bigint form.
    perform * from public.get_messages(v_conversation, null::bigint, 20);
    raise exception 'a non-member read a conversation';
  exception when others then
    if sqlerrm like '%non-member read%' then raise; end if;
  end;

  -- Only the author may edit or delete.
  perform pg_temp.impersonate('00000000-0000-0000-0000-00000034bb02');
  begin
    perform public.edit_message(v_message, 'tampered');
    raise exception 'a non-author edited a message';
  exception when others then
    if sqlerrm like '%non-author edited%' then raise; end if;
  end;

  -- The recipient may advance their own read cursor.
  perform public.mark_conversation_read(v_conversation, v_message);

  perform pg_temp.impersonate('00000000-0000-0000-0000-00000034aa01');
  perform public.edit_message(v_message, 'phase34 probe edited');
  perform public.delete_message(v_message);
end $$;

-- 4. Group conversations: membership and the 30-person cap ------------------
do $$
declare
  v_group uuid;
  v_extra uuid;
  v_index integer;
begin
  perform pg_temp.impersonate('00000000-0000-0000-0000-00000034aa01');
  v_group := public.create_group_conversation('Phase 34 group');

  -- Only accepted friends may be added.
  begin
    perform public.add_group_member(v_group, '00000000-0000-0000-0000-00000034cc03');
    raise exception 'a non-friend was added to a group';
  exception when others then
    if sqlerrm like '%non-friend was added%' then raise; end if;
  end;

  perform public.add_group_member(v_group, '00000000-0000-0000-0000-00000034bb02');

  -- Fill to the cap with synthetic friends, then prove the 31st is refused.
  perform pg_temp.as_admin();
  for v_index in 1..40 loop
    v_extra := ('00000000-0000-0000-0000-0000340' || lpad(v_index::text, 5, '0'))::uuid;
    insert into auth.users (id, email)
    values (v_extra, 'p34-fill-' || v_index || '@test.local')
    on conflict (id) do nothing;
    insert into public.friendships (user_low, user_high)
    values (
      least('00000000-0000-0000-0000-00000034aa01'::uuid, v_extra),
      greatest('00000000-0000-0000-0000-00000034aa01'::uuid, v_extra)
    )
    on conflict do nothing;
  end loop;

  perform pg_temp.impersonate('00000000-0000-0000-0000-00000034aa01');
  declare
    v_added integer := 2; -- owner + Bob
    v_capped boolean := false;
  begin
    for v_index in 1..40 loop
      v_extra := ('00000000-0000-0000-0000-0000340' || lpad(v_index::text, 5, '0'))::uuid;
      begin
        perform public.add_group_member(v_group, v_extra);
        v_added := v_added + 1;
      exception when others then
        v_capped := true;
        exit;
      end;
    end loop;
    if not v_capped then
      raise exception 'group membership was never capped (reached % members)', v_added;
    end if;
    if v_added > 30 then
      raise exception 'group exceeded the 30-member cap (% members)', v_added;
    end if;
  end;
end $$;

-- 5. Blocking cuts both directions ------------------------------------------
do $$
begin
  perform pg_temp.impersonate('00000000-0000-0000-0000-00000034bb02');
  perform public.block_user('00000000-0000-0000-0000-00000034aa01');

  -- The blocker cannot find the blocked user...
  if exists (select 1 from public.search_people('p34alice')) then
    raise exception 'blocked user appeared in the blocker''s search';
  end if;

  -- ...and the blocked user cannot find the blocker.
  perform pg_temp.impersonate('00000000-0000-0000-0000-00000034aa01');
  if exists (select 1 from public.search_people('p34bob')) then
    raise exception 'blocker appeared in the blocked user''s search';
  end if;

  -- New DMs between them are refused.
  begin
    perform public.create_direct_conversation('00000000-0000-0000-0000-00000034bb02');
    raise exception 'a DM opened across a block';
  exception when others then
    if sqlerrm like '%DM opened across%' then raise; end if;
  end;

  perform pg_temp.impersonate('00000000-0000-0000-0000-00000034bb02');
  perform public.unblock_user('00000000-0000-0000-0000-00000034aa01');
end $$;

-- 6. Discovery consent and minimum query length -----------------------------
do $$
begin
  perform pg_temp.impersonate('00000000-0000-0000-0000-00000034aa01');

  -- Carol opted out and must never appear.
  if exists (select 1 from public.search_people('p34carol')) then
    raise exception 'an opted-out user appeared in discovery';
  end if;

  -- The caller never appears in their own results.
  if exists (
    select 1 from public.search_people('p34alice')
    where user_id = '00000000-0000-0000-0000-00000034aa01'
  ) then
    raise exception 'the caller appeared in their own search results';
  end if;

  begin
    perform * from public.search_people('ab');
    raise exception 'a two-character search was accepted';
  exception when others then
    if sqlerrm not like '%query-too-short%' then raise; end if;
  end;
end $$;

-- 7. Presence is consent-based and carries no room code ---------------------
do $$
declare v_src text;
begin
  perform pg_temp.impersonate('00000000-0000-0000-0000-00000034aa01');
  perform public.set_presence_preferences(false, false);
  perform public.heartbeat_presence('watching', 'Some Title');

  -- With sharing off, a friend must not see the status.
  perform pg_temp.impersonate('00000000-0000-0000-0000-00000034bb02');
  if exists (
    select 1 from public.get_friend_presence_v2()
    where user_id = '00000000-0000-0000-0000-00000034aa01'
  ) then
    raise exception 'presence leaked while sharing was disabled';
  end if;

  select pg_get_functiondef(to_regprocedure('public.get_friend_presence_v2()'))
    into v_src;
  if position('room_code' in v_src) > 0 then
    raise exception 'friend presence exposes a room code';
  end if;
end $$;

select 'phase34 social contract test: all assertions passed' as result;

rollback;
