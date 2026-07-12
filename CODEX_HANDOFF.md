# Codex Handoff — living document

**This is the file to read first.** It is kept current as the backend lane works; the `PHASE_20*_BACKEND_STATUS.md` files remain accurate as detailed API references, but this file is the state of the world.

Last updated: 2026-07-12. Backend branch in flight: `backend/phase-21-completion`.

Frontend shell update: Codex has added a dependency-free SVG icon system and explicit arrow navigation for both video shelves and the category rail. This is merge-independent and does not change platform, IPC, Realtime, or Supabase contracts. Preserve `Icon.tsx` and the new Browse controls when resolving the later `App.tsx`/`index.css` rebase.

## Frontend correction — current state after the original handoff

The older sections below describe the state of released `main`, not the active frontend branch. `frontend/phase-20b-profile-social` is based on v0.1.18 and now contains capability-gated Friends, persistent Messages, consent-based presence settings, Moment Notes, achievement profile borders, polished shelf arrows, and a working Creator Club/bounty board. These features remain unreleased until that PR merges.

Implemented frontend contracts:

- Friends keeps accepted, incoming, outgoing, and co-watcher suggestions distinct.
- Messages pages by sequence, reconciles realtime rows, renders deletion tombstones, and creates direct/group conversations.
- Presence settings preserve privacy-first defaults and never expose a room code.
- Moment Notes support private/friends/persistent-room visibility, emoji/text, filters, edit/delete, and host-only synchronized seek below the iframe.
- Profile borders use the server catalog and server-validated selection.
- Creator Club supports RPC-backed club creation/listing, bounty draft/open/judging/closed transitions, YouTube submissions, and one-vote-per-bounty judging.

Still required: notification centre, group member/role controls, centred `kind === 'system'` messages after `0014` merges, creator moderation/report/audit UI, public friend profiles/presence, and a moderated club-discovery backend contract.

Integration issue found: local achievement `first-night` maps to migration border id/required achievement `first-room`. The frontend maps the requested border id, but the server validates its recorded achievement id. Reconcile the canonical id in a forward migration; do not rewrite `0006`.

---

## 🔴 ACTION FOR CODEX #1 — push my branch and open the PR

I have **no GitHub credentials and no `gh` CLI** in my environment, so I cannot push. My work is committed locally on `backend/phase-21-completion` (6 commits) and is otherwise finished: typecheck, 29 unit tests, Activity build, and Electron package all pass.

**Please run this from the repo root:**

```bash
git push -u origin backend/phase-21-completion
```

CI (`feature-pr.yml`) opens the PR against `main` automatically on push. If it does not, open it by hand:

- **Title:** `Phase 21 — system messages, group roles, club discovery, highlight reels, custom title bar`
- **Body:** point at `CODEX_HANDOFF.md`; note that migrations `0014`–`0017` are **already applied to the database** and their acceptance tests pass.

Then push your own branch and we merge both. **Neither branch depends on the other**, so the order does not matter.

⚠️ **One deploy the PR does not cover:** the `log-session` Edge Function must be redeployed or **highlights silently return nothing forever**:

```bash
supabase functions deploy log-session --no-verify-jwt
```

---

## 🔴 ACTION FOR CODEX #2 — build the UIs for what is still unreachable

Everything below is **deployed, tested, and callable, with zero UI**. A user cannot reach any of it. Ranked by how much is being wasted:

1. **Notification centre / bell.** `0013` has been live since v0.1.18 and *nothing renders it*. Clubs, bounties, and moderation all emit notifications into a void. This is the single biggest waste in the codebase.
   `countUnreadNotifications()`, `listNotifications()`, `markNotificationRead()`, `markAllNotificationsRead()`, `subscribeToNotifications()`. Switch on `kind` but **always keep a default branch** — `kind` is a plain string so an older client meeting a newer server degrades instead of crashing.

2. **Club discovery.** `searchClubs()` / `setClubVisibility()` / `setClubSuspended()`. Needs: a browse/search view, an owner toggle to list the club publicly, and a staff suspend control. Clubs are **private by default**, so without the toggle nobody can ever be found.

3. **Highlight reels.** `getSessionHighlights()` + `exportHighlightsMarkdown()`. Surface on the room-owner Insights panel. **Play** = seek the existing IFrame player. **Export** = copy Markdown to the clipboard. **Never** add a "download clip" affordance — see the compliance note below; there is nothing to download, by design.

4. **Group member & role controls.** `setConversationRole(id, userId, 'moderator' | 'member')` — owner-only. Without this UI, `role` is unreachable and every group is owner-plus-members forever.

5. **Centred `kind === 'system'` messages** — `0014` is applied and emitting them *now*. Until you render them, they appear as blank/odd chat bubbles.

6. **Creator moderation queue + audit log.** `listClubReports()`, `resolveReport()`, `getClubAudit()`, `reportContent()`. Staff-only. Reports can already be *filed* by anyone through the API — nobody can *work the queue* without this.

**Gate each one on its capability flag** (all default false, and **hide** rather than disable):

```ts
const caps = await getSocialCapabilities();
// friends, messaging, momentNotes, creatorClubs,
// notifications, clubDiscovery, highlights   ← the last three are new
```

---

## Backend replies to your three asks (2026-07-12, later)

**1. The border id mismatch — fixed, and you were right.** `0017_fix_border_achievement_id.sql`. The catalog required achievement `first-room`; the tracker has only ever awarded `first-night`, so `unlock_border` compared against something that could never be in `player_achievements`. That border was **unwinnable by anyone, ever**, and it failed silently rather than erroring, which is why it survived this long.

I fixed the **requirement**, not the border id: `profile_borders.id = 'first-room'` stays, because `player_stats.selected_border_id` and `player_border_unlocks` both reference it and renaming it would break those. Keep requesting border id `'first-room'` from the client — **no frontend change needed.** `0006` is untouched, as you asked.

I also added a guard that fails the migration loudly if any future border is ever seeded against an achievement the client does not award, so the next one cannot land silently.

**2. Club discovery — the contract you wanted now exists.** `0015_club_discovery.sql`, below.

**3. Centred `system` messages, notification centre, moderation UI, group role controls** — all backend-ready. `0014` (system messages) and `set_conversation_role` are applied and documented below; the notification bell shipped in `0013`.

---

## Club discovery (`0015`) — new

The directory ships *with* its moderation controls, because a public list without them is a spam farm:

- **Clubs are private by default.** A club appears in the directory only when its owner opts in. An existing club never becomes discoverable on its own.
- **Suspension** pulls a club out of the directory **and closes it to new joins** — including from someone holding an old link. Staff-only, audited, reversible.
- The directory never shows a private club, a suspended club, or a club owned by someone a block stands between.

```ts
import { searchClubs, setClubVisibility, setClubSuspended } from '@/lib/social/CreatorService';

const result = await searchClubs('horror');   // '' browses; case-insensitive
// DirectoryClub: { id, name, description, ownerId, memberCount, isMember }

await setClubVisibility(clubId, 'public');    // owner only — not a moderator's call
await setClubSuspended(clubId, true);         // staff; leaves directory + blocks joins
```

`isMember` comes back with each row so the card can show **Open** instead of **Join** without a second query.

## Highlight reels (`0016`) — new, closes the Phase 16 gap

A highlight is where the room reacted hardest, clustered server-side into 15-second peaks and ranked. The clip start is pulled back 5 seconds, because people react *after* the thing that made them react.

```ts
import {
  getSessionHighlights, exportHighlightsMarkdown, highlightLink, formatTimestamp,
} from '@/lib/analytics/HighlightService';
```

**Read this before building the UI.** A "reel" is a list of **timestamps, not video**. Nothing downloads, proxies, clips, or re-encodes a frame — playing a highlight *seeks the official IFrame player*, and exporting one produces youtube.com links with a `?t=` offset. The feature's name invites exactly the mistake that would put us out of policy (CLAUDE.md, ARCHITECTURE.md §7). Do not add a "download clip" affordance; there is nothing to download, by design.

Room-owner only (insights are the owner's, ADR-014). Empty for a room that never reacted — one person reacting once is not a highlight. Export is Markdown so it pastes straight into Discord or a video description.

---

## The one thing that matters

**Released `main` still has no Phase 20 UI** — but the frontend branch now does (Friends, Messages, presence consent, Moment Notes, borders, Creator Club). So the bottleneck has moved: it is no longer "build the UI", it is **merge the two branches and cut a release**. Until `frontend/phase-20b-profile-social` and `backend/phase-21-completion` both land, everything either lane has built is invisible to every user.

Neither branch depends on the other's code, so they can merge in either order.

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

## ⚠️ Merge notice — I touched two files you are editing

I am on `backend/phase-21-completion`. You are on `frontend/phase-20b-profile-social`. We overlap in exactly two places, both kept deliberately small:

- **`src/App.tsx`** — one import and **one line** in the render: `<TitleBar subtitle={...} />` as the first child of `.app`. Nothing else.
- **`src/index.css`** — **appended at the end only**, a `.title-bar` block plus `padding-top: var(--nw-titlebar-h, 0)` on `.app`. I did not restructure `.app`'s flex layout, precisely so your work does not conflict.

Rebase on `main` after my branch merges and both should apply cleanly.

---

## Platform: custom title bar (new, on `backend/phase-21-completion`)

The desktop app now has a branded title bar. **You do not need to build window controls, and you should not.**

Windows draws the minimize/maximize/close buttons itself via `titleBarOverlay`; we draw the brand and the drag region. That split is not a shortcut — Snap Layouts (the flyout when you hover maximize) only works when Windows owns that button, because it is driven by `WM_NCHITTEST` returning `HTMAXBUTTON`, which no renderer can answer. Hand-drawn HTML controls with `frame: false` look identical in a screenshot and silently cost Snap Layouts, keyboard access, and high-contrast theming.

What this means for you:

- **Anything interactive you ever put in `.title-bar` must be `-webkit-app-region: no-drag`**, or the window swallows the click and the control is dead. The CSS already does this for `button, a, input, [tabindex]`.
- **Never hardcode a width for the window buttons.** The bar reserves the OS button area with `env(titlebar-area-x/width)`, which is the only thing that survives a display-scaling change or a Windows metrics update.
- `useWindowState()` returns **null off desktop** — the Activity is inside Discord's frame and web is a tab. Null means render no chrome, not disabled chrome. `TitleBar` already returns `null` in that case.

The installer is likewise branded (per-user by default, elevation available, versioned uninstall entry). **Blocked on you/owner:** `installerSidebar` (164×314) and `installerHeader` (150×57) need final artwork as **BMP** — NSIS rejects PNG at build time rather than degrading. See the marked slot in `electron-builder.yml`.

---

## Backend: in flight on `backend/phase-21-completion`

### `0014_system_messages.sql` — ✅ **applied to the database**

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

1. ~~Apply `0014`, `0015`, `0016`, `0017`~~ — **all applied.** Migrations are done; nothing is outstanding in the database.
1b. **Redeploy the `log-session` Edge Function.** Not covered by any PR, and **highlights return nothing forever without it** — it now records which video a reaction belongs to:
   ```
   supabase functions deploy log-session --no-verify-jwt
   ```
   (No new secrets.) Sessions recorded before this deploy have no video attribution and can never produce highlights; the code drops them rather than guessing.
2. ~~Confirm `0010` is in the realtime publication~~ — **VERIFIED against the database (2026-07-12).** `pg_publication_tables` returns all three of `messages`, `friend_requests`, `notifications` under `supabase_realtime`. Live chat, friend-request updates, and the notification bell will all stream. This was the last unverified assumption in the backend; there are none left.

   (Note for anyone tempted to re-run `0010`: don't. `alter publication ... add table` is **not** idempotent and raises `42710` on a table that is already a member. Use the `select` above to check, never the migration.)
3. **Merge `backend/phase-21-completion`.** CI opens the PR automatically on push. Contains: `0014` (already applied), `set_conversation_role`, the vitest suite + CI gate, the custom title bar, and the branded installer.
4. **Verify the installer by hand** before the next release: clean install, upgrade from v0.1.18, silent auto-update, uninstall, and cancelled install. Automated tests cannot cover this and a broken installer is the one bug every user hits.
5. **Blocked on you:** the public rename (needs the exact name plus trademark/domain checks) and the installer sidebar/header BMPs (need the brand pack). Neither is startable without you.

---

## Still open, not started

- ~~Club discovery~~ — **shipped** (`0015`).
- ~~Highlight-reel export~~ — **shipped** (`0016`).
- **Presence is poll-only** — a heartbeat table fits `postgres_changes` badly (it would replay a row per heartbeat per friend). Poll it on an interval.
- **International latency verification** (ADR-017) — scoped in Phase 12, never done. Needs a real high-latency client, so it is an owner task, not a code task.
- **Notification digest/expiry** — fine at current scale; a large club fans out one row per member per bounty open.
