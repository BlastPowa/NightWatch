# NightWatch Phases 34-43 — Backend and Platform Handoff

Owner: Claude/Opus backend-platform lane
Frontend owner: Codex
Current public baseline: `v0.1.27` / `944462f907e5f332a9bc8ade7ed23c695034d65a`

## Delivery rule

Start **Phase 34 only** from a clean branch based on `origin/main`. Do not continue
from Phase 29, 31, 32, or 33 branches. Later phases begin only after Phase 34 is
merged and a new branch is cut from the then-current `main`.

No feature flag may be enabled merely because its implementation compiles. Drive
workspace, file watch, voice, and live share stay capability-gated until their
packaged two-client acceptance sections pass.

## Audit facts

- Public `main` and `v0.1.27` both point to `944462f`.
- PR #44 (`backend/phase-29-drive`) and PR #48
  (`backend/phase-31-movie-watch`) are stale/conflicting. Their runtime work must
  be compared with `main`; do not merge either obsolete branch.
- The deployed Supabase project already reports the social RPCs used by the
  current client, including messaging, friendship, presence, people search, and
  room-people functions. Packaged failures therefore require auth/session, RLS,
  schema-cache, Realtime, and UI-integration diagnosis rather than blind function
  creation.
- Friends currently filters the local graph and co-watcher suggestions. It does
  not yet use the shipped `search_people` and `get_room_people` service paths.
- Google Drive currently supports OAuth, Picker, file authorization, and the
  NightWatch Shared folder bootstrap. It does not expose an in-app folder/file
  workspace.
- Appearance CSS defines overlapping backdrop selectors in more than one file.
  The frontend lane will centralize those selectors and extend the saved custom
  atmosphere safely.
- The Release workflow does not currently run the complete test suite or a
  packaged smoke gate.
- Existing Phase 33 contracts remain authoritative. In particular: no media
  bytes, Drive tokens, local paths, private room codes, or recording data may be
  sent through Supabase; nothing interactive may cover the official YouTube
  iframe.

## Phase 34 backend/platform scope

Work on `backend/phase-34-production-parity` only.

### 1. Runtime capability manifest

Add an authenticated, non-destructive `runtime_capabilities_v2` RPC returning
the exact server surface the renderer may rely on:

```ts
export interface RuntimeCapabilityManifestV2 {
  schemaGeneration: number;
  authenticated: boolean;
  functions: Record<string, boolean>;
  realtimeTables: string[];
}
```

Requirements:

- It must not mutate data or call feature RPCs as probes.
- `authenticated` is derived server-side from the caller JWT.
- `functions` reports exact supported signatures, not merely matching names.
- `realtimeTables` contains only tables actually present in the Realtime
  publication and safe for the client to know.
- `schemaGeneration` is monotonically increased when a client-visible contract
  changes.
- Grant execution only to the intended roles. Add SQL assertions for anonymous
  and authenticated callers.
- Keep the previous diagnostic path available for one compatibility cycle.

### 2. Session restoration and safe diagnostics

Verify packaged Electron relaunch restores the Supabase Discord session before
social capability detection runs. Capability state must reset and retry on:

- sign-in and sign-out;
- token refresh or auth failure;
- network reconnect;
- application resume;
- renderer reload after a main-process OAuth callback.

Add safe structured action diagnostics with:

```ts
export interface SafeActionDiagnostic {
  operationId: string;
  feature: string;
  outcome: 'success' | 'signed-out' | 'deployment-missing' | 'forbidden' |
    'blocked' | 'rate-limited' | 'offline' | 'conflict' | 'failed';
  authenticated: boolean;
  online: boolean;
  schemaGeneration: number | null;
}
```

Never log tokens, OAuth codes, room codes, message bodies, Drive ids, file names,
local paths, or user search text.

### 3. Social contract verification

Exercise the deployed signatures and RLS for:

- friend graph, discoverability, handle search, room people, request, accept,
  decline, remove, block, and unblock;
- direct and group conversation creation, membership, list, pagination, send,
  acknowledgement, read cursor, edit, soft delete, leave, and group moderation;
- consent-safe presence and block behavior in both directions.

Fix the backend/platform layer only when the test proves a contract defect. Do
not paper over a signed-out renderer with relaxed RLS. Direct messages require an
accepted friendship. Groups remain capped at 30 members.

### 4. Drive workspace contracts for Phase 37

Keep the narrow `drive.file` scope and Google Picker authorization model. Add
typed Electron-main contracts for app-created or explicitly authorized items:

```ts
export interface DriveWorkspaceEntry {
  id: string;
  parentId: string;
  name: string;
  kind: 'folder' | 'video';
  mimeType: string;
  size: number | null;
  modifiedAt: string;
  thumbnailUrl: string | null;
  canDownload: boolean;
}

export interface DriveWorkspaceInfo {
  id: string;
  name: string;
  webViewLink: string;
}

export interface DriveWorkspacePage {
  folder: DriveWorkspaceInfo;
  entries: DriveWorkspaceEntry[];
  nextPageToken: string | null;
}
```

The Electron media bridge will eventually need: list folder, authorize folder,
create folder, search, page, refresh, upload with progress/cancellation, remove
local library metadata, open in Drive, and disconnect. OAuth/refresh tokens,
authorization headers, filesystem paths, and raw Drive responses remain in the
main process. Do not broaden to `drive.readonly` or full-Drive browsing.

Phase 34 should deliver only contracts and backend/platform support required for
safe frontend integration; the full visual workspace is Phase 37.

### 5. Release-candidate backend support

Ensure the project can validate a packaged candidate without publishing:

- exact environment/capability diagnostics with secrets redacted;
- packaged session restoration checks;
- database/RLS test instructions;
- deterministic exit/status for a packaged smoke invocation if the frontend
  lane adds one.

Do not tag, publish, or push `main`.

## Later backend/platform phases

These are planning boundaries, not authorization to implement them on the Phase
34 branch.

- **Phase 35:** splash/main-window readiness stages and degraded timeout signals.
- **Phase 36:** production people search, room people, social activity and
  messaging acceptance with two authenticated accounts.
- **Phase 37:** Drive Shared workspace listing, folder creation/authorization,
  resumable upload, pagination, token expiry, permission removal, owner-private
  library metadata and RLS.
- **Phase 38:** `media:v1` local/Drive descriptor synchronization and participant
  readiness. Supabase carries state only, never media bytes.
- **Phase 39:** TURN deployment, voice and screen/window share lifecycle, explicit
  capture consent, cleanup, and eight-peer mesh limit.
- **Phase 40:** notifications, invitations, RSVPs, schedules, premieres, moment
  notes, Creator Club moderation and metadata-only highlight export.
- **Phase 41:** sanitized prebuilt Windows icon-variant selection through Electron
  IPC. One canonical installer/shortcut icon remains.
- **Phase 42:** isolated platform dependency upgrades, unsigned release-candidate
  artifacts, updater acceptance, and optional Windows signing.
- **Phase 43:** OAuth verification support, privacy-safe monitoring, quota/TURN
  health, and a separately approved SFU decision.

## Migration and deployment inventory

Phase 34 must report, without assuming owner deployment:

1. New migration filename and checksum for `runtime_capabilities_v2`.
2. Every grant/RLS/publication change.
3. Disposable database test command and exact expected final assertion.
4. Edge Functions changed and whether Verify JWT must be on.
5. Required server secrets by name only; never values.
6. Schema reload/restart action, if any.
7. Backward-compatibility test against the current `v0.1.27` client.

## Forbidden backend-lane changes

- No React layout redesign or shared visual CSS edits.
- No official YouTube iframe replacement, overlays, download, proxy, branding or
  ad interference.
- No full-Drive scope or silent permission grant.
- No media relay or hosted catalog through Supabase/NightWatch.
- No recording feature.
- No voice/live-share/file-watch capability enablement before packaged
  acceptance.
- No direct push to `main`, version bump, tag, or Release workflow run.

## Required tests

Automated gate:

```powershell
npm ci
npm run typecheck
npm test
npm run build:activity
npm run build -- --publish never
```

SQL/RLS coverage must include:

- manifest auth and exact function signature reporting;
- session absent/expired/refreshed behavior;
- discoverability off, block in both directions, three-character search minimum,
  room membership protection, and no room-code leakage;
- DM friendship requirement, group membership/30-person cap, unread cursors,
  edit/delete ownership, reconnect/reload acknowledgement;
- old-client compatibility.

Do not claim packaged success without completing the matching rows in
`PHASE_33_PACKAGED_ACCEPTANCE.md` using two accounts.

## Completion-report format

Create `PHASE_34_COMPLETION_REPORT.md` containing:

1. Base commit and branch.
2. Files created and modified, grouped by contract/database/platform/test/docs.
3. Exact contract diffs for frontend integration.
4. Validation commands and exact results.
5. Migration/Edge Function deployment instructions.
6. Capability flags still disabled and their acceptance prerequisite.
7. Known limitations and security review.
8. Commit SHA, pushed branch and PR URL, or exact handback commands if Git is
   unavailable.

## Fable status — Phase 34 implemented (2026-07-20)

Phase 34 files are written on `backend/phase-34-production-parity`. **No
commands ran and no Git operations happened** — the command sandbox was
unavailable, so typecheck, tests, both builds, `psql`, commit, push, and PR
are all Codex's. Every test below is written but **not executed**. Full detail
lives in `PHASE_34_COMPLETION_REPORT.md`.

### Delivered against the Phase 34 scope

| Scope item | Status | Where |
|---|---|---|
| §1 `runtime_capabilities_v2` + SQL/RLS tests | done | `supabase/migrations/0028_runtime_capabilities_v2.sql`, `supabase/tests/phase34_runtime_capabilities_test.sql` |
| §2 session restoration + safe diagnostics | done | `shared/safeDiagnostics.ts`, `src/lib/platform/RuntimeCapabilityService.ts` |
| §3 social contract verification | done (as executable SQL) | `supabase/tests/phase34_social_contract_test.sql` |
| §4 Drive workspace contracts for Phase 37 | done (contracts only) | `shared/driveWorkspaceContracts.ts` |
| §5 release-candidate backend support | done | `shared/releaseSmoke.ts`, `src/lib/platform/ReleaseSmokeService.ts` |

New files: 3 database (1 migration + 2 test scripts), 8 shared contracts/tests,
3 platform service/test files, 1 report. **No existing file was modified** —
no React, no CSS, no Edge Function, no existing migration, no version/tag.

### The packaged auth bug, specifically

Capability detection raced Supabase's persisted-session restore on relaunch, so
a signed-in user was detected as signed out and every social surface hid itself
without stating why. `RuntimeCapabilityService.whenSessionSettled()` gates
detection on the initial restore, and the manifest is invalidated on sign-in,
sign-out, token refresh, network reconnect, and app resume.

### Owner database work (only one item)

Deploy **`supabase/migrations/0028_runtime_capabilities_v2.sql`**. It adds three
functions and **no table, RLS policy, or publication change**. Then run both
`supabase/tests/phase34_*.sql` against a disposable database. `social_diagnostics()`
is untouched, so a `v0.1.27` client is unaffected either way.

### Post-run fix (2026-07-21) — social contract test

The owner ran both Phase 34 SQL scripts. `phase34_runtime_capabilities_test.sql`
**passed**; `phase34_social_contract_test.sql` failed with `P0001: forbidden`
from `accept_friend_request`.

**Cause: a defect in my test, not in the deployed contract.**
`accept_friend_request(p_sender uuid)` takes the **other user's id**, not a
`friend_requests.id`. The test passed a request id, which matched no pending
row, so the function correctly raised `forbidden`. Fixed in place:

- accept is now called as the recipient naming the SENDER;
- the "third party cannot accept" assertion now proves something real, plus a
  new assertion that a refused accept creates no friendship;
- `get_messages(...)` now casts its cursor to `bigint` — 0007 and 0008 both
  define overloads, so an untyped `NULL` is ambiguous.

**Worth flagging to the frontend lane:** `accept` / `decline` / `cancel` /
`remove` / `block` / `unblock` all take a USER id. Any client passing a request
id will fail with exactly this `forbidden`, which looks like a permission bug
and is not one.

Owner action: re-run `supabase/tests/phase34_social_contract_test.sql` only.
No migration change; `0028` is unaffected and already verified.

### Phase 35 backend is now IMPLEMENTED — read `PHASE_35_BACKEND_REPORT.md`

Update 2026-07-25. At the owner's direction the Phase 35 backend was built in
this worktree while Phase 34 was still checked out. **Those files must be
moved to a branch cut from `origin/main` after the Phase 34 PR merges and must
not ship in the Phase 34 PR.** `PHASE_35_BACKEND_REPORT.md` has the full file
list, the Codex task list, and the two execution-found defects.

Owner-verified: migration `0029_room_invite_tokens.sql` applied and
`supabase/tests/phase35_invite_token_test.sql` passed. All TypeScript in that
phase is written but uncompiled and untested.

Note that the Phase 35 planning line below ("splash/main-window readiness
stages") is a *different* item from the owner's Discord social request, which
also landed under the Phase 35 label. The readiness-stage work is still
unstarted.

### New owner requests captured as Phase 35

Discord friends list, invite-from-Activity, share-room, and the Discord app
icon are scoped in `PHASE_35_DISCORD_SOCIAL_SCOPE.md` — deliberately NOT
implemented on this branch. Key finding: Discord exposes no generally
available scope for a user's friend list (`relationships.read` is
whitelist-only), so the deliverable is "people in this call" plus the
NightWatch friend graph, with `sdk.commands.openInviteDialog()` as the native
invite. The icon is pure Developer Portal configuration using assets already
in `build/`.

### Deviations Codex should know about

1. `DriveWorkspaceInfo` in the handoff uses `id`; the shipped
   `shared/mediaBridge.ts` type uses `folderId`. I added a NEW
   `DriveWorkspaceFolder { id }` rather than renaming a live field. Unify
   deliberately in Phase 37 if wanted.
2. `runtime_capabilities_v2` reports a static function list; adding a contract
   later means editing a successor migration and bumping
   `runtime_schema_generation()`.
3. Phase 34 enables **no** capability flag.

## Prompt for Claude/Opus 5

```text
Work in C:\Users\Blast\source\repos\NightWatch-fable.

Read these files completely before editing:
1. C:\Users\Blast\source\repos\NightWatch-fable\CLAUDE.md
2. C:\Users\Blast\source\repos\NightWatch-fable\PHASE_34_TO_43_BACKEND_PLATFORM_HANDOFF.md
3. C:\Users\Blast\source\repos\NightWatch-fable\PHASE_33_FRONTEND_CONTRACTS.md
4. C:\Users\Blast\source\repos\NightWatch-fable\PHASE_33_PACKAGED_ACCEPTANCE.md

Start Phase 34 only. Fetch origin and create backend/phase-34-production-parity from origin/main. Do not continue from backend/phase-33-comms-completion or another stale branch.

Own backend/platform work only:
- runtime_capabilities_v2 and its SQL/RLS tests;
- packaged auth/session and social failure diagnostics;
- exact messaging/friend RPC contract verification;
- Google Drive workspace listing/upload contracts needed by Phase 37;
- release-candidate and packaged backend validation support.

Do not redesign React components, edit shared visual CSS, replace the official YouTube iframe, broaden Drive beyond drive.file, relay media bytes through Supabase, or enable voice/share/file-watch flags before packaged acceptance.

Preserve all current event and storage contracts unless the handoff explicitly versions them. Return typed contracts before frontend integration.

Run npm ci, npm run typecheck, npm test, npm run build:activity, and npm run build -- --publish never. Run every new SQL test against the disposable/owner-approved database. Record every migration and Edge Function the owner must deploy.

If shell/git works, commit and push only backend/phase-34-production-parity and open/update its PR. Never push main and never trigger a release. If shell/git is unavailable, leave the worktree unchanged except for your intended files and write PHASE_34_COMPLETION_REPORT.md with the exact changed files, validation results, SQL/deployment steps, and commands Codex should run.

Stop after Phase 34 and notify the owner/Codex. Later backend phases begin only from the newly merged main.
```
