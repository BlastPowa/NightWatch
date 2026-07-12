# Codex Handoff — living document

**This is the file to read first.** It is kept current as the backend lane works; the `PHASE_20*_BACKEND_STATUS.md` files remain accurate as detailed API references, but this file is the state of the world.

Last updated: 2026-07-12. Backend branch in flight: `backend/phase-21-completion`.

---

## The one thing that matters

`v0.1.18` ships **eight migrations and eight typed social services that no user can reach.** There is not a single Phase 20 UI component in `main` — no friends list, no DM view, no moment notes, no borders, no clubs, no bounties, no notification bell. Every capability flag is false because nothing renders behind it.

**The backend is not the bottleneck. The UI is.** Nothing else on any list below comes close in value to making Phase 20 visible.

---

## Backend: what is live in `main` (v0.1.18)

| Migration | Applied | What it gives you |
| --- | --- | --- |
| `0006`–`0009` | ✅ | Friends, blocks, presence consent, conversations, messages (`seq` cursor), moment notes, borders |
| `0010` | ✅ | Realtime publication for `messages` + `friend_requests` |
| `0011`–`0012` | ✅ | Creator clubs, bounties (audited status machine), submissions, votes, moderation, audit log |
| `0013` | ✅ | Notification emitters + the bell (`count_unread_notifications`, realtime) |

Services in `src/lib/social/`: `types`, `capabilities`, `FriendService`, `PresenceService`, `MessagingService`, `MomentsService`, `ProfileService`, `CreatorService`, `SocialRealtime`.

API detail lives in `PHASE_20B_BACKEND_STATUS.md`, `PHASE_20C_BACKEND_STATUS.md`, `PHASE_20D_BACKEND_STATUS.md`. Read those before building against a service.

---

## Backend: in flight on `backend/phase-21-completion`

### `0014_system_messages.sql` — **not yet applied** (owner action below)

Groups were silent about their own membership: people appeared and vanished from the member list with no record of who added or removed whom. `messages.kind = 'system'` existed since `0006` and nothing ever wrote one.

Now emitted, as AFTER triggers so no path can skip them:

- `Alice added Bob` / `Bob joined the group` / `Carol rejoined the group`
- `Carol left the group` vs `Alice removed Carol` — **leaving and being removed are different events**, and the line names who did it
- `Bob is now a moderator` / `Bob is now the owner`
- `Alice renamed the group to "Horror Night"`

**What you must do with them:** render `kind === 'system'` as a centred, muted notice — not as a chat bubble with an avatar. They are real `messages` rows: they carry a `seq`, they arrive over the existing `subscribeToConversation()` stream, and they occupy cursor slots. **Do not filter them out**, or your paging will drift.

Bodies are prose written at the time of the event, in the display names as they were then. A later rename does not rewrite history — that is deliberate.

### `set_conversation_role()` — new RPC, closes a real gap

`conversation_members.role` existed and the RLS policies checked it, but **no RPC could ever set it**. Every group was owner-plus-members forever; "owner/moderator controls membership" was a rule only one person could satisfy. Found while testing `0014`.

```ts
import { setConversationRole } from '@/lib/social/MessagingService';
await setConversationRole(conversationId, userId, 'moderator'); // or 'member'
```

**Owner-only.** A moderator cannot appoint moderators — that is how a group gets taken over by whoever was trusted first. Ownership still moves through `transferOwnership()`.

### Unit tests + CI gate

`npm test` now exists (vitest). 21 tests cover room-code generation/validation, the unambiguous alphabet, deterministic `deriveRoomCode` (load-bearing for the Discord Activity — two members of one voice channel must derive the same code), deep-link parsing, and YouTube URL extraction including lookalike-host rejection.

`npm test` runs in `feature-pr.yml` **before** the builds, so a broken PR now fails fast. Add tests alongside anything you write in `shared/` — that is where pure, testable logic belongs.

---

## What Codex owns (nothing here is started)

In the order I would build it:

1. **Friends** — list, incoming/outgoing requests, block/unblock, and the co-watcher suggestions. `getSocialGraph()` returns four separate collections; a suggestion is a Phase 19 co-watcher, **not** a friend. Do not merge them.
2. **Presence consent UI** — `share_online` and `share_activity` both default false, and nothing surfaces a friend's presence until they opt in. Without this screen presence is permanently invisible.
3. **Direct messages + groups** — page by `seq`, never `createdAt`. Reconcile realtime inserts by `id`/`seq` or you will double-render. Soft-deleted messages still arrive with an empty body: render a tombstone.
4. **The notification bell** — `countUnreadNotifications()` + `subscribeToNotifications()`. Keep a default branch when switching on `kind`.
5. **Moment notes**, **profile borders**, then **creator clubs/bounties/moderation** — the largest surface, and fine to land last.

Gate every surface on `getSocialCapabilities()` and **hide**, do not disable, anything false. Call `resetSocialCapabilities()` on sign-in/sign-out.

### Known frontend bug, unowned

**`DiscoveryPanel.tsx` has two competing paging systems.** The frontend lane added client-side `visibleCount` windowing while the backend lane added server-side Show More (a cursor from the `search-youtube` Edge Function). They overlap and nobody reconciled them. Server paging is the correct one — Show More costs zero YouTube quota because it slices a cached 48-result fetch. Please pick one.

---

## Owner actions (Blast)

1. **Apply `supabase/migrations/0014_system_messages.sql`** in the Supabase SQL Editor, then run `supabase/tests/phase21_system_messages_test.sql`. Expect `ALL PHASE 21 SYSTEM MESSAGE TESTS PASSED`. The test rolls back — safe against the live project.
2. **Confirm `0010` really is in the realtime publication.** It was merged in code and I have never seen it verified against the database. If it is missing, every realtime subscription connects and then silently receives nothing — no error anywhere.
   ```sql
   select tablename from pg_publication_tables
   where pubname = 'supabase_realtime'
     and tablename in ('messages', 'friend_requests', 'notifications');
   ```
   Three rows is correct. Fewer means the corresponding migration was not applied.
3. **Merge `backend/phase-21-completion`** once the above passes. CI opens the PR automatically on push.

---

## Still open, not started

- **Club discovery** — create / join-by-id / list-mine only. No public directory, deliberately: a directory needs its own moderation story first.
- **Highlight-reel export** — scoped in Phase 16, never built.
- **Presence is poll-only** — a heartbeat table fits `postgres_changes` badly (it would replay a row per heartbeat per friend). Poll it on an interval.
- **International latency verification** (ADR-017) — scoped in Phase 12, never done. Needs a real high-latency client, so it is an owner task, not a code task.
- **Notification digest/expiry** — fine at current scale; a large club fans out one row per member per bounty open.
