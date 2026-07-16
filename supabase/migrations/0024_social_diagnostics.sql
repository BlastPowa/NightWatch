-- Phase 31: one-call social deployment/authentication diagnostic.
--
-- The v0.1.25 capability probe treats an RPC as deployed whenever the error is
-- not 42883/42P01, so it cannot tell "you are not signed into NightWatch" from
-- "the database is missing a migration" — and users who connected a YouTube
-- account reasonably believed they were signed in. Every social control then
-- looks uniformly broken.
--
-- social_diagnostics() answers, in a single round trip:
--   * hasSession — whether the caller carries a NightWatch (Supabase) session;
--   * one boolean per social RPC the client depends on;
--   * realtimeTables — which social tables are in the supabase_realtime
--     publication (room chat/reactions use Broadcast and do not appear here).
--
-- It is deliberately callable WITHOUT a session (granted to anon) because its
-- whole purpose is explaining why authenticated calls would fail. It returns
-- deployment facts and the caller's own auth state — nothing about any user.
-- The client maps: this RPC missing (42883) => old deployment; hasSession
-- false => show "NightWatch account required"; a false function flag => name
-- the missing migration; a network error => offline.

create or replace function public.social_diagnostics()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'version', 1,
    'hasSession', auth.uid() is not null,
    'functions', jsonb_build_object(
      'get_social_graph',
        to_regprocedure('public.get_social_graph()') is not null,
      'send_friend_request',
        to_regprocedure('public.send_friend_request(uuid)') is not null,
      'list_conversations',
        to_regprocedure('public.list_conversations()') is not null,
      'create_direct_conversation',
        to_regprocedure('public.create_direct_conversation(uuid)') is not null,
      'create_group_conversation',
        to_regprocedure('public.create_group_conversation(text)') is not null,
      'send_message',
        to_regprocedure('public.send_message(uuid,text)') is not null,
      'get_messages',
        to_regprocedure('public.get_messages(uuid,bigint,integer)') is not null,
      'get_conversation_members',
        to_regprocedure('public.get_conversation_members(uuid)') is not null,
      'get_friend_presence_v2',
        to_regprocedure('public.get_friend_presence_v2()') is not null,
      'heartbeat_live_room_social',
        to_regprocedure('public.heartbeat_live_room_social(text,text)') is not null,
      'list_live_room_co_watchers',
        to_regprocedure('public.list_live_room_co_watchers(text)') is not null,
      'leave_live_room_social',
        to_regprocedure('public.leave_live_room_social(text)') is not null
    ),
    'realtimeTables', coalesce(
      (
        select jsonb_agg(tablename order by tablename)
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename in ('messages', 'friend_requests')
      ),
      '[]'::jsonb
    )
  );
$$;

grant execute on function public.social_diagnostics() to anon, authenticated;

-- Rollback (manual):
--   drop function if exists public.social_diagnostics();
