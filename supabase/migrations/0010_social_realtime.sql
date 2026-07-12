-- Phase 20B realtime: live messages and friend requests.
-- Apply AFTER 0009_fix_social_graph.sql. Rollback notes at the bottom.
--
-- WHY postgres_changes AND NOT broadcast.
-- The handoff requires that realtime channels authorise membership/friendship
-- SERVER-side, and that private message bodies never travel in a presence or
-- broadcast payload. Broadcast is client-authoritative — whoever holds the
-- channel name can publish and subscribe, so the app would have to be trusted
-- to police its own membership. postgres_changes instead replays committed
-- rows through the SAME RLS SELECT policies the REST API uses:
--
--   messages        → messages_member_select  → is_active_member(...)
--   friend_requests → requests_involving_me   → sender/recipient is me
--
-- So a subscriber physically cannot receive a row they could not already have
-- SELECTed, and the payload is the database's row, not a client's claim. A
-- blocked or removed member stops receiving the moment their membership row
-- flips, with no client cooperation required.

-- Realtime only replays tables that are in this publication.
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.friend_requests;

-- Soft deletion and edits are UPDATEs, and RLS on an UPDATE event is evaluated
-- against the OLD row as well as the new one. Without FULL replica identity
-- the old row carries only the primary key, which is not enough for the policy
-- to authorise the event — subscribers would silently miss edits/deletes.
alter table public.messages replica identity full;
alter table public.friend_requests replica identity full;

-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
--   alter table public.friend_requests replica identity default;
--   alter table public.messages replica identity default;
--   alter publication supabase_realtime drop table public.friend_requests;
--   alter publication supabase_realtime drop table public.messages;
