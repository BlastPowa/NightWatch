-- Phase 20B fix: order messages by a monotonic sequence, not by timestamp.
-- Apply AFTER 0007_social_rpcs.sql. Rollback notes at the bottom.
--
-- WHY. created_at is now(), which is the TRANSACTION timestamp — two messages
-- written in one transaction share it exactly. The unread count and the read
-- cursor both compared `created_at >`, so a tied message was silently never
-- counted and never paged. The tiebreak was `id`, a random UUID, so ordering
-- between tied messages was effectively a coin flip: pagination could repeat
-- or skip a message.
--
-- A gapless-enough identity column gives a total order that does not depend on
-- the clock, which is what a cursor actually needs.

set lock_timeout = '10s';

alter table public.messages
  add column seq bigint generated always as identity;

-- Cursor index: page backwards through a conversation by seq.
create index messages_seq_cursor on public.messages (conversation_id, seq desc);

-- The old timestamp cursor index is now dead weight.
drop index if exists public.messages_cursor;

-- ---------------------------------------------------------------------------
-- Unread count: compare sequences, so messages sharing a timestamp still count.
-- ---------------------------------------------------------------------------
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
        and m.seq > coalesce(
          (select r.seq from messages r where r.id = mem.last_read_message_id),
          0
        )
    ) as unread_count
  from conversations c
  join conversation_members mem
    on mem.conversation_id = c.id and mem.user_id = me and mem.left_at is null
  order by c.updated_at desc
  limit 50;
end;
$$;

grant execute on function public.list_conversations() to authenticated;

-- ---------------------------------------------------------------------------
-- Message paging: cursor on seq. Stable under insertion and under ties.
-- ---------------------------------------------------------------------------
drop function if exists public.get_messages(uuid, timestamptz, integer);

create or replace function public.get_messages(
  p_conversation uuid,
  p_before_seq bigint default null,
  p_limit integer default 50
)
returns table (
  id uuid,
  seq bigint,
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
    m.seq,
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
    and (p_before_seq is null or m.seq < p_before_seq)
  order by m.seq desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

grant execute on function public.get_messages(uuid, bigint, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
--   drop function if exists public.get_messages(uuid, bigint, integer);
--   drop index if exists public.messages_seq_cursor;
--   alter table public.messages drop column if exists seq;
--   -- then re-run 0007's list_conversations and get_messages definitions.
