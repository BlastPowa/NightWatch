# Phase 32 Implementation Report — Room Media, Discovery, Live Share, Voice

Prepared by the backend/platform lane (Fable) for Codex validation and Git
delivery. Branch: `backend/phase-32-room-media-comms` (already active per the
owner; this session performed NO Git operations).

## 1. Completion status

Backend/platform implementation is **code-complete but capability-gated**, with
the known limitations in §13. Codex audited and repaired the handoff after
implementation: signaling inboxes are room-scoped, room-media state/readiness
is persisted behind member-only RPCs, capability discovery is side-effect
free, service-role TURN authorization is explicit, and Cloudflare TURN uses
its real credential-generation API. Nothing is enabled before deployment.

## 2. Files created / modified

Created:
- `shared/roomComms.ts` + `shared/roomComms.test.ts`
- `shared/rtc.ts` + `shared/rtc.test.ts`
- `supabase/migrations/0026_room_media_comms.sql`
- `supabase/tests/phase32_rls_test.sql`
- `supabase/functions/turn-credentials/index.ts`
- `src/lib/rtc/SignalingService.ts`, `src/lib/rtc/TurnService.ts`
- `src/lib/rtc/sessionCore.ts` + `src/lib/rtc/sessionCore.test.ts`
- `src/lib/rtc/VoiceSession.ts`, `src/lib/rtc/ShareSession.ts`
- `src/lib/people/PeopleService.ts` + `src/lib/people/peopleNormalize.test.ts`
- `src/lib/media/roomMediaCapabilities.ts`
- `src/lib/media/RoomMediaService.ts` + tests
- `electron/comms/captureSources.ts`
- `electron/media/driveWorkspace.ts` + `electron/media/driveWorkspace.test.ts`

Modified:
- `shared/ipc.ts` — capture + Drive-workspace channels, `NightWatchCaptureBridge`,
  `DriveWorkspaceInfo`/`DriveFileAccessState`, media-bridge additions
- `electron/preload.ts` — `capture` surface; media `ensureDriveWorkspace` /
  `getDriveFileAccess`
- `electron/main.ts` — capture registration, permission handler, Drive
  workspace IPC (sender-validated)
- `electron/media/driveManager.ts` — `getWorkspaceToken()` (token value only)
- `supabase/migrations/0004_gamification.sql` — removed stray corrupted text
  (`ive ran`) that broke fresh deploys
- `STATUS.md`, `TASKS.md`, `ROADMAP.md`, `CHANGELOG.md`

Not touched: React components, visual CSS, `NightWatch-acceptance`, Git.

## 3. Contracts & capabilities implemented

- `RoomMediaMode` v2 envelope: `youtube` (wraps the unchanged schemaVersion-1
  descriptor), `file-watch` (local/Drive descriptor + readiness policy
  `all-ready`/`majority-ready`/`host-only`), `live-share` (sessionId/sharer/
  label only — never media). Future versions → typed `not-supported`.
- `FileWatchReadiness`: `ready | missing-file | permission-required |
  fingerprint-mismatch | unsupported-codec | buffering | offline | rate-limited`
  + `mayStartFileWatch` policy evaluator.
- `CommsOutcome`: every operation returns success or `unauthorized | forbidden
  | blocked | not-supported | permission-required | rate-limited | offline |
  server-error` via the centralized `commsFailFromRpc` mapper.
- `RoomMediaCapabilities` (§5 of the handoff) with side-effect-free contract
  detection (`roomMediaCapabilities.ts`), all flags default false.
- Persisted room media snapshots use optimistic revisions and a fresh-member
  controller lease. File-watch readiness is revision-scoped and member-only.
- RTC contracts: signal kinds/purposes, 16 KiB payload cap, 60 s TTL,
  `RTC_MESH_MAX_PEERS = 8`, voice constraints/report, capture source ids,
  TURN credential shape + freshness.

## 4. Database migration order

1. `0026_room_media_comms.sql` (requires 0001–0025 already applied; nothing
   else new). Re-deploy nothing else. Note: `0004` was repaired in-repo; on
   databases where 0004 already ran, no action is needed (the corruption only
   broke FRESH deploys).

## 5. Supabase SQL verification steps

1. Restore/branch a **disposable** database with 0001–0026 applied.
2. `psql "$DISPOSABLE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/phase32_rls_test.sql`
3. Expect the final row `phase32 RLS test: all assertions passed` (the script
   rolls itself back). It covers: discovery opt-out + min-length, room-people
   membership gating, signaling happy path, block enforcement (queued AND
   future), cross-room + non-member denial, expiry sweep, self-send and
   oversized payload rejection, client direct-table denial, and TURN
   authorization (member / outsider / stale member).

## 6. Edge Functions & deployment

- `turn-credentials` — deploy with **Verify JWT ON**:
  `supabase functions deploy turn-credentials`
  Cloudflare secrets: `CLOUDFLARE_TURN_KEY_ID`,
  `CLOUDFLARE_TURN_API_TOKEN`; or self-hosted coturn secrets:
  `TURN_SHARED_SECRET`, `TURN_URLS`.
- No changes to `search-youtube`, `discord-token`, `log-session`.

## 7. Required environment variables / secrets

- Cloudflare: `CLOUDFLARE_TURN_KEY_ID` and
  `CLOUDFLARE_TURN_API_TOKEN` (Edge secrets), **or** self-hosted coturn:
  `TURN_SHARED_SECRET` and comma-separated `TURN_URLS`.
- No new client-side variables. No secret ever ships in the app.

## 8. Manual setup (Google, TURN, WebRTC)

- **TURN provider** (owner decision, required for reliable NAT traversal):
  - Recommended: Cloudflare Realtime TURN. NightWatch calls Cloudflare's
    server-side `generate-ice-servers` endpoint using the TURN key id/API
    token and returns only short-lived credentials to the client.
  - Alternative: self-hosted coturn with `use-auth-secret` and
    `static-auth-secret=$TURN_SHARED_SECRET`.
  - Voice/share remain capability-hidden unless the signaling migration and a
    configured TURN function are both reachable.
- **Google Drive**: no new Cloud setup — the existing Phase 29/30 OAuth client
  and `drive.file` scope cover the workspace (app-created folder + Picker
  grants). Sharing to viewers happens in Google's own UI via the returned
  `webViewLink`; each viewer authorizes independently.
- **SFU**: NOT implemented. Mesh is hard-capped at 8 (voice) / sharer+7
  viewers. Before enabling live-share/voice for public rooms, the owner must
  pick and cost an SFU provider (e.g. Cloudflare Calls SFU or LiveKit Cloud);
  the signaling contract does not preclude it.

## 9. Capability flags that remain disabled

ALL of them, by default: `fileWatch`, `driveWorkspace`, `liveShare`,
`voiceChat`, `publicUserSearch`, `roomPeopleActions` — plus everything Phase
29 already gated.

## 10. Flags safe to enable (after the listed prerequisites)

- `publicUserSearch`, `roomPeopleActions` — after 0026 + SQL test pass.
- `voiceChat`, `liveShare` — after 0026 + `turn-credentials` + packaged
  two-client verification (small private rooms only until an SFU exists).
- `fileWatch`, `driveWorkspace` — after the Phase 29 owner gates AND packaged
  verification of the workspace flow; these also require the desktop platform
  (they can never enable on the Activity/web).

## 11. Tests added and Codex validation

- `shared/roomComms.test.ts` — mode envelope parse/reject, readiness policy
  math, RPC error mapping, disabled-capability default.
- `shared/rtc.test.ts` — signal validation, payload caps, capture-id shape,
  TURN credential parse/freshness.
- `src/lib/rtc/sessionCore.test.ts` — phase machine, permission denial, mesh
  ceiling, mute/deafen/speaking semantics, transport loss/reconnect, device
  loss, terminal end.
- `src/lib/people/peopleNormalize.test.ts` — query normalization + handle
  grammar (matches the SQL constraint).
- `electron/media/driveWorkspace.test.ts` — folder reuse-by-app-property,
  creation, expired/revoked/consent/offline token paths, download-disabled,
  per-viewer divergent permission states, path-traversal-safe file ids.
- `supabase/tests/phase32_rls_test.sql` — §5 above.

Codex executed strict TypeScript, all 364 Vitest tests (39 files), the Discord
Activity production build, the Electron production build, and Windows NSIS
packaging successfully on 2026-07-19. The SQL test still requires the owner's
disposable Supabase database because this machine has no local `psql`, Docker,
or Supabase CLI. Voice/live-share remain gated pending that SQL run and a
packaged two-client check.

## 12. Validation commands

```
npm ci
npm run typecheck
npm test
npm run build:activity
npm run build -- --publish never
```
Plus the SQL test (§5) against a disposable DB. Do not enable Phase 32 UI until
that SQL test and a packaged two-client RTC check both pass.

## 13. Known limitations / incomplete work

- **SFU absent** (documented decision point, §8). Mesh caps enforced instead.
- **VoiceSession/ShareSession have no real-peer unit tests** — they are thin WebRTC
  glue over the tested `sessionCore`; exercising RTCPeerConnection needs the
  packaged two-client environment (owner acceptance item).
- **Range-stream/token-refresh tests** (handoff §2) exist at the workspace/
  permission level here; the Phase 29 suite already covers Drive range
  streaming itself (`driveClient.test.ts`) — no duplication added.
- **Signaling transport is polling (1 s)**, not Realtime push, to reuse the
  hardened RPC/RLS path; latency is acceptable for call setup. A Realtime
  channel adaptation is possible later without contract changes.
- **Frontend surfaces**: none built (per instructions). Capture indicators,
  consent UI, discovery UI, and file-watch readiness display are frontend
  integrations (§15).
- The repo carried pre-existing uncommitted changes from other lanes; nothing
  was reset or reverted, and only the files in §2 were touched.

## 14. Security & privacy decisions

- Every new table is RLS-forced with zero client grants; access only through
  security-definer RPCs that authenticate, check fresh live-room membership
  (90 s window over 0023 presence), enforce blocks in both directions, and
  rate-limit (12/min + 500/day discovery; 80/10 s signaling; 120/day TURN).
- Internal helpers are execute-revoked from client roles in the same
  migration that creates them (0025 convention).
- Room codes: inputs only; hashed via 0023's keyed hash; never stored raw,
  never returned, never inferable from friend/discovery surfaces.
- Discovery is opt-IN (`discoverable` defaults false); handles are optional;
  only public fields (safe display name, safe avatar, validated border,
  relationship) are returned; caller and block-pairs excluded.
- Signaling payloads are opaque, size-capped strings with 60 s expiry and
  opportunistic sweep; blocks silence queued AND future signals.
- TURN: shared secret server-side only; credentials are 10-minute HMAC
  values, minted only for fresh members, per-user capped.
- Capture: renderer never receives native handles; capture requires an
  explicit in-app pick, grants are single-use with a 30 s validity, and the
  display-media handler denies everything else. Permission handler allows
  only `media`/`display-capture` for the app's own window.
- Drive: tokens stay in safeStorage (Phase 29); the workspace module receives
  token VALUES via a narrow provider, Supabase never sees tokens/paths/bytes,
  and viewer access is proven per-viewer (`capabilities.canDownload`).
- No recording paths exist anywhere in the new code.

## 15. Frontend integration requirements

- Call `getRoomMediaCapabilities({ htmlMedia, googleDrive })` (from the
  platform bridge's Phase 29 capabilities) and HIDE gated surfaces.
- Render permanent capture/mic indicators + stop controls whenever
  `VoiceSession`/`ShareSession` report active phases; both classes expose the
  states and teardown (`end`) for leave/sign-out/window close — wire
  `pagehide` to `end('window-closed')`.
- Voice roster comes from existing room presence; call `connectTo(userId)`
  for each co-member, respecting `snapshot()` mesh acceptance.
- Discovery UI: `searchPeople`/`getRoomPeople` outcomes carry the typed codes
  for empty/blocked/rate-limited/offline presentation; Add-Friend/Message/
  Invite/Block reuse the existing Phase 20B services with the returned
  `userId`.
- File-watch readiness display: use `RoomMediaService` to publish/fetch the
  versioned descriptor and revision-scoped readiness roster; gate the host
  Start control with `mayStartFileWatch`.

## 16. Assumptions needing owner approval

1. TURN provider choice + account creation (§8).
2. Mesh caps (8 voice / 8 share) as the pre-SFU limit.
3. Discovery rate limits and the 10-result / 3-character search contract.
4. Handle grammar `^[a-z0-9_]{3,20}$` and "handles are optional" policy.
5. Signaling via polling RPCs rather than a Realtime channel (latency
   trade-off accepted for RLS reuse).
6. The 0004 migration repair (removing accidental stray text) is treated as
   a bug fix, not a schema change.
