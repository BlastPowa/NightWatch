# Phase 20B — Backend Status (for the frontend lane)

Branch: `backend/phase-20b-social`, based on `origin/main` @ v0.1.16.
Backend lane: **complete. Migrations 0006–0009 applied, acceptance test green.**
Phase 20C: **not started** (deliberately — the handoff gates it on 20B being done).

---

## What exists now

Four migrations and five client services. **No UI** — that is yours.

| Migration | Contents |
| --- | --- |
| `0006_social_phase20b.sql` | Tables + RLS: `friend_requests`, `friendships`, `user_blocks`, `presence_preferences`, `conversations`, `conversation_members`, `messages`, `video_moment_notes`, `profile_borders`, `player_border_unlocks`. Adds `player_stats.selected_border_id`. Rate-limit helpers. |
| `0007_social_rpcs.sql` | All RPCs: social graph, friend transitions, presence, conversations/messages, moment notes, borders. |
| `0008_message_ordering.sql` | Adds `messages.seq` (monotonic) and moves the unread count + message cursor onto it. |
| `0009_fix_social_graph.sql` | Fixes a plpgsql variable/column ambiguity (42702) in `get_social_graph`. |
| `0010_social_realtime.sql` | Adds `messages` + `friend_requests` to the realtime publication; `replica identity full`. |

| Service (`src/lib/social/`) | Exposes |
| --- | --- |
| `types.ts` | `SocialResult<T>` — the result union. |
| `capabilities.ts` | `getSocialCapabilities()`, `resetSocialCapabilities()`. |
| `FriendService.ts` | `getSocialGraph()`, send/accept/decline/cancel, `removeFriend`, `blockUser`, `unblockUser`. |
| `PresenceService.ts` | `heartbeat()`, `setPresencePreferences()`, `getFriendPresence()`. |
| `MessagingService.ts` | conversations, messages, group membership/ownership. |
| `MomentsService.ts` | `listMomentNotes()`, create/edit/delete, `clampPosition()`. |
| `ProfileService.ts` | `listBorders()`, `unlockBorder()`, `selectBorder()`. |
| `SocialRealtime.ts` | `subscribeToConversation()`, `subscribeToFriendRequests()`. |

---

## Contract you build against

**Every service returns `SocialResult<T>`** — never a raw throw, never a Postgres string:

```ts
type SocialResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'unauthenticated' } | { status: 'forbidden' }
  | { status: 'blocked' }         | { status: 'rate-limited' }
  | { status: 'offline' }         | { status: 'not-ready' }
  | { status: 'error' };
```

`not-ready` means the migration is not deployed. Treat it as "hide the feature", not "show an error".

**Gate every social surface on capabilities.** All flags default `false`; `creatorClubs` is hard-false until 20C ships.

```ts
const caps = await getSocialCapabilities();
// { friends, messaging, momentNotes, creatorClubs }
```

Per the handoff: **hide** unfinished navigation, do not disable it. Call `resetSocialCapabilities()` on sign-in/sign-out — capabilities are false for guests, since every social surface needs an account.

### Four things that will bite you if you assume otherwise

1. **`getSocialGraph()` returns four separate collections** — `friends`, `incoming`, `outgoing`, `suggestions`. A suggestion is a Phase 19 co-watcher, **not** a friend. Do not merge them into one list.
2. **Message paging uses `seq`, not `createdAt`.** Pass the lowest `seq` you hold to `getMessages(id, beforeSeq)`. `created_at` is the transaction timestamp and can tie; ordering by it is not stable.
3. **Presence never carries a room code.** By design — it tells you a friend is watching, not where to join them. Do not build a "jump to their room" affordance on it; there is nothing to jump to.
4. **Soft-deleted messages still arrive**, with `deletedAt` set and `body: ''`. Render a tombstone; do not filter them out, or your cursor will drift.

### Realtime

Chat is live. Fetch a page, then subscribe; both return an unsubscribe fn.

```ts
const unsubscribe = subscribeToConversation(conversationId, (change) => {
  // change.type: 'insert' | 'update'   (an edit and a soft delete are both 'update')
  // change.message: Message
});

const stop = subscribeToFriendRequests(() => {
  // Something changed. Re-read getSocialGraph() — do NOT act on a raw row,
  // because the graph RPC is what applies the block filter.
});
```

These are `postgres_changes` subscriptions, not broadcast. Authorisation is the **same RLS policy** the REST path uses, so a subscriber cannot receive a row they could not already have fetched, and removing someone from a conversation cuts their stream server-side with no client cooperation. That is what satisfies the handoff's "authorise membership/friendship server-side" requirement.

Two consequences for you:

- **Reconcile by `seq`, not by arrival order.** A realtime insert can race the fetch that was already in flight. Merge on `id`/`seq` rather than appending blindly, or you will double-render a message.
- **An `update` may be a soft delete.** Check `deletedAt`; the body arrives empty.

### Consent (changed behaviour — expect user-visible regression)

`player_stats.share_stats` **now defaults to `false`, and all existing rows were reset to `false`.** Phase 18 defaulted it true, which contradicted the handoff's mandate that presence consent default false; two opt-in surfaces with opposite defaults is how privacy incidents happen.

Consequence: **the leaderboard and co-watcher suggestions are empty until users re-opt-in** in My Card. This is intended, not a bug to fix. The existing toggle in `UserCard.tsx` is the re-consent surface.

Presence has its own separate consent: `share_online` (status) and `share_activity` (video title), both default false. You need a UI for these — nothing surfaces a friend's presence until they opt in.

---

## What needs to be pushed / run

The branch is committed locally but **not pushed**, and the acceptance test has **not passed yet**.

### 1. Apply the migrations (Supabase SQL Editor, in order)

`0006`–`0009` are applied. **`0010_social_realtime.sql` is NOT — apply it**, or every realtime subscription will connect and then silently receive nothing (Realtime only replays tables in the publication):

```
supabase/migrations/0010_social_realtime.sql
```

If you are rebuilding the database from scratch, apply all of them in numeric order.

Close the running NightWatch app first. `0006` deadlocked once because the app polls `player_stats` while `ALTER TABLE` holds an exclusive lock; the migrations now set `lock_timeout` and touch `player_stats` last, but an idle app is still the safest way to run DDL.

### 2. Run the acceptance test

```
supabase/tests/phase20b_rls_test.sql
```

It impersonates users via `request.jwt.claims`, asserts, and **rolls back** — safe against the live project. Expect `ALL PHASE 20B TESTS PASSED`. Any failure aborts naming the case.

It covers: blocked-user isolation in both directions, the 30-member group cap (including refilling a freed slot), unread cursors, seq ordering under a `created_at` tie, soft deletion preserving cursor slots, moment-note visibility across friend/non-friend/blocked, presence opt-out, and border validation.

**Status: PASSING** against the live project (`ALL PHASE 20B TESTS PASSED`).

It found two real defects on the way there, both fixed — neither would have been caught by a typecheck or a build:

1. `unread_count drops after marking read` — messages sharing a `created_at` (it is the *transaction* timestamp) were never counted, and the UUID tiebreak made ordering non-deterministic, so cursor paging could skip or repeat a message. Fixed by `0008` (monotonic `seq` cursor).
2. `blocked user is absent from the blocker graph` — `42702`, a plpgsql variable/column ambiguity: in a `RETURNS TABLE` function the OUT names are also variables, and `get_social_graph` had a bare `created_at`. It would have thrown for **any** user who had blocked someone. Fixed by `0009`.

Re-run this file after any change to the social RPCs.

### 3. Push and open the PR

```
git push -u origin backend/phase-20b-social
```

Then open the PR against `main` from the GitHub UI.

### 4. Verification gates (from the handoff)

```
npm run typecheck
npm run build
```

Both pass locally as of the last commit. The handoff also asks for an Activity build and an Electron build with `--publish never`; `npm run build` covers all three targets.

---

## Commits on this branch

```
fe7a331  docs: add Phase 20 UI/backend handoff
eca3c13  feat(db): add Phase 20B schema, RLS, and RPCs
ebcfe21  feat: add Phase 20B social services and capability gate
6a2d2e2  fix(db): avoid deadlock on player_stats in 0006
eaeef46  fix(db): order messages by sequence, not timestamp
```

---

## Known gaps / honest caveats

- **The SQL has never been executed by me.** There is no `psql` in the dev environment and the anon key cannot run DDL, so the migrations are reviewed but machine-unverified. `0006`/`0007` applied cleanly when the owner ran them; `0008` is untested.
- **Group `system` messages are not emitted.** The `messages.kind = 'system'` column exists, but nothing writes join/leave/rename notices yet.
- **Realtime covers messages and friend requests only.** Presence is still poll-on-demand via `getFriendPresence()` — a heartbeat table is a poor fit for `postgres_changes` (it would replay a row on every heartbeat of every friend). Poll it on an interval.
- **`unlock_border` trusts the client's achievement claim** insofar as achievements are themselves client-authoritative (ADR-009). Borders are cosmetic, so this is an accepted trade rather than an oversight.
