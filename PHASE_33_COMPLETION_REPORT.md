# Phase 33 Completion Report — Remaining Features Handoff

Backend/platform lane (Fable). Prepared for Codex validation and Git delivery.
Covers the work requested in `REMAINING_FEATURES_AND_SETUP_HANDOFF.md`
(2026-07-20) on top of the merged Phase 32 baseline (`v0.1.26`, PRs #51/#52).

## 1. Completion status

Backend/platform code and contracts are **complete for Priorities 1–4 and the
non-visual half of 5–6**, all still capability-gated. Nothing here is
"complete" in the product sense: voice, screen sharing, and shared file
playback remain unproven until the owner deploys TURN and runs the packaged
two-client checklist (`PHASE_33_PACKAGED_ACCEPTANCE.md`).

**No Git operations were performed and no commands were executed** — this
session had no shell sandbox. Every test below is **written but not executed**.

## 2. Branch and base

- Intended branch: a new backend/platform branch from current `origin/main`
  (e.g. `backend/phase-33-comms-completion`). Codex creates it.
- Base commit: current `origin/main` at the time Codex branches (`v0.1.26`
  baseline per the handoff).
- I did not create, switch, or modify any branch.

## 3. Files created

| File | Purpose |
|---|---|
| `src/lib/media/DriveShareFlow.ts` | Typed 6-step host flow for Drive shared viewing + per-viewer access probe |
| `src/lib/media/driveShareFlow.test.ts` | Flow transitions, resume, auth-expiry regression to connect, offline retry, publish guard |
| `src/lib/media/ReadinessProbe.ts` | Descriptor → `FileWatchReadiness` decision logic with actionable detail text |
| `src/lib/media/readinessProbe.test.ts` | Codec-before-network ordering, Drive state mapping, local match/mismatch/rate-limit |
| `src/lib/media/capabilityReasons.test.ts` | Disabled-reason matrix (signed-out / not-deployed / unsupported-platform / relay-not-configured) |
| `src/lib/rtc/CommsLifecycle.ts` | Single teardown authority for voice/share across every exit path |
| `src/lib/rtc/commsLifecycle.test.ts` | Leave, sign-out, window close, host-migration semantics, hook idempotence |
| `PHASE_33_FRONTEND_CONTRACTS.md` | Typed integration guidance for Codex (Priority 2 deliverable) |
| `PHASE_33_PACKAGED_ACCEPTANCE.md` | Two-client acceptance checklist (Priority 6 deliverable) |
| `PHASE_33_COMPLETION_REPORT.md` | This report |

## 4. Files modified

| File | Change |
|---|---|
| `supabase/functions/turn-credentials/index.ts` | Added a secret-free `{ action: 'diagnostics' }` response (`configured`, `provider`, `ttlSeconds`) — never URLs, secrets, or credentials |
| `src/lib/rtc/TurnService.ts` | `getTurnDiagnostics()` client for the above |
| `src/lib/media/roomMediaCapabilities.ts` | Retains the last detection pass and adds `explainRoomMediaCapabilities()` → typed disabled reasons |

Not touched: React components, shared visual CSS, `NightWatch-acceptance`,
Git, and every Phase 32 contract already merged.

## 5. Migration order and SQL the owner must run

- **No new migrations in this phase.** The deployed set (`0001`–`0027`,
  including `0026_room_media_comms.sql` and `0027_fix_room_media_validator.sql`)
  is sufficient.
- Re-verification (already passing per the handoff, re-run if the database is
  rebuilt):
  `psql "$DISPOSABLE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/phase32_rls_test.sql`
  Expected final row: `phase32 RLS test: all assertions passed`.

## 6. Edge Functions and secrets

- Redeploy **`turn-credentials`** (diagnostics action added):
  `supabase functions deploy turn-credentials` — **Verify JWT ON**.
- Secrets (one provider set, not both):
  - Cloudflare Realtime TURN: `CLOUDFLARE_TURN_KEY_ID`,
    `CLOUDFLARE_TURN_API_TOKEN`
  - or self-hosted coturn: `TURN_SHARED_SECRET`, `TURN_URLS`
- No other function changed. No new client-side environment variables.

## 7. Tests

Added in this phase (**written, not executed**):

- `driveShareFlow.test.ts` — 7 cases
- `readinessProbe.test.ts` — 8 cases
- `capabilityReasons.test.ts` — 4 cases
- `commsLifecycle.test.ts` — 7 cases

Codex must run, in the repository root:

```powershell
npm ci
npm run typecheck
npm test
npm run build:activity
npm run build -- --publish never
```

Expected: existing 364 tests plus the ~26 added here. If `capabilityReasons`
or `driveShareFlow` fail on module mocking, the likely cause is vitest alias
resolution for `@/lib/supabase` — the same `vi.mock` pattern already used in
`peopleNormalize.test.ts` is applied here.

## 8. Capability flags

Remain **false** until their prerequisites are met:

| Flag | Unblocked by |
|---|---|
| `publicUserSearch`, `roomPeopleActions` | Already-deployed `0026`/`0027` + RLS test pass → safe to enable |
| `voiceChat`, `liveShare` | TURN deployed and diagnosed + acceptance §E/§F on **different networks** |
| `fileWatch` | Acceptance §C on packaged builds |
| `driveWorkspace` | Acceptance §D on packaged builds, both Google accounts |

Nothing in this phase enables anything automatically.

## 9. Known limitations

- **No SFU.** Mesh is capped at 8 peers (7 share viewers). Larger rooms are
  not supported and must not be advertised; provider/cost approval is an owner
  decision.
- **Voice/Share classes remain unit-untested** at the WebRTC layer (the pure
  `sessionCore` is tested). Real behaviour is only provable on packaged
  clients — hence the checklist.
- **Signaling is RPC polling (1 s)**, not Realtime push; fine for call setup,
  revisitable without contract changes.
- **Diagnostics are boolean-level.** They confirm a provider is configured,
  not that a specific relay path works — the cross-network test is the proof.
- Frontend surfaces (mode selector, readiness roster, media controls, voice
  and share controls with indicators, Drive workspace page) remain Codex's.

## 10. Security and privacy decisions

- TURN diagnostics deliberately expose only `configured` + provider name +
  TTL. No URLs, key ids, tokens, usernames, or credentials — a diagnostic
  endpoint that leaks relay URLs is a free relay for everyone.
- Diagnostics still require a valid JWT (Verify JWT stays ON); unauthenticated
  callers get 401 before reaching the branch.
- Drive: NightWatch never grants access. Sharing happens in Google's UI; each
  viewer proves access independently through `getDriveFileAccess`. The flow
  types make silent-grant impossible to express.
- Readiness evaluation checks codec support **before** any network call, so an
  undecodable file never sends a viewer to request permissions they cannot use.
- Lifecycle teardown is centralized precisely because a stranded capture or
  microphone track is the worst failure mode in this feature set. Host
  migration stops capture but preserves the call — losing host status is not
  consent to drop everyone's audio.
- Capability reasons are user-facing strings with no deployment internals
  beyond "not deployed yet".

## 11. Handoff instructions for Codex

1. Branch from current `origin/main`, preserving all uncommitted work in the
   worktree (there is pre-existing work from other lanes — do not reset).
2. Run the five automated gates in §7; report exact results.
3. Redeploy `turn-credentials` (or have the owner do it) and confirm
   `getTurnDiagnostics()` returns the expected provider.
4. Review the three modified files for lane compliance (no visual changes).
5. Commit, push the branch, open the PR, inspect Actions, merge on green.
6. Do **not** enable any capability flag as part of the merge — flags flip
   only after `PHASE_33_PACKAGED_ACCEPTANCE.md` passes.
7. Owner items still outstanding: TURN credentials, Google OAuth consent
   verification (public home/privacy/terms pages), non-owner Google test
   account, and SFU approval before >8-peer rooms.

## 12. Assumptions needing owner confirmation

1. Diagnostics response shape (`configured`/`provider`/`ttlSeconds`) is
   acceptable to expose to any authenticated user.
2. Host migration ends screen sharing but preserves voice.
3. `pagehide` is the canonical teardown hook for both Electron and web.
4. Drive step 3 ("add the file in Drive") stays a manual user action —
   NightWatch does not upload on the user's behalf.
