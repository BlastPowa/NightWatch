-- Phase 20B RPCs: friends, presence, messaging, moments, borders.
-- Apply AFTER 0006_social_phase20b.sql. Rollback notes at the bottom.
--
-- Every function here is `security definer` and therefore bypasses RLS. The
-- rules that must hold in EVERY one of them:
--   1. auth.uid() must be non-null (raise 'unauthenticated' otherwise).
--   2. is_blocked() is checked before any read of, or write toward, another
--      user. A block overrides every other permission, in both directions.
--   3. Transitions are idempotent: re-accepting an accepted request succeeds
--      quietly rather than erroring, because the UI will retry.
-- The client maps the raised messages onto its typed result union
-- (ok|unauthenticated|forbidden|blocked|rate-limited|offline|not-ready|error).

create or replace function public.require_auth()
returns uuid
language plpgsql
stable
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'unauthenticated';
  end if;
  return me;
end;
$$;

-- ---------------------------------------------------------------------------
-- Friend discovery. Returns the four collections separately, per the handoff:
-- accepted friends, incoming requests, outgoing requests, and Phase 19
-- co-watcher suggestions.
-- ---------------------------------------------------------------------------
create or replace function public.get_social_graph()
returns table (
  kind text,
  user_id uuid,
  display_name text,
  request_id uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  me uuid := public.require_auth();
begin
  return query
  -- Accepted friends.
  select
    'friend'::text,
    f.other,
    coalesce(nullif(ps.display_name, ''), 'Someone'),
    null::uuid,
    f.created_at
  from (
    select case when user_low = me then user_high else user_low end as other, created_at
    from friendships
    where me in (user_low, user_high)
  ) f
  left join player_stats ps on ps.user_id = f.other
  where not public.is_blocked(me, f.other)

  union all

  -- Incoming pending requests.
  select
    'incoming'::text,
    r.sender_id,
    coalesce(nullif(ps.display_name, ''), 'Someone'),
    r.id,
    r.created_at
  from friend_requests r
  left join player_stats ps on ps.user_id = r.sender_id
  where r.recipient_id = me
    and r.status = 'pending'
    and not public.is_blocked(me, r.sender_id)

  union all

  -- Outgoing pending requests.
  select
    'outgoing'::text,
    r.recipient_id,
    coalesce(nullif(ps.display_name, ''), 'Someone'),
    r.id,
    r.created_at
  from friend_requests r
  left join player_stats ps on ps.user_id = r.recipient_id
  where r.sender_id = me
    and r.status = 'pending'
    and not public.is_blocked(me, r.recipient_id)

  union all

  -- Phase 19 co-watcher suggestions: people you have shared a persistent room
  -- with, who are not already friends, not already in a live request, and not
  -- blocked. Only surfaces users who opted into sharing.
  select distinct
    'suggestion'::text,
    theirs.user_id,
    coalesce(nullif(ps.display_name, ''), 'Someone'),
    null::uuid,
    max(theirs.last_seen_at)
  from room_participants mine
  join room_participants theirs on theirs.room_code = mine.room_code
  join player_stats ps on ps.user_id = theirs.user_id
  where mine.user_id = me
    and theirs.user_id <> me
    and ps.share_stats = true
    and not public.are_friends(me, theirs.user_id)
    and not public.is_blocked(me, theirs.user_id)
    and not exists (
      select 1 from friend_requests r
      where r.status = 'pending'
        and least(r.sender_id, r.recipient_id) = least(me, theirs.user_id)
        and greatest(r.sender_id, r.recipient_id) = greatest(me, theirs.user_id)
    )
  group by theirs.user_id, ps.display_name;
end;
$$;

grant execute on function public.get_social_graph() to authenticated;

-- ---------------------------------------------------------------------------
-- Friend request transitions. All idempotent, all block-aware.
-- ---------------------------------------------------------------------------

create or replace function public.send_friend_request(p_recipient uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
begin
  if p_recipient = me then
    raise exception 'forbidden';
  end if;
  if public.is_blocked(me, p_recipient) then
    raise exception 'blocked';
  end if;
  if public.are_friends(me, p_recipient) then
    return 'ok';  -- Already friends: nothing to do.
  end if;
  if not public.under_limit_friend_requests(me) then
    raise exception 'rate-limited';
  end if;

  -- If THEY already have a pending request to us, accept it instead of
  -- creating a mirrored one the unique index would reject anyway.
  if exists (
    select 1 from friend_requests
    where sender_id = p_recipient and recipient_id = me and status = 'pending'
  ) then
    return public.accept_friend_request(p_recipient);
  end if;

  insert into friend_requests (sender_id, recipient_id)
  values (me, p_recipient)
  on conflict do nothing;  -- Idempotent: a live request already exists.

  return 'ok';
end;
$$;

create or replace function public.accept_friend_request(p_sender uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
begin
  if public.is_blocked(me, p_sender) then
    raise exception 'blocked';
  end if;
  if public.are_friends(me, p_sender) then
    return 'ok';  -- Idempotent.
  end if;

  update friend_requests
  set status = 'accepted', responded_at = now()
  where sender_id = p_sender and recipient_id = me and status = 'pending';

  if not found then
    raise exception 'forbidden';
  end if;

  -- Canonical pair; a concurrent double-accept collapses to one row.
  insert into friendships (user_low, user_high)
  values (least(me, p_sender), greatest(me, p_sender))
  on conflict do nothing;

  return 'ok';
end;
$$;

create or replace function public.decline_friend_request(p_sender uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
begin
  update friend_requests
  set status = 'declined', responded_at = now()
  where sender_id = p_sender and recipient_id = me and status = 'pending';
  return 'ok';  -- Idempotent: nothing pending is not an error.
end;
$$;

create or replace function public.cancel_friend_request(p_recipient uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
begin
  update friend_requests
  set status = 'cancelled', responded_at = now()
  where sender_id = me and recipient_id = p_recipient and status = 'pending';
  return 'ok';
end;
$$;

create or replace function public.remove_friend(p_user uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
begin
  delete from friendships
  where user_low = least(me, p_user) and user_high = greatest(me, p_user);
  return 'ok';
end;
$$;

-- Blocking is the destructive transition: it must sever the friendship AND
-- kill pending requests in BOTH directions in one transaction, or it leaves a
-- half-blocked state where a stale request can still be accepted.
create or replace function public.block_user(p_user uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
begin
  if p_user = me then
    raise exception 'forbidden';
  end if;

  delete from friendships
  where user_low = least(me, p_user) and user_high = greatest(me, p_user);

  update friend_requests
  set status = 'cancelled', responded_at = now()
  where status = 'pending'
    and least(sender_id, recipient_id) = least(me, p_user)
    and greatest(sender_id, recipient_id) = greatest(me, p_user);

  insert into user_blocks (blocker_id, blocked_id)
  values (me, p_user)
  on conflict do nothing;

  return 'ok';
end;
$$;

create or replace function public.unblock_user(p_user uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
begin
  delete from user_blocks where blocker_id = me and blocked_id = p_user;
  return 'ok';  -- Unblocking does NOT restore the friendship.
end;
$$;

grant execute on function public.send_friend_request(uuid) to authenticated;
grant execute on function public.accept_friend_request(uuid) to authenticated;
grant execute on function public.decline_friend_request(uuid) to authenticated;
grant execute on function public.cancel_friend_request(uuid) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Presence. Consent-filtered, accepted friends only, and NEVER a room code.
-- ---------------------------------------------------------------------------

create or replace function public.heartbeat_presence(
  p_status text,
  p_video_title text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
begin
  if p_status not in ('offline', 'online', 'watching', 'in_party') then
    raise exception 'forbidden';
  end if;

  insert into presence_preferences (user_id, status, video_title, updated_at)
  values (me, p_status, left(p_video_title, 120), now())
  on conflict (user_id) do update
    set status = excluded.status,
        video_title = excluded.video_title,
        updated_at = now();

  return 'ok';
end;
$$;

create or replace function public.set_presence_preferences(
  p_share_online boolean,
  p_share_activity boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
begin
  insert into presence_preferences (user_id, share_online, share_activity, updated_at)
  values (me, p_share_online, p_share_activity, now())
  on conflict (user_id) do update
    set share_online = excluded.share_online,
        share_activity = excluded.share_activity,
        updated_at = now();
  return 'ok';
end;
$$;

-- Only accepted friends, only what each has consented to expose. share_online
-- gates the status; share_activity additionally gates the video title. Users
-- who share neither are simply absent from the result.
create or replace function public.get_friend_presence()
returns table (
  user_id uuid,
  display_name text,
  status text,
  video_title text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  me uuid := public.require_auth();
begin
  return query
  select
    pp.user_id,
    coalesce(nullif(ps.display_name, ''), 'Someone'),
    pp.status,
    case when pp.share_activity then pp.video_title else null end,
    pp.updated_at
  from presence_preferences pp
  join friendships f
    on f.user_low = least(me, pp.user_id)
   and f.user_high = greatest(me, pp.user_id)
  left join player_stats ps on ps.user_id = pp.user_id
  where pp.user_id <> me
    and pp.share_online = true
    and not public.is_blocked(me, pp.user_id);
end;
$$;

grant execute on function public.heartbeat_presence(text, text) to authenticated;
grant execute on function public.set_presence_preferences(boolean, boolean) to authenticated;
grant execute on function public.get_friend_presence() to authenticated;

-- ---------------------------------------------------------------------------
-- Conversations and messages.
-- ---------------------------------------------------------------------------

-- Direct conversations require an accepted friendship. Idempotent: returns the
-- existing direct conversation if one exists.
create or replace function public.create_direct_conversation(p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
  existing uuid;
  new_id uuid;
begin
  if public.is_blocked(me, p_user) then
    raise exception 'blocked';
  end if;
  if not public.are_friends(me, p_user) then
    raise exception 'forbidden';
  end if;

  select c.id into existing
  from conversations c
  join conversation_members a on a.conversation_id = c.id and a.user_id = me and a.left_at is null
  join conversation_members b on b.conversation_id = c.id and b.user_id = p_user and b.left_at is null
  where c.kind = 'direct'
  limit 1;

  if existing is not null then
    return existing;
  end if;

  insert into conversations (kind, owner_id) values ('direct', me) returning id into new_id;
  insert into conversation_members (conversation_id, user_id, role)
  values (new_id, me, 'owner'), (new_id, p_user, 'member');

  return new_id;
end;
$$;

create or replace function public.create_group_conversation(p_title text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
  new_id uuid;
begin
  if not public.under_limit_groups(me) then
    raise exception 'rate-limited';
  end if;
  if p_title is null or char_length(trim(p_title)) = 0 then
    raise exception 'forbidden';
  end if;

  insert into conversations (kind, title, owner_id)
  values ('group', left(trim(p_title), 60), me)
  returning id into new_id;

  insert into conversation_members (conversation_id, user_id, role)
  values (new_id, me, 'owner');

  return new_id;
end;
$$;

-- The 30-member cap must hold under concurrent joins, so the count is taken
-- against a locked conversation row rather than read-then-write.
create or replace function public.add_group_member(p_conversation uuid, p_user uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
  active_count integer;
begin
  if public.is_blocked(me, p_user) then
    raise exception 'blocked';
  end if;
  -- Group invites require an accepted friendship with the inviter.
  if not public.are_friends(me, p_user) then
    raise exception 'forbidden';
  end if;
  if not exists (
    select 1 from conversation_members
    where conversation_id = p_conversation
      and user_id = me
      and left_at is null
      and role in ('owner', 'moderator')
  ) then
    raise exception 'forbidden';
  end if;

  -- Serialises concurrent adds on this conversation.
  perform 1 from conversations where id = p_conversation for update;

  select count(*) into active_count
  from conversation_members
  where conversation_id = p_conversation and left_at is null;

  if active_count >= 30 then
    raise exception 'forbidden';
  end if;

  insert into conversation_members (conversation_id, user_id)
  values (p_conversation, p_user)
  on conflict (conversation_id, user_id) do update
    set left_at = null, joined_at = now();

  return 'ok';
end;
$$;

create or replace function public.remove_group_member(p_conversation uuid, p_user uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
begin
  if not exists (
    select 1 from conversation_members
    where conversation_id = p_conversation
      and user_id = me
      and left_at is null
      and role in ('owner', 'moderator')
  ) then
    raise exception 'forbidden';
  end if;
  -- The owner cannot be removed; they must transfer or disband.
  if exists (
    select 1 from conversation_members
    where conversation_id = p_conversation and user_id = p_user and role = 'owner'
  ) then
    raise exception 'forbidden';
  end if;

  update conversation_members
  set left_at = now()
  where conversation_id = p_conversation and user_id = p_user and left_at is null;

  return 'ok';
end;
$$;

create or replace function public.leave_conversation(p_conversation uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
begin
  -- An owner leaving would orphan the group: transfer ownership first.
  if exists (
    select 1 from conversation_members
    where conversation_id = p_conversation and user_id = me and role = 'owner'
  ) then
    raise exception 'forbidden';
  end if;

  update conversation_members
  set left_at = now()
  where conversation_id = p_conversation and user_id = me and left_at is null;

  return 'ok';
end;
$$;

create or replace function public.transfer_conversation_ownership(
  p_conversation uuid,
  p_user uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
begin
  if not exists (
    select 1 from conversations
    where id = p_conversation and owner_id = me
  ) then
    raise exception 'forbidden';
  end if;
  if not public.is_active_member(p_conversation, p_user) then
    raise exception 'forbidden';
  end if;

  update conversations set owner_id = p_user, updated_at = now() where id = p_conversation;
  update conversation_members set role = 'member'
    where conversation_id = p_conversation and user_id = me;
  update conversation_members set role = 'owner'
    where conversation_id = p_conversation and user_id = p_user;

  return 'ok';
end;
$$;

create or replace function public.rename_group(p_conversation uuid, p_title text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
begin
  if not exists (
    select 1 from conversation_members
    where conversation_id = p_conversation
      and user_id = me
      and left_at is null
      and role in ('owner', 'moderator')
  ) then
    raise exception 'forbidden';
  end if;
  if p_title is null or char_length(trim(p_title)) = 0 then
    raise exception 'forbidden';
  end if;

  update conversations
  set title = left(trim(p_title), 60), updated_at = now()
  where id = p_conversation and kind = 'group';

  return 'ok';
end;
$$;

create or replace function public.list_conversations()
returns table (
  id uuid,
  kind text,
  title text,
  owner_id uuid,
  updated_at timestamptz,
  unread_count bigint
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  me uuid := public.require_auth();
begin
  return query
  select
    c.id,
    c.kind,
    c.title,
    c.owner_id,
    c.updated_at,
    (
      select count(*)
      from messages m
      where m.conversation_id = c.id
        and m.deleted_at is null
        and m.sender_id <> me
        and (
          mem.last_read_message_id is null
          or m.created_at > (
            select r.created_at from messages r where r.id = mem.last_read_message_id
          )
        )
    ) as unread_count
  from conversations c
  join conversation_members mem
    on mem.conversation_id = c.id and mem.user_id = me and mem.left_at is null
  order by c.updated_at desc
  limit 50;
end;
$$;

-- Cursor paging: pass the oldest created_at you already have to fetch older
-- messages. Stable under insertion because it pages backwards from a fixed
-- point rather than by offset.
create or replace function public.get_messages(
  p_conversation uuid,
  p_before timestamptz default null,
  p_limit integer default 50
)
returns table (
  id uuid,
  sender_id uuid,
  display_name text,
  kind text,
  body text,
  created_at timestamptz,
  edited_at timestamptz,
  deleted_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  me uuid := public.require_auth();
begin
  if not public.is_active_member(p_conversation, me) then
    raise exception 'forbidden';
  end if;

  return query
  select
    m.id,
    m.sender_id,
    coalesce(nullif(ps.display_name, ''), 'Someone'),
    m.kind,
    -- Soft-deleted messages keep their row (so cursors stay stable) but never
    -- return their body.
    case when m.deleted_at is null then m.body else '' end,
    m.created_at,
    m.edited_at,
    m.deleted_at
  from messages m
  left join player_stats ps on ps.user_id = m.sender_id
  where m.conversation_id = p_conversation
    and (p_before is null or m.created_at < p_before)
  order by m.created_at desc, m.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

create or replace function public.send_message(p_conversation uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
  new_id uuid;
  other uuid;
begin
  if not public.is_active_member(p_conversation, me) then
    raise exception 'forbidden';
  end if;
  if p_body is null or char_length(trim(p_body)) = 0 or char_length(p_body) > 2000 then
    raise exception 'forbidden';
  end if;
  if not public.under_limit_messages(me, p_conversation) then
    raise exception 'rate-limited';
  end if;

  -- A block must silence a direct conversation that already exists.
  select cm.user_id into other
  from conversation_members cm
  join conversations c on c.id = cm.conversation_id
  where cm.conversation_id = p_conversation
    and cm.user_id <> me
    and c.kind = 'direct'
  limit 1;

  if other is not null and public.is_blocked(me, other) then
    raise exception 'blocked';
  end if;

  insert into messages (conversation_id, sender_id, body)
  values (p_conversation, me, trim(p_body))
  returning id into new_id;

  update conversations set updated_at = now() where id = p_conversation;

  return new_id;
end;
$$;

create or replace function public.edit_message(p_message uuid, p_body text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
begin
  if p_body is null or char_length(trim(p_body)) = 0 or char_length(p_body) > 2000 then
    raise exception 'forbidden';
  end if;

  update messages
  set body = trim(p_body), edited_at = now()
  where id = p_message and sender_id = me and deleted_at is null;

  if not found then
    raise exception 'forbidden';
  end if;
  return 'ok';
end;
$$;

create or replace function public.delete_message(p_message uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
begin
  -- Soft delete only.
  update messages
  set deleted_at = now()
  where id = p_message and sender_id = me and deleted_at is null;
  return 'ok';  -- Idempotent.
end;
$$;

create or replace function public.mark_conversation_read(p_conversation uuid, p_message uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
begin
  if not public.is_active_member(p_conversation, me) then
    raise exception 'forbidden';
  end if;

  update conversation_members
  set last_read_message_id = p_message
  where conversation_id = p_conversation and user_id = me;

  return 'ok';
end;
$$;

grant execute on function public.create_direct_conversation(uuid) to authenticated;
grant execute on function public.create_group_conversation(text) to authenticated;
grant execute on function public.add_group_member(uuid, uuid) to authenticated;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;
grant execute on function public.leave_conversation(uuid) to authenticated;
grant execute on function public.transfer_conversation_ownership(uuid, uuid) to authenticated;
grant execute on function public.rename_group(uuid, text) to authenticated;
grant execute on function public.list_conversations() to authenticated;
grant execute on function public.get_messages(uuid, timestamptz, integer) to authenticated;
grant execute on function public.send_message(uuid, text) to authenticated;
grant execute on function public.edit_message(uuid, text) to authenticated;
grant execute on function public.delete_message(uuid) to authenticated;
grant execute on function public.mark_conversation_read(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Moment notes.
-- ---------------------------------------------------------------------------

-- Visibility enforcement lives here: private = author only; friends = accepted
-- friends minus blocks; room = signed-in participants/owner of that persistent
-- room.
create or replace function public.list_moment_notes(
  p_video_id text,
  p_room_code text default null,
  p_before timestamptz default null,
  p_limit integer default 50
)
returns table (
  id uuid,
  author_id uuid,
  display_name text,
  position_seconds integer,
  visibility text,
  body text,
  emoji text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  me uuid := public.require_auth();
begin
  return query
  select
    n.id,
    n.author_id,
    coalesce(nullif(ps.display_name, ''), 'Someone'),
    n.position_seconds,
    n.visibility,
    n.body,
    n.emoji,
    n.created_at,
    n.updated_at
  from video_moment_notes n
  left join player_stats ps on ps.user_id = n.author_id
  where n.video_id = p_video_id
    and n.deleted_at is null
    and (p_before is null or n.created_at < p_before)
    and not public.is_blocked(me, n.author_id)
    and (
      n.author_id = me
      or (n.visibility = 'friends' and public.are_friends(me, n.author_id))
      or (
        n.visibility = 'room'
        and p_room_code is not null
        and n.room_code = upper(p_room_code)
        and (
          exists (
            select 1 from room_participants rp
            where rp.room_code = upper(p_room_code) and rp.user_id = me
          )
          or exists (
            select 1 from rooms r
            where r.code = upper(p_room_code) and r.owner_id = me
          )
        )
      )
    )
  order by n.created_at desc, n.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

create or replace function public.create_moment_note(
  p_video_id text,
  p_position_seconds integer,
  p_visibility text,
  p_body text default '',
  p_emoji text default null,
  p_room_code text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
  new_id uuid;
  clamped integer;
begin
  if p_visibility not in ('private', 'friends', 'room') then
    raise exception 'forbidden';
  end if;
  if not public.under_limit_moments(me) then
    raise exception 'rate-limited';
  end if;

  -- Clamp to a non-negative finite value; the client validates against the
  -- known duration, which the server cannot know.
  clamped := greatest(coalesce(p_position_seconds, 0), 0);

  -- Room notes require an actual relationship with that persistent room.
  if p_visibility = 'room' then
    if p_room_code is null then
      raise exception 'forbidden';
    end if;
    if not exists (
      select 1 from room_participants rp
      where rp.room_code = upper(p_room_code) and rp.user_id = me
    ) and not exists (
      select 1 from rooms r
      where r.code = upper(p_room_code) and r.owner_id = me
    ) then
      raise exception 'forbidden';
    end if;
  end if;

  insert into video_moment_notes (
    author_id, video_id, position_seconds, visibility, room_code, body, emoji
  )
  values (
    me,
    p_video_id,
    clamped,
    p_visibility,
    case when p_visibility = 'room' then upper(p_room_code) else null end,
    coalesce(left(p_body, 500), ''),
    p_emoji
  )
  returning id into new_id;

  return new_id;
end;
$$;

create or replace function public.edit_moment_note(
  p_note uuid,
  p_body text,
  p_emoji text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
begin
  update video_moment_notes
  set body = coalesce(left(p_body, 500), ''), emoji = p_emoji, updated_at = now()
  where id = p_note and author_id = me and deleted_at is null;

  if not found then
    raise exception 'forbidden';
  end if;
  return 'ok';
end;
$$;

create or replace function public.delete_moment_note(p_note uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
begin
  update video_moment_notes
  set deleted_at = now()
  where id = p_note and author_id = me and deleted_at is null;
  return 'ok';  -- Idempotent.
end;
$$;

grant execute on function public.list_moment_notes(text, text, timestamptz, integer) to authenticated;
grant execute on function public.create_moment_note(text, integer, text, text, text, text) to authenticated;
grant execute on function public.edit_moment_note(uuid, text, text) to authenticated;
grant execute on function public.delete_moment_note(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Profile borders. The server validates the selection is actually unlocked —
-- the client is never trusted with that check.
-- ---------------------------------------------------------------------------

create or replace function public.list_borders()
returns table (id text, label text, unlocked boolean, selected boolean)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  me uuid := public.require_auth();
begin
  return query
  select
    b.id,
    b.label,
    (b.required_achievement_id is null or u.border_id is not null) as unlocked,
    (ps.selected_border_id = b.id) as selected
  from profile_borders b
  left join player_border_unlocks u on u.border_id = b.id and u.user_id = me
  left join player_stats ps on ps.user_id = me
  order by b.id;
end;
$$;

-- Unlocks mirror the achievements the client already earned. Trusting the
-- client here is acceptable only because a border is cosmetic and the
-- achievement itself is already client-authoritative (ADR-009).
create or replace function public.unlock_border(p_border text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
  needed text;
begin
  select required_achievement_id into needed from profile_borders where id = p_border;
  if not found then
    raise exception 'forbidden';
  end if;

  -- The achievement must already be recorded server-side (0004).
  if needed is not null and not exists (
    select 1 from player_achievements
    where user_id = me and achievement_id = needed
  ) then
    raise exception 'forbidden';
  end if;

  insert into player_border_unlocks (user_id, border_id)
  values (me, p_border)
  on conflict do nothing;

  return 'ok';
end;
$$;

create or replace function public.select_border(p_border text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
  needed text;
begin
  select required_achievement_id into needed from profile_borders where id = p_border;
  if not found then
    raise exception 'forbidden';
  end if;

  -- Server-side validation that the border is unlocked.
  if needed is not null and not exists (
    select 1 from player_border_unlocks
    where user_id = me and border_id = p_border
  ) then
    raise exception 'forbidden';
  end if;

  update player_stats set selected_border_id = p_border where user_id = me;
  if not found then
    raise exception 'not-ready';  -- No player_stats row: sync has not run yet.
  end if;

  return 'ok';
end;
$$;

grant execute on function public.list_borders() to authenticated;
grant execute on function public.unlock_border(text) to authenticated;
grant execute on function public.select_border(text) to authenticated;

-- ---------------------------------------------------------------------------
-- ROLLBACK (run before 0006's rollback)
-- ---------------------------------------------------------------------------
--   drop function if exists public.select_border(text);
--   drop function if exists public.unlock_border(text);
--   drop function if exists public.list_borders();
--   drop function if exists public.delete_moment_note(uuid);
--   drop function if exists public.edit_moment_note(uuid, text, text);
--   drop function if exists public.create_moment_note(text, integer, text, text, text, text);
--   drop function if exists public.list_moment_notes(text, text, timestamptz, integer);
--   drop function if exists public.mark_conversation_read(uuid, uuid);
--   drop function if exists public.delete_message(uuid);
--   drop function if exists public.edit_message(uuid, text);
--   drop function if exists public.send_message(uuid, text);
--   drop function if exists public.get_messages(uuid, timestamptz, integer);
--   drop function if exists public.list_conversations();
--   drop function if exists public.rename_group(uuid, text);
--   drop function if exists public.transfer_conversation_ownership(uuid, uuid);
--   drop function if exists public.leave_conversation(uuid);
--   drop function if exists public.remove_group_member(uuid, uuid);
--   drop function if exists public.add_group_member(uuid, uuid);
--   drop function if exists public.create_group_conversation(text);
--   drop function if exists public.create_direct_conversation(uuid);
--   drop function if exists public.get_friend_presence();
--   drop function if exists public.set_presence_preferences(boolean, boolean);
--   drop function if exists public.heartbeat_presence(text, text);
--   drop function if exists public.unblock_user(uuid);
--   drop function if exists public.block_user(uuid);
--   drop function if exists public.remove_friend(uuid);
--   drop function if exists public.cancel_friend_request(uuid);
--   drop function if exists public.decline_friend_request(uuid);
--   drop function if exists public.accept_friend_request(uuid);
--   drop function if exists public.send_friend_request(uuid);
--   drop function if exists public.get_social_graph();
--   drop function if exists public.require_auth();
