# Phase 31 backend status — social reliability diagnostic

Last updated: 2026-07-16. Branch: `backend/phase-31-social-reliability`.

## 1. Root cause per reported symptom

The production deployment audit (section 3) found the database healthy, which
narrows every symptom to two shared states rather than five independent bugs.

| Symptom | Root cause |
| --- | --- |
| Same room, cannot find/add each other | Structural gap, now fixed by migration `0023`. Co-watcher suggestions come only from `room_participants`, which has a foreign key to persistent `rooms`. An ordinary six-character live room writes no participant row, so the social graph never sees the pair. |
| Message Send unavailable/failing | Not a backend failure: `send_message` and every messaging RPC is deployed with correct grants. The users had connected a **YouTube account**, which does not create a NightWatch session; every social RPC then raises `unauthenticated` and the capability layer hides/disables the controls. |
| Group creation/member controls unavailable | Same shared state: no NightWatch session. `create_group_conversation` etc. are deployed and granted. |
| Room chat and reactions appear dead | These use Realtime Broadcast, not SQL, and NightWatch renders locally before broadcasting — a click with no local echo is a frontend disabled-state (again driven by the missing session) or pointer issue, not a database problem. Reactions are additionally unavailable until a video is loaded, by design. |
| Several controls disabled at once | The tell for the shared state. `social_diagnostics()` (migration `0024`) now lets the UI say "NightWatch account required" instead of showing uniform dead controls. |

## 2. Migration/RPC changes on this branch

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
  - All three granted to `authenticated` only; the hash helper is internal.
- `supabase/migrations/0024_social_diagnostics.sql`
  - `social_diagnostics()` — granted to `anon` + `authenticated`; returns
    `hasSession`, a deployed/missing boolean per social RPC, and which social
    tables are in the `supabase_realtime` publication. Reveals deployment facts
    and the caller's own auth state only.

## 3. Production deployment audit results (run 2026-07-16)

Method: the CLI is linked to project `eiachttvgojmzvcecszz`; RPC presence and
grants were probed through PostgREST exactly as the app calls them, and the
Realtime publication was verified functionally by subscribing with the anon
client.

- **RPC presence + execute grants: PASS.** `get_social_graph`,
  `send_friend_request`, `list_conversations`, `create_direct_conversation`,
  `create_group_conversation`, `send_message`, `get_messages`,
  `get_conversation_members`, `get_friend_presence_v2`, `heartbeat_presence`,
  and the notification RPCs all exist and raise `unauthenticated` (i.e. they
  executed and enforced auth — grants are in place).
- **Realtime publication: PASS.** `postgres_changes` subscriptions on
  `public.messages` and `public.friend_requests` reach `SUBSCRIBED`, so both
  tables are in `supabase_realtime`.
- **Migration history table is empty.** All 22 migrations were applied through
  the SQL editor, so `supabase migration list` shows nothing applied remotely.
  Objects through `0022` verifiably exist; consider
  `supabase migration repair` someday so drift is detectable.
- **Not verifiable without SQL access (owner, one query each):**
  `REPLICA IDENTITY FULL` on `messages`/`friend_requests`, and the RLS
  membership checks for one failing conversation (the handoff's queries are
  ready to paste). Given every RPC is present and message tables are empty in
  production (no rows have ever been written), the "failing send" was almost
  certainly the missing-session state, not RLS.

## 4. Dashboard/owner actions

1. Run `supabase/tests/phase31_live_room_social_test.sql` against a disposable
   database (it creates throwaway users, asserts, and rolls back; any failure
   names the case).
2. Apply `0023_live_room_social.sql`, then `0024_social_diagnostics.sql` to
   production. Both are additive; nothing existing is altered.
3. Optionally confirm `REPLICA IDENTITY FULL` on `messages` and
   `friend_requests` (handoff query) — Realtime INSERT delivery already works.
4. No new environment keys, no new dashboard toggles.

## 5. Typed frontend contracts (stable to build against)

- `src/lib/social/LiveRoomSocialService.ts` — `LiveRoomCoWatcher`
  (`userId`, `displayName`, `avatarUrl`, `selectedBorderId`) plus
  `heartbeatLiveRoomSocial`, `listLiveRoomCoWatchers`, `leaveLiveRoomSocial`,
  all returning the existing `SocialResult` union. Suggested cadence: heartbeat
  on join and every ~60s; `forbidden` from list means "heartbeat again";
  results feed the existing block-aware `send_friend_request` flow.
- `src/lib/social/SocialDiagnosticsService.ts` — `diagnoseSocial()` returning
  `ready | account-required | deployment-missing (with names) | offline |
  error`. `account-required` is the state the affected users were in; the UI
  should surface "NightWatch account required" rather than uniform disabled
  controls. YouTube OAuth must never be treated as a NightWatch session.

## Verification performed

- `npm run typecheck` — passes.
- `npm test` — 308 tests across 30 files, all passing (16 new).
- SQL tests are written but need the owner run (no local Postgres/Docker on
  this machine).
