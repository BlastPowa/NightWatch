-- Phase 21: group system messages.
-- Apply AFTER 0013_notification_emitters.sql. Rollback notes at the bottom.
--
-- 0006 defined messages.kind = 'system' and nothing ever wrote one, so a group
-- was silent about its own membership: people appeared and vanished from the
-- member list with no record in the transcript of who added or removed whom.
-- That is exactly the history a moderator needs after an argument.
--
-- Same shape as 0013: AFTER triggers, security definer. Definer matters twice
-- here — it bypasses the messages INSERT policy (which only lets an active
-- member post as themselves) AND the per-conversation rate limit, which a burst
-- of membership changes would otherwise trip.
--
-- Bodies are written as prose, in the actor's and subject's display names AS OF
-- THE MOMENT IT HAPPENED. A later rename does not rewrite history, which is the
-- correct behaviour for a transcript even though it means the name in an old
-- system line can differ from the name on the profile today.

-- ---------------------------------------------------------------------------
-- Helpers.
-- ---------------------------------------------------------------------------

create or replace function public.display_name_of(p_user uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(nullif(ps.display_name, ''), 'Someone')
  from player_stats ps
  where ps.user_id = p_user;
$$;

-- Writes one system line. sender_id is NOT NULL and references auth.users, so
-- an actor-less change (a SQL-editor edit, a cascade) is attributed to the
-- subject rather than dropped — the transcript should not develop holes.
create or replace function public.post_system_message(
  p_conversation uuid,
  p_sender uuid,
  p_body text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_conversation is null or p_sender is null or coalesce(trim(p_body), '') = '' then
    return;
  end if;
  -- Direct conversations have no membership to narrate. Only groups.
  if not exists (
    select 1 from conversations where id = p_conversation and kind = 'group'
  ) then
    return;
  end if;

  insert into messages (conversation_id, sender_id, kind, body)
  values (p_conversation, p_sender, 'system', left(trim(p_body), 2000));

  update conversations set updated_at = now() where id = p_conversation;
end;
$$;

-- ---------------------------------------------------------------------------
-- Membership: joins, adds, leaves, removals.
-- ---------------------------------------------------------------------------

create or replace function public.on_member_added()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  -- The founding owner row is written by create_group_conversation itself.
  -- "Alice joined the group" as the first line of a group Alice just made is
  -- noise, not history.
  if new.role = 'owner' then
    return new;
  end if;

  perform public.post_system_message(
    new.conversation_id,
    coalesce(actor, new.user_id),
    case
      when actor is null or actor = new.user_id
        then public.display_name_of(new.user_id) || ' joined the group'
      else public.display_name_of(actor) || ' added ' || public.display_name_of(new.user_id)
    end
  );

  return new;
end;
$$;

drop trigger if exists member_added_notice on public.conversation_members;
create trigger member_added_notice
  after insert on public.conversation_members
  for each row
  execute function public.on_member_added();

create or replace function public.on_member_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  -- Re-added after leaving: add_group_member upserts left_at back to null, so a
  -- rejoin arrives as an UPDATE, not an INSERT. Without this branch a rejoin
  -- would be silent.
  if old.left_at is not null and new.left_at is null then
    perform public.post_system_message(
      new.conversation_id,
      coalesce(actor, new.user_id),
      case
        when actor is null or actor = new.user_id
          then public.display_name_of(new.user_id) || ' rejoined the group'
        else public.display_name_of(actor) || ' added ' || public.display_name_of(new.user_id)
      end
    );
    return new;
  end if;

  -- Departure. Who did it is the whole point of the line.
  if old.left_at is null and new.left_at is not null then
    perform public.post_system_message(
      new.conversation_id,
      coalesce(actor, new.user_id),
      case
        when actor is null or actor = new.user_id
          then public.display_name_of(new.user_id) || ' left the group'
        else public.display_name_of(actor) || ' removed ' || public.display_name_of(new.user_id)
      end
    );
    return new;
  end if;

  -- Role changes, but only for someone still in the room.
  --
  -- The owner → member demotion is skipped on purpose: it is the other half of
  -- transfer_conversation_ownership, which already prints "B is now the owner".
  -- Reporting it as "A is no longer a moderator" would be both redundant and
  -- wrong — A was never a moderator.
  if new.role is distinct from old.role
     and new.left_at is null
     and not (old.role = 'owner' and new.role = 'member') then
    perform public.post_system_message(
      new.conversation_id,
      coalesce(actor, new.user_id),
      case new.role
        when 'moderator' then public.display_name_of(new.user_id) || ' is now a moderator'
        when 'owner'     then public.display_name_of(new.user_id) || ' is now the owner'
        else public.display_name_of(new.user_id) || ' is no longer a moderator'
      end
    );
  end if;

  return new;
end;
$$;

drop trigger if exists member_changed_notice on public.conversation_members;
create trigger member_changed_notice
  after update on public.conversation_members
  for each row
  execute function public.on_member_changed();

-- ---------------------------------------------------------------------------
-- Renames.
--
-- Ownership transfer is deliberately NOT narrated here: it lands as a role
-- change on conversation_members (member → owner), which on_member_changed
-- already reports. Narrating it from conversations too would print the line
-- twice.
-- ---------------------------------------------------------------------------

create or replace function public.on_group_renamed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if new.kind <> 'group' or new.title is not distinct from old.title then
    return new;
  end if;

  perform public.post_system_message(
    new.id,
    coalesce(actor, new.owner_id),
    public.display_name_of(coalesce(actor, new.owner_id))
      || ' renamed the group to "' || coalesce(new.title, '') || '"'
  );

  return new;
end;
$$;

drop trigger if exists group_renamed_notice on public.conversations;
create trigger group_renamed_notice
  after update of title on public.conversations
  for each row
  execute function public.on_group_renamed();

-- ---------------------------------------------------------------------------
-- Group moderator roles.
--
-- A gap in 0007, found while testing this migration: conversation_members.role
-- exists and the RLS policies check it, but no RPC could ever SET it. Every
-- group was owner-plus-members forever, and "owner/moderator controls
-- membership" was a rule that only one person could ever satisfy.
-- ---------------------------------------------------------------------------

create or replace function public.set_conversation_role(
  p_conversation uuid,
  p_user uuid,
  p_role text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_auth();
begin
  -- Only the owner appoints. A moderator promoting other moderators is how a
  -- group gets taken over by whoever was trusted first.
  if not exists (
    select 1 from conversations where id = p_conversation and owner_id = me and kind = 'group'
  ) then
    raise exception 'forbidden';
  end if;
  -- Ownership moves through transfer_conversation_ownership, not through here.
  if p_role not in ('moderator', 'member') then
    raise exception 'forbidden';
  end if;
  if p_user = me then
    raise exception 'forbidden';
  end if;
  if not public.is_active_member(p_conversation, p_user) then
    raise exception 'forbidden';
  end if;

  update conversation_members
  set role = p_role
  where conversation_id = p_conversation and user_id = p_user and left_at is null;

  return 'ok';  -- Idempotent: setting the role someone already has changes nothing.
end;
$$;

grant execute on function public.set_conversation_role(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- ROLLBACK (run before 0013's rollback)
-- ---------------------------------------------------------------------------
--   drop function if exists public.set_conversation_role(uuid, uuid, text);
--   drop trigger if exists group_renamed_notice on public.conversations;
--   drop trigger if exists member_changed_notice on public.conversation_members;
--   drop trigger if exists member_added_notice on public.conversation_members;
--   drop function if exists public.on_group_renamed();
--   drop function if exists public.on_member_changed();
--   drop function if exists public.on_member_added();
--   drop function if exists public.post_system_message(uuid, uuid, text);
--   drop function if exists public.display_name_of(uuid);
