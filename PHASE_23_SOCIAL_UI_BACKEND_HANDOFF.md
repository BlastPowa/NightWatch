# Phase 23 social profile backend handoff

Frontend source of truth: `C:\Users\Blast\source\repos\NightWatch-ui\PHASE_23_SOCIAL_UI_BACKEND_HANDOFF.md` on `frontend/phase-22-runtime-fixes`.

Claude/Opus should implement only the server contracts below; the current frontend runtime fixes are already in progress and must not be duplicated.

## Required server contracts

1. Add a privacy-safe `get_social_profile(p_user uuid)` returning safe display name/avatar, server-validated selected border, friendship/block state, opt-in stats/achievements, mutual accessible persistent rooms (never private room codes), and `canMessage`/`canInvite` permissions.
2. Add `list_blocked_users()` so the frontend can render a complete unblock-management screen without a client shadow list.
3. Add a membership-authorized conversation-member profile read returning user ID, safe display name, avatar, validated selected border, role, and joined timestamp. The current frontend must fall back to a shortened UUID for non-friends.
4. If one-click friend invitations remain in scope, add an accepted-friend persistent-room invitation RPC with membership/access validation, privacy/block enforcement, notification preference checks, expiry, accept/decline/revoke, audit, and rate limiting. Never leak room codes through presence.

Use existing `SocialResult<T>` outcomes. Do not change playback, queue, room Realtime events, PlatformBridge, persistence keys, or the official YouTube iframe boundary.

## Required tests

- Target privacy and block state filter every profile field.
- Non-mutual private rooms never appear and selected borders cannot be forged.
- Blocked users cannot read profiles, message, invite, see presence, or access friends-only notes.
- Only active conversation members can read member profiles; removal revokes access.
- Invitations enforce friendship, access, expiry, revocation, and rate limits.
