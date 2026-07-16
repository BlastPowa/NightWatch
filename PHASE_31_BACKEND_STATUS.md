# Phase 31 backend status — social reliability diagnostic

Last updated: 2026-07-16 (third update). Branch: `backend/phase-31-social-reliability`.

## Current state: BACKEND COMPLETE AND DEPLOYED

- Migrations `0023`, `0024`, and `0025` are **applied to production** and both
  Phase 31 SQL test files passed on the owner's run.
- Post-deployment verification against the live project (2026-07-16):
  - `is_blocked` / `are_friends` / `under_limit_*` / `display_name_of` now
    return `42501 permission denied` to clients — the graph-enumeration leak
    is closed.
  - `heartbeat_live_room_social` / `list_live_room_co_watchers` refuse
    anonymous callers (authenticated-only, as designed).
  - `social_diagnostics()` reports all twelve social functions deployed,
    `hasSession` truthfully, and both `messages` and `friend_requests` in the
    Realtime publication.
- `npm run typecheck` passes; `npm test` 308/308 (16 new).

**Nothing further is owed by the backend lane. The remaining work is the
frontend integration below and one owner release-flag check.**

## For Codex — exact frontend integration steps

Rebase the Phase 31 frontend branch onto
`backend/phase-31-social-reliability` (or onto `main` once it merges), then:

1. **Live-room co-watcher suggestions** — `src/lib/social/LiveRoomSocialService.ts`:
   - On joining any live room as a signed-in user, call
     `heartbeatLiveRoomSocial(roomCode, presenceId)` and repeat every ~60s
     while in the room. `presenceId` is any opaque per-session id matching
     `[A-Za-z0-9_-]{1,64}` (the existing Realtime presence id is fine).
   - Populate the existing Friends "Suggestions" section from
     `listLiveRoomCoWatchers(roomCode)`. Rows are `LiveRoomCoWatcher`
     (`userId`, `displayName`, `avatarUrl`, `selectedBorderId`) and are
     already filtered server-side: blocks (both directions), accepted
     friends, and pending requests never appear. Send requests through the
     existing `send_friend_request` flow using `userId`.
   - `forbidden` from list means the caller's own heartbeat went stale —
     heartbeat again, then retry. `rate-limited` only fires on switching
     rooms faster than every 10s; back off, never tight-loop.
   - Call `leaveLiveRoomSocial(roomCode)` when leaving the room (best-effort;
     staleness handles crashes). Guests never call any of these.
2. **Explain disabled social controls** — `src/lib/social/SocialDiagnosticsService.ts`:
   - When social capabilities come back false or a social screen would render
     disabled controls, call `diagnoseSocial()` and branch on the closed
     union: `account-required` → show a "NightWatch account required" state
     (this is what the v0.1.25 users were actually in);
     `deployment-missing` → name the missing functions in a support-facing
     message; `offline` → existing offline treatment; `ready` → the controls
     should work, so a dead button is a real bug to fix, not a state to hide.
   - Never treat a connected YouTube account as a NightWatch session.
3. **Room chat / reactions** — no SQL involved (Realtime Broadcast). NightWatch
   renders locally before broadcasting, so a click with no local echo is a
   frontend disabled-state or pointer bug; the `account-required` state above
   is the expected cause to surface. Reactions stay unavailable until a video
   is loaded, by design.

## Owner — remaining checklist

1. (Done) `0023`–`0025` applied; both SQL test files passed.
2. Before the next release, set the GitHub Actions **repository variables**
   that gate packaged features: `NIGHTWATCH_ENABLE_LIBRARY=1` is safe now
   (migration `0022` deployed and tested); `NIGHTWATCH_ENABLE_LOCAL_FILES`,
   `NIGHTWATCH_ENABLE_DRIVE` (+ Google values per `GOOGLE_MEDIA_SETUP.md`),
   and `NIGHTWATCH_ENABLE_YOUTUBE_ACCOUNT` as desired — otherwise those
   features ship hidden again.
3. Optional hygiene: confirm `REPLICA IDENTITY FULL` on `messages` /
   `friend_requests`, and run `supabase migration repair` so the remote
   migration-history table reflects what is actually applied (it is currently
   empty because everything went through the SQL editor).

## 1. Root cause per reported symptom

The production deployment audit (section 3) found the database healthy, which
narrows every symptom to two shared states rather than five independent bugs.

| Symptom | Root cause |
| --- | --- |
| Same room, cannot find/add each other | Structural gap, fixed by migration `0023`. Co-watcher suggestions came only from `room_participants`, which has a foreign key to persistent `rooms`. An ordinary six-character live room writes no participant row, so the social graph never saw the pair. |
| Message Send unavailable/failing | Not a backend failure: `send_message` and every messaging RPC is deployed with correct grants. The users had connected a **YouTube account**, which does not create a NightWatch session; every social RPC then raises `unauthenticated` and the capability layer hides/disables the controls. |
| Group creation/member controls unavailable | Same shared state: no NightWatch session. `create_group_conversation` etc. are deployed and granted. |
| Room chat and reactions appear dead | These use Realtime Broadcast, not SQL, and NightWatch renders locally before broadcasting — a click with no local echo is a frontend disabled-state (again driven by the missing session) or pointer issue, not a database problem. Reactions are additionally unavailable until a video is loaded, by design. |
| Several controls disabled at once | The tell for the shared state. `social_diagnostics()` (migration `0024`) now lets the UI say "NightWatch account required" instead of showing uniform dead controls. |

## 2. Migration/RPC changes on this branch (all applied)

- `supabase/migrations/0023_live_room_social.sql`
  - `live_room_social_presence` — one row per (room, user), keyed by
    `hmac(upper(code), per-database secret)`; the raw room code is never
    stored. RLS enabled **and forced** with no policies; direct access revoked;
    RPCs are the only surface.
  - `live_room_social_secret` — one-row HMAC key table, same lockdown.
  - `heartbeat_live_room_social(p_room_code, p_presence_id)` — auth required,
    strict code/presence-id validation, upserts only the caller, enforces one
    live room per user, rate limits room switching (>1 switch per 10s raises
    `rate-limited`), and opportunistically deletes rows older than 10 minutes
    (no scheduler needed).
  - `list_live_room_co_watchers(p_room_code)` — requires the caller's own
    fresh (≤2 min) heartbeat for that exact room; returns other fresh users
    minus blocks (both directions), accepted friends, and pending requests
    either way; exposes only safe display name, `safe_avatar_url`, and
    `validated_border`. Never returns the room code or private stats.
  - `leave_live_room_social(p_room_code)` — deletes only the caller's row.
  - All three granted to `authenticated` only; PUBLIC explicitly revoked
    (Postgres grants every new function to PUBLIC by default — the owner's
    first test run caught exactly this); the hash helper is internal.
- `supabase/migrations/0024_social_diagnostics.sql`
  - `social_diagnostics()` — granted to `anon` + `authenticated`; returns
    `hasSession`, a deployed/missing boolean per social RPC, and which social
    tables are in the `supabase_realtime` publication. Reveals deployment facts
    and the caller's own auth state only.
- `supabase/migrations/0025_internal_helper_grants.sql`
  - Closes a **pre-existing production leak**: the PUBLIC default grant left
    every internal helper callable through PostgREST, so an anonymous request
    could call `is_blocked(a, b)` / `are_friends(a, b)` for arbitrary user
    ids (verified live, now verified closed). Revokes client execute on the
    internal surface; keeps `is_active_member` / `is_club_member` /
    `is_club_staff` callable by `authenticated` because RLS policies evaluate
    them as the querying role.
- Tests: `supabase/tests/phase31_live_room_social_test.sql` and
  `supabase/tests/phase31_helper_grants_test.sql` — rollback-only; both passed
  on the owner's run.

## 3. Production deployment audit results (run 2026-07-16)

Method: the CLI is linked to project `eiachttvgojmzvcecszz`; RPC presence and
grants were probed through PostgREST exactly as the app calls them, and the
Realtime publication was verified functionally by subscribing with the anon
client.

- **RPC presence + execute grants: PASS.** All social RPCs exist and raise
  `unauthenticated` (i.e. they executed and enforced auth — grants in place).
- **Realtime publication: PASS.** `postgres_changes` subscriptions on
  `public.messages` and `public.friend_requests` reach `SUBSCRIBED`.
- **Migration history table is empty** (everything applied via SQL editor) —
  see owner checklist item 3.
- **Message tables were empty in production** — no send had ever reached the
  database, consistent with the missing-session root cause rather than RLS.

## 4. Typed frontend contracts (stable to build against)

- `src/lib/social/LiveRoomSocialService.ts` — `LiveRoomCoWatcher`
  (`userId`, `displayName`, `avatarUrl`, `selectedBorderId`) plus
  `heartbeatLiveRoomSocial`, `listLiveRoomCoWatchers`, `leaveLiveRoomSocial`,
  all returning the existing `SocialResult` union.
- `src/lib/social/SocialDiagnosticsService.ts` — `diagnoseSocial()` returning
  `ready | account-required | deployment-missing (with names) | offline |
  error`.
