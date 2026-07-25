-- Phase 34: runtime capability manifest v2.
--
-- Why this exists. Two earlier detection paths are each wrong in a way that
-- produces the exact bug the packaged builds show:
--
--   * the v0.1.25 probe called FEATURE rpcs and treated "not 42883/42P01" as
--     deployed. That consumes real search quota, writes presence rows, and
--     cannot distinguish "signed out" from "migration missing".
--   * social_diagnostics() (0024) is correct but partial: it covers the social
--     surface only, reports a fixed function list, and its realtimeTables view
--     is hard-limited to two tables.
--
-- runtime_capabilities_v2 answers the whole question in ONE non-destructive
-- round trip, reporting EXACT signatures (to_regprocedure resolves the full
-- argument list, so a renamed or re-signatured function reports false rather
-- than a misleading true).
--
-- Contract:
--   {
--     "schemaGeneration": int,          -- bump when a client-visible contract changes
--     "authenticated":    bool,         -- derived server-side from the JWT
--     "functions":        { name: bool },
--     "realtimeTables":   [text]        -- actually in the publication, allowlisted
--   }
--
-- 0024's social_diagnostics() is deliberately LEFT IN PLACE for one
-- compatibility cycle so a v0.1.27 client keeps working after this deploys.

set lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- Schema generation. Monotonic; the client compares it to detect a contract
-- change without needing to diff every flag. Bump this in the migration that
-- changes a client-visible contract — never retroactively.
-- ---------------------------------------------------------------------------

create or replace function public.runtime_schema_generation()
returns integer
language sql
immutable
as $$
  select 34;
$$;

revoke execute on function public.runtime_schema_generation()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Realtime table allowlist. Only tables the client legitimately subscribes to
-- may be named; anything else in the publication stays private, because the
-- publication is a schema map and a schema map is reconnaissance.
-- ---------------------------------------------------------------------------

create or replace function public.runtime_realtime_tables()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (
      select jsonb_agg(tablename order by tablename)
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename in (
          'messages',
          'friend_requests',
          'notifications',
          'conversation_members'
        )
    ),
    '[]'::jsonb
  );
$$;

revoke execute on function public.runtime_realtime_tables()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The manifest.
--
-- Callable by anon ON PURPOSE: its entire job is explaining why authenticated
-- calls would fail, and a signed-out client must be able to learn "you are
-- signed out" rather than seeing a uniform failure. It returns deployment
-- facts plus the CALLER'S OWN auth state and nothing about any other user.
-- ---------------------------------------------------------------------------

create or replace function public.runtime_capabilities_v2()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'schemaGeneration', public.runtime_schema_generation(),
    'authenticated', auth.uid() is not null,
    'functions', jsonb_build_object(
      -- Friend graph and relationships.
      'get_social_graph',
        to_regprocedure('public.get_social_graph()') is not null,
      'send_friend_request',
        to_regprocedure('public.send_friend_request(uuid)') is not null,
      'accept_friend_request',
        to_regprocedure('public.accept_friend_request(uuid)') is not null,
      'decline_friend_request',
        to_regprocedure('public.decline_friend_request(uuid)') is not null,
      'cancel_friend_request',
        to_regprocedure('public.cancel_friend_request(uuid)') is not null,
      'remove_friend',
        to_regprocedure('public.remove_friend(uuid)') is not null,
      'block_user',
        to_regprocedure('public.block_user(uuid)') is not null,
      'unblock_user',
        to_regprocedure('public.unblock_user(uuid)') is not null,
      'list_blocked_users',
        to_regprocedure('public.list_blocked_users()') is not null,

      -- People discovery (Phase 32).
      'search_people',
        to_regprocedure('public.search_people(text)') is not null,
      'get_room_people',
        to_regprocedure('public.get_room_people(text)') is not null,
      'set_public_handle',
        to_regprocedure('public.set_public_handle(text)') is not null,
      'set_discoverable',
        to_regprocedure('public.set_discoverable(boolean)') is not null,

      -- Messaging.
      'list_conversations',
        to_regprocedure('public.list_conversations()') is not null,
      'create_direct_conversation',
        to_regprocedure('public.create_direct_conversation(uuid)') is not null,
      'create_group_conversation',
        to_regprocedure('public.create_group_conversation(text)') is not null,
      'add_group_member',
        to_regprocedure('public.add_group_member(uuid,uuid)') is not null,
      'remove_group_member',
        to_regprocedure('public.remove_group_member(uuid,uuid)') is not null,
      'leave_conversation',
        to_regprocedure('public.leave_conversation(uuid)') is not null,
      'rename_group',
        to_regprocedure('public.rename_group(uuid,text)') is not null,
      'set_conversation_role',
        to_regprocedure('public.set_conversation_role(uuid,uuid,text)') is not null,
      'get_conversation_members',
        to_regprocedure('public.get_conversation_members(uuid)') is not null,
      'get_messages',
        to_regprocedure('public.get_messages(uuid,bigint,integer)') is not null,
      'send_message',
        to_regprocedure('public.send_message(uuid,text)') is not null,
      'edit_message',
        to_regprocedure('public.edit_message(uuid,text)') is not null,
      'delete_message',
        to_regprocedure('public.delete_message(uuid)') is not null,
      'mark_conversation_read',
        to_regprocedure('public.mark_conversation_read(uuid,uuid)') is not null,

      -- Presence (consent-based).
      'heartbeat_presence',
        to_regprocedure('public.heartbeat_presence(text,text)') is not null,
      'set_presence_preferences',
        to_regprocedure('public.set_presence_preferences(boolean,boolean)') is not null,
      'get_friend_presence_v2',
        to_regprocedure('public.get_friend_presence_v2()') is not null,
      'heartbeat_media_presence',
        to_regprocedure('public.heartbeat_media_presence(text,text,text)') is not null,

      -- Live-room co-watching (Phase 30/32 membership source).
      'heartbeat_live_room_social',
        to_regprocedure('public.heartbeat_live_room_social(text,text)') is not null,
      'list_live_room_co_watchers',
        to_regprocedure('public.list_live_room_co_watchers(text)') is not null,
      'leave_live_room_social',
        to_regprocedure('public.leave_live_room_social(text)') is not null,

      -- Room media + comms (Phase 32).
      'get_room_comms_capabilities',
        to_regprocedure('public.get_room_comms_capabilities()') is not null,
      'publish_room_media_descriptor',
        to_regprocedure('public.publish_room_media_descriptor(text,bigint,jsonb)') is not null,
      'get_room_media_descriptor',
        to_regprocedure('public.get_room_media_descriptor(text)') is not null,
      'report_media_readiness',
        to_regprocedure('public.report_media_readiness(text,bigint,text)') is not null,
      'get_media_readiness_roster',
        to_regprocedure('public.get_media_readiness_roster(text,bigint)') is not null,
      'send_rtc_signal',
        to_regprocedure('public.send_rtc_signal(text,uuid,text,text,text,text)') is not null,
      'fetch_rtc_signals',
        to_regprocedure('public.fetch_rtc_signals(text,bigint)') is not null,

      -- Rooms, invites, notifications, library.
      'get_room_by_code',
        to_regprocedure('public.get_room_by_code(text)') is not null,
      'invite_friend_to_room',
        to_regprocedure('public.invite_friend_to_room(text,uuid)') is not null,
      'respond_room_invite',
        to_regprocedure('public.respond_room_invite(uuid,boolean)') is not null,
      'list_room_invites',
        to_regprocedure('public.list_room_invites()') is not null,
      'count_unread_notifications',
        to_regprocedure('public.count_unread_notifications()') is not null,
      'list_notifications',
        to_regprocedure('public.list_notifications(integer)') is not null,
      'export_media_library',
        to_regprocedure('public.export_media_library()') is not null
    ),
    'realtimeTables', public.runtime_realtime_tables()
  );
$$;

grant execute on function public.runtime_capabilities_v2() to anon, authenticated;

-- Rollback (manual):
--   drop function if exists public.runtime_capabilities_v2();
--   drop function if exists public.runtime_realtime_tables();
--   drop function if exists public.runtime_schema_generation();
-- social_diagnostics() is untouched and remains the fallback for old clients.
