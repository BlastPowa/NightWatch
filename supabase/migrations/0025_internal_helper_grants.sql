-- Phase 31: lock down internal helper functions.
--
-- Postgres grants EXECUTE on every new function to PUBLIC by default, and no
-- migration ever revoked it, so every internal helper has been directly
-- callable through PostgREST by any client — including anonymous ones.
-- Verified against production on 2026-07-16: an anon request could call
-- is_blocked(a, b) and are_friends(a, b) for ARBITRARY user ids, exposing the
-- block and friendship graphs, plus under_limit_*() rate state and
-- display_name_of() for any user id.
--
-- None of these are part of the client contract (the app calls only the
-- granted RPCs), and all internal callers are security-definer functions or
-- security-definer triggers that execute as the owner, so revoking client
-- execute breaks nothing.
--
-- Exceptions, kept deliberately callable:
--   * is_active_member / is_club_member / is_club_staff — RLS policies on
--     conversations/messages/clubs call them AS THE QUERYING ROLE, so
--     authenticated must keep EXECUTE. anon keeps nothing.
--   * safe_avatar_url(text) / is_youtube_video_id(text) — pure validators,
--     explicitly granted to authenticated in 0021; they take no user id and
--     reveal nothing. PUBLIC/anon are still removed.

-- Relationship predicates: the block and friendship graphs.
revoke execute on function public.is_blocked(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.are_friends(uuid, uuid) from public, anon, authenticated;

-- Access predicates.
revoke execute on function public.can_access_room(uuid, text) from public, anon, authenticated;

-- Rate-limit probes: activity inference about any user.
revoke execute on function public.under_limit_friend_requests(uuid) from public, anon, authenticated;
revoke execute on function public.under_limit_messages(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.under_limit_groups(uuid) from public, anon, authenticated;
revoke execute on function public.under_limit_moments(uuid) from public, anon, authenticated;
revoke execute on function public.under_limit_clubs(uuid) from public, anon, authenticated;
revoke execute on function public.under_limit_reports(uuid) from public, anon, authenticated;
revoke execute on function public.under_limit_room_invites(uuid) from public, anon, authenticated;

-- Identity resolvers for arbitrary user ids.
revoke execute on function public.display_name_of(uuid) from public, anon, authenticated;
revoke execute on function public.safe_display_name(uuid) from public, anon, authenticated;
revoke execute on function public.safe_avatar_url(uuid) from public, anon, authenticated;
revoke execute on function public.validated_border(uuid) from public, anon, authenticated;

-- Plumbing.
revoke execute on function public.require_auth() from public, anon, authenticated;

-- Policy-bound membership helpers: authenticated stays (RLS evaluates these
-- as the querying role); PUBLIC and anon are removed.
revoke execute on function public.is_active_member(uuid, uuid) from public, anon;
revoke execute on function public.is_club_member(uuid, uuid) from public, anon;
revoke execute on function public.is_club_staff(uuid, uuid) from public, anon;
grant execute on function public.is_active_member(uuid, uuid) to authenticated;
grant execute on function public.is_club_member(uuid, uuid) to authenticated;
grant execute on function public.is_club_staff(uuid, uuid) to authenticated;

-- Pure validators: keep the 0021 authenticated grants, drop PUBLIC/anon.
revoke execute on function public.safe_avatar_url(text) from public, anon;
revoke execute on function public.is_youtube_video_id(text) from public, anon;
grant execute on function public.safe_avatar_url(text) to authenticated;
grant execute on function public.is_youtube_video_id(text) to authenticated;

-- Rollback (manual): re-granting EXECUTE to PUBLIC restores the previous
-- (leaky) behaviour; there is no data change to undo.
