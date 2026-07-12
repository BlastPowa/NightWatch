# Phase 20 UI/Backend Handoff — Social, Messaging, Moments, Creator Club

Owner: Opus/backend lane. Frontend owner: Codex. Base all work on `origin/main` after v0.1.16.

## Delivery gates

Expose readiness through a typed `SocialCapabilities` result, defaulting every flag to false on error. The frontend must hide, not disable, unfinished navigation.

```ts
interface SocialCapabilities {
  friends: boolean;
  messaging: boolean;
  momentNotes: boolean;
  creatorClubs: boolean;
}
```

Deliver in two backend PRs: Phase 20B (friends/messages/moments/profile borders), then Phase 20C (creator clubs/bounties). Do not change playback, queue, or existing room event payloads.

## Phase 20B schema

- `friend_requests(id, sender_id, recipient_id, status, created_at, responded_at)`. Status: `pending|accepted|declined|cancelled`; one live request per pair.
- `friendships(user_low, user_high, created_at)`. Canonically ordered UUID pair; unique; mutual relationship only.
- `user_blocks(blocker_id, blocked_id, created_at)`. Blocking removes friendship/pending requests and prevents discovery, presence, invites, messages, and friends-only notes in both directions.
- `presence_preferences(user_id, share_online, share_activity, updated_at)`. Both false by default. Activity exposes only `offline|online|watching|in_party`, optional video title, and timestamp; never room code.
- `conversations(id, kind, title, owner_id, created_at, updated_at)`. Kind: `direct|group`.
- `conversation_members(conversation_id, user_id, role, joined_at, last_read_message_id, left_at)`. Role: `owner|moderator|member`; maximum 30 active members enforced transactionally.
- `messages(id, conversation_id, sender_id, kind, body, created_at, edited_at, deleted_at)`. Kind: `message|system`; body 1–2,000 characters; soft delete only.
- `video_moment_notes(id, author_id, video_id, position_seconds, visibility, room_code, body, emoji, created_at, updated_at, deleted_at)`. Visibility: `private|friends|room`; body 0–500; emoji allowlisted; room visibility requires a persistent room relationship.
- Extend `player_stats` with `selected_border_id` and add an allowlisted border catalog/unlock relation. Server validates the selected border is unlocked.

## Phase 20B RPCs and services

- Friend discovery returns accepted friends, incoming/outgoing requests, and Phase 19 co-watcher suggestions separately.
- Atomic request transitions: send, accept, decline, cancel, remove friend, block, unblock. Every transition is idempotent and block-aware.
- Presence heartbeat/read RPCs return consent-filtered accepted-friend activity only.
- Conversation RPCs: create direct, create group, list conversations with unread count, fetch messages by cursor, send/edit/delete message, mark read, rename group, add/remove member, leave group, transfer ownership.
- Moment RPCs: list by video/cursor with visibility enforcement, create, edit, delete. Clamp timestamp to non-negative finite values; client still validates against known duration.
- Profile RPCs: list unlocked borders and select border.
- Typed result union for frontend services: `ok|unauthenticated|forbidden|blocked|rate-limited|offline|not-ready|error`.

Realtime channels must authorize membership/friendship server-side. Do not put private message bodies, room codes, or tokens in presence payloads.

## Phase 20B RLS and limits

- Users can read only friendship/request rows involving themselves; blocked relationships override every other permission.
- Conversation rows/messages are readable only by active members. Only active members send; only sender edits/deletes own message; group owner/moderator controls membership; owner cannot leave without transfer or disband.
- Direct conversations require accepted friendship. Group invites require accepted friendship with the inviter. Enforce 30 active members in the database.
- Rate limits: friend requests 20/day, messages 30/minute/conversation/user, group creation 5/day, moment writes 20/minute/user.
- Private notes: author only. Friends notes: accepted friends excluding blocks. Room notes: signed-in participants/owner of the referenced persistent room.
- Add indexes for request inbox, friendships by both users, conversation membership, message cursor, video/timestamp, and room notes.

## Phase 20C creator schema/API

- `creator_clubs`, `creator_club_members`, `creator_bounties`, `bounty_submissions`, `bounty_votes`, `creator_reports`, `creator_audit_log`, and notifications.
- Roles: owner, moderator, member. Status transitions are explicit and audited. One vote per eligible user/submission or bounty according to the finalized endpoint.
- Backend capabilities remain false until migrations, RLS, RPCs, moderation, and tests are deployed.
- No payments, cash rewards, YouTube account scopes, downloads, subscriptions, or channel administration.

## Acceptance

- Migration rollback notes and RLS tests accompany each PR.
- Test blocked-user isolation, group cap under concurrent joins, unread cursors, soft deletion, pagination stability, note visibility, presence opt-out, border validation, and creator moderation.
- Run strict typecheck, Activity build, Electron build with `--publish never`, and migration validation before handoff.
