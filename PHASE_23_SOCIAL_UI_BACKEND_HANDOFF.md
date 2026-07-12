# Phase 23 social profile backend handoff

This is the remaining backend contract required to complete the requested Friends/Profile experience. It does not change room playback, YouTube, queue, or existing Realtime event contracts.

## 1. Public profile read

Add a security-definer RPC such as `get_social_profile(p_user uuid)` returning a typed object with:

- `userId`, safe display name, Discord avatar URL or null;
- selected profile-border identifier only when that border is server-validated as unlocked;
- friendship state (`none`, `incoming`, `outgoing`, `accepted`);
- whether either party blocks the other, without revealing which direction when disclosure would leak privacy;
- opt-in public stats and achievement summaries only when the target shares them;
- mutual persistent rooms limited to rooms both users may already access, returning stable room ID/name but never a private room code;
- booleans for `canMessage` and `canInvite`.

RLS/RPC behavior must return explicit `ok`, `forbidden`, `blocked`, `not-ready`, `offline`, and error outcomes through the existing `SocialResult<T>` mapping.

## 2. Block management

Add `list_blocked_users()` returning the caller's blocked profiles with safe display name/avatar/border. Preserve existing `block_user` and `unblock_user` transitions. Blocked relationships must continue preventing messages, invitations, presence, friends-only notes, and profile details.

The UI cannot provide a complete unblock screen from transition RPCs alone; it must not keep a client-side shadow list.

## 3. Conversation member presentation

Extend the membership read or add `list_conversation_member_profiles(p_conversation uuid)` returning membership-authorized:

- `userId`, safe display name, avatar URL or null, selected validated border;
- group role and joined timestamp.

Only active members may read it. Removed/blocked users must disappear according to current membership/block policy. This replaces the current shortened-UUID fallback for non-friend group members.

## 4. Friend party invitation

If the product keeps a one-click **Invite** action, add an explicit RPC such as `invite_friend_to_room(p_friend uuid, p_room uuid)` that:

- requires accepted friendship and inviter room membership;
- respects blocks and the target's notification/privacy preferences;
- validates that the target can access the persistent room;
- creates an auditable notification/invitation without exposing the room code through presence;
- rate-limits repeated invitations and supports accept/decline/expiry.

Do not implement this as a raw room-code message or client-only notification.

## Acceptance/security tests

- Profile fields follow target privacy preferences and block state.
- Non-mutual private rooms never appear.
- Selected borders cannot be forged.
- Blocked users cannot read profiles, message, invite, see presence, or access friends-only notes.
- Only conversation members can list member profiles; removal revokes access.
- Invitation spam is rate-limited and expired/revoked invitations cannot be accepted.
- Tests run without requiring client secrets and preserve existing `SocialResult<T>` behavior.
