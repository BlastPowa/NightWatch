# Codex Handoff — living document

**Read this first.** Rewritten as work lands; the `PHASE_20*_BACKEND_STATUS.md` files remain the detailed API reference.

Last updated: 2026-07-12, after `v0.1.19`.

---

## State

`main` is at **v0.1.19**, and **both lanes are merged into it** — all backend work (migrations `0006`-`0019`), the platform title bar, and your Friends / Messages / shelf navigation / Creator Club work. Thank you for pushing.

**Backend is complete as scoped.** Every phase through 21 is built, applied, and tested. No known gaps, no unverified assumptions.

CI **auto-merges** a lane branch once its build is green (drafts are respected). **Releases are owner-initiated** — a merge does not ship to users. Run `npm run lanes` to see what is unmerged or stale.

---

## ❓ Does the UI overhaul need anything from the backend?

If it needs a field, an RPC, a different shape, a sort order, or a count you are deriving client-side — **write it here and I will build it.**

**Do not work around a missing backend with client-side derivation.** A live example of why: you cannot work out whether your own club is listed by searching the public directory for it, because `search_clubs` also hides *suspended* clubs and *blocked* owners. "Absent from the directory" does not mean "private". Deriving state that a server-side filter already destroyed is how a toggle ends up lying to the person holding it. That is exactly what `0019` exists to prevent. **Ask instead.**

---

## ⚠️ I removed my scaffolds — yours won, and I fixed a bug in them

You shipped `NotificationCenter` and `CreatorClubScreen` (with directory + visibility) before my scaffolds merged, so `main` briefly had **two notification panels and two club surfaces**, both rendering. Yours are integrated and use the Icon system, so **mine are deleted**: `NotificationBell`, `ClubDiscoveryPanel`, `ClubSettingsPanel`, and the `Clubs` nav item are gone. Same story as `HighlightReelPanel` — yours survives, mine did not.

**A correctness bug in `CreatorClubScreen`, now fixed:** it decided whether a club was public by **searching the directory for it** and checking whether it came back. That is the exact trap `0019` exists to close. `search_clubs` also hides **suspended** clubs — so a suspended-but-public club reported as *private*, and clicking the toggle would then flip it the wrong way. It now reads `club.visibility` directly, which is authoritative.

Please **do not re-derive server state from a filtered list.** If a field is missing, ask me and I will add it — that is what `0019` was.

**Still unwired:** `setClubSuspended` has no caller anywhere. Staff have no way to suspend a club, so the moderation half of discovery does not exist yet.

---

## 🎨 Scaffold notes (components deleted, guidance still applies)

I built **deliberately plain** UIs for the features that had none, so they are reachable instead of sitting dead in the database. **This is groundwork, not design. Please redesign all of it.**

| Component | What it is |
| --- | --- |
| `NotificationBell.tsx` | Bell, unread badge, popover. Realtime, mark-read, dismiss, clear. |
| `ClubDiscoveryPanel.tsx` | Club directory: search, browse, join. New `Clubs` nav item. |
| `ClubSettingsPanel.tsx` | **Owner public/private toggle** + staff suspend. Fold into your club surface. |

The layout is intentionally dumb — flat lists, placeholder class names, and one block at the end of `index.css` marked `TEMPORARY SCAFFOLD` that you can delete wholesale.

**Redesigning is cheap by construction:** each component keeps its data logic in a hook (`useClubDirectory`, `useMyClubs`) returning plain state and actions. **Rebuild the markup around the hook and you never touch a service call.**

### Behaviour that must survive the redesign

- **Clubs are private by default**, so an empty directory is the **normal** early state, not an error. If it looks broken, people will conclude the feature is broken.
- **Do not client-side filter the club list.** The server already removed private, suspended, and blocked clubs; a client filter can only wrongly remove more.
- **Notifications: keep the `default` branch** when switching on `kind`. It is a plain string on the wire precisely so an older client meeting a newer server degrades instead of crashing.
- **Suspension is not a soft hide.** A suspended club leaves the directory *and stops accepting joins*, including from anyone holding an old invite link. Say so in the UI — a moderator who thinks they are quietly delisting a club is closing its doors.
- **Highlights are timestamps, never video.** Play seeks the IFrame player; export copies youtube.com `?t=` links. **Never add a "download clip" affordance.** Nothing downloads, proxies, or re-encodes a frame, and implying otherwise puts the project out of policy (CLAUDE.md), not merely out of scope.

### I deleted my highlights panel in favour of yours

You had already built `HighlightReelPanel`, wired to the player through `onSeek`. Mine was redundant and **both would have rendered in the same session view**. Yours is the one that survives.

---

## Still no UI at all

- **Moderation queue** — `listClubReports()`, `resolveReport()`, `getClubAudit()`. Reports can already be *filed* by anyone through the API; nobody can *work the queue*.
- **Group role controls** — `setConversationRole(id, userId, 'moderator' | 'member')`, owner-only. Without it every group is owner-plus-members forever.
- **Centred `kind === 'system'` messages** — `0014` is emitting them **now** (`Alice added Bob`, `Carol left the group`). Render as a centred muted notice, **not** a chat bubble. They are real `messages` rows carrying a `seq`: **do not filter them out**, or your cursor paging will drift.

---

## Owner actions (Blast)

1. **Apply `supabase/migrations/0019_list_my_clubs_visibility.sql`.** Without it the club toggle cannot show its own state. `0006`-`0018` are already applied.
2. **Redeploy the `log-session` Edge Function** — highlights return nothing without it, silently:
   ```
   supabase functions deploy log-session --no-verify-jwt
   ```
3. **Trigger a release** when you want v0.1.20 out (Actions → Release). Nothing ships automatically.
4. Blocked on you: the public rename (exact name + trademark/domain checks), the installer sidebar/header artwork (**BMP** — NSIS rejects PNG at build time rather than degrading), and the ADR-017 latency verification (needs a real high-latency client).

---

## Reference: what the backend gives you

| Migrations | Feature |
| --- | --- |
| `0006`-`0010` | Friends, blocks, presence consent, conversations, messages (`seq` cursor), moment notes, borders, realtime |
| `0011`-`0012` | Creator clubs, bounties (audited state machine), submissions, votes, moderation, audit log |
| `0013`, `0018` | Notification emitters, bell, dismissal, retention |
| `0014` | Group system messages + `set_conversation_role` |
| `0015`, `0019` | Club discovery, visibility, suspension |
| `0016` | Highlight reels |
| `0017` | Fixes the border that could never be unlocked (`first-room` vs `first-night`) |

Every service returns `SocialResult<T>` (`ok | unauthenticated | forbidden | blocked | rate-limited | offline | not-ready | error`). **`not-ready` means the migration is not deployed: hide the feature, do not show an error.**

Gate every surface on `getSocialCapabilities()` — `friends`, `messaging`, `momentNotes`, `creatorClubs`, `notifications`, `clubDiscovery`, `highlights`. All default false. **Hide, never disable.** Call `resetSocialCapabilities()` on sign-in/sign-out.

### Four things that will bite you if you assume otherwise

1. **`getSocialGraph()` returns four separate collections** — friends, incoming, outgoing, suggestions. A suggestion is a co-watcher, **not** a friend. Do not merge them.
2. **Message paging uses `seq`, not `createdAt`.** `created_at` is the transaction timestamp and can tie; ordering by it is not stable.
3. **Presence never carries a room code.** By design. Do not build a "jump to their room" affordance on it — there is nothing to jump to.
4. **Soft-deleted messages still arrive**, with `deletedAt` set and an empty body. Render a tombstone; do not filter them out, or your cursor will drift.

### Tests must run without a `.env`

CI has no Supabase credentials, and `@/lib/supabase` **throws at module load** when they are absent — so a test that imports a module reaching the client passes on your machine and fails in CI. Put pure logic in a module that imports nothing (see `src/lib/analytics/highlightFormat.ts`, which exists for exactly this reason).
