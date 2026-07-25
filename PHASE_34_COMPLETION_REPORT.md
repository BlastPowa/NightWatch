# Phase 34 Completion Report — Production Parity

Backend/platform lane (Fable). Prepared for Codex review, validation, and Git
delivery.

## 0. Validation status (read first)

Claude could not execute commands in its sandbox. Codex subsequently reviewed
the lane, fixed an initialization deadlock exposed by the new tests, and ran
the repository gates on 2026-07-25:

- `npm ci`: pass.
- `npm run typecheck`: pass.
- `npm test`: pass — 48 files, 439 tests.
- `npm run build:activity`: pass — 327 modules transformed.
- `npm run build -- --publish never`: pass — Windows unpacked application,
  NSIS installer, and blockmap produced without publishing.

The two SQL scripts remain **written and statically reviewed but not executed**
because this machine has neither the Supabase CLI nor an owner-approved
database URL. Migration `0028` and both SQL tests therefore remain owner work
before capability-backed acceptance.

## 1. Base commit and branch

- Intended branch: `backend/phase-34-production-parity` (created by Codex).
- Base: `origin/main` at `v0.1.27` / `944462f907e5f332a9bc8ade7ed23c695034d65a`.
- Codex confirmed the worktree is on `backend/phase-34-production-parity` and
  contains only the reviewed Phase 34 scope.

## 2. Files created and modified

### Database

| File | Purpose |
|---|---|
| `supabase/migrations/0028_runtime_capabilities_v2.sql` (new) | `runtime_capabilities_v2()` manifest + internal `runtime_schema_generation()` / `runtime_realtime_tables()` helpers, locked down |
| `supabase/tests/phase34_runtime_capabilities_test.sql` (new) | Manifest auth/signature/allowlist/helper-lockdown/old-client assertions |
| `supabase/tests/phase34_social_contract_test.sql` (new) | Deployed friends/DM/group/block/discovery/presence contract verification with three accounts |

### Contracts (`shared/`)

| File | Purpose |
|---|---|
| `shared/runtimeCapabilities.ts` (new) | `RuntimeCapabilityManifestV2`, strict parser, per-feature function requirements, readiness helper |
| `shared/runtimeCapabilities.test.ts` (new) | Parser rejection, missing-key semantics, auth+completeness requirement |
| `shared/safeDiagnostics.ts` (new) | `SafeActionDiagnostic`, allowlisted feature vocabulary, error→outcome mapping, formatter, sanitizer |
| `shared/safeDiagnostics.test.ts` (new) | Field-shape lock, redaction, provider-text exclusion |
| `shared/driveWorkspaceContracts.ts` (new) | `DriveWorkspaceEntry` / `DriveWorkspaceFolder` / `DriveWorkspacePage` / `DriveUploadProgress`, validators, `DriveWorkspaceBridge` |
| `shared/driveWorkspaceContracts.test.ts` (new) | Id/token/name/thumbnail validation, page + entry parsing, option normalization |
| `shared/releaseSmoke.ts` (new) | Closed-vocabulary smoke report, verdict derivation, deterministic exit code |
| `shared/releaseSmoke.test.ts` (new) | Verdict rules, unknown-check dropping, formatter |

### Platform / services (`src/lib/platform/`)

| File | Purpose |
|---|---|
| `src/lib/platform/RuntimeCapabilityService.ts` (new) | Session-settle gate, manifest fetch/cache/invalidate, legacy fallback, `reportOperation` |
| `src/lib/platform/runtimeCapabilityService.test.ts` (new) | Fail-closed behaviour, legacy fallback, dedup, redaction |
| `src/lib/platform/ReleaseSmokeService.ts` (new) | Packaged RC smoke run over config/session/contracts/relay |

### Docs

| File | Purpose |
|---|---|
| `PHASE_34_COMPLETION_REPORT.md` (new) | This report |
| `PHASE_34_TO_43_BACKEND_PLATFORM_HANDOFF.md` (new) | Backend/platform ownership, contracts, deployment order, and later-phase boundaries |
| `CHANGELOG.md`, `STATUS.md`, `TASKS.md` | Phase 34 backend state and deployment gate |

No React components, shared visual CSS, existing migration, Edge Function,
`package.json`, version, or tag was changed.
`social_diagnostics()` (0024) is deliberately left in place.

## 3. Typed frontend contracts

### 3.1 Runtime capability manifest

```ts
// shared/runtimeCapabilities.ts
interface RuntimeCapabilityManifestV2 {
  schemaGeneration: number;   // 34 from migration 0028; 0 = legacy fallback
  authenticated: boolean;     // server-derived from the JWT
  functions: Record<string, boolean>;  // EXACT signature deployment flags
  realtimeTables: string[];   // allowlisted publication members only
}

parseRuntimeManifest(value): RuntimeCapabilityManifestV2 | null  // null on ANY malformation
hasFunctions(manifest, names): boolean          // missing key === not deployed
missingFunctions(manifest, required): string[]  // for actionable UI copy
isFeatureReady(manifest, feature): boolean      // authenticated AND complete
FEATURE_FUNCTION_REQUIREMENTS                   // friends | peopleSearch | roomPeople |
                                                // messaging | groupChat | presence |
                                                // roomMedia | signaling
```

Renderer usage:

```ts
import { runtimeCapabilities, reportOperation } from '@/lib/platform/RuntimeCapabilityService';

runtimeCapabilities.init();                    // once at startup
await runtimeCapabilities.whenSessionSettled(); // BEFORE any capability decision
const manifest = runtimeCapabilities.get();
const unsubscribe = runtimeCapabilities.subscribe(render);
```

`isFeatureReady(manifest, 'messaging') === false` now has a determinate cause:
`manifest.authenticated === false` means signed out;
`missingFunctions(manifest, FEATURE_FUNCTION_REQUIREMENTS.messaging)` names the
migration gap. That distinction is the entire point of the phase.

### 3.2 Safe diagnostics

```ts
// shared/safeDiagnostics.ts
interface SafeActionDiagnostic {
  operationId: string;   // random hex, not derived from any input
  feature: string;       // allowlisted; unknown values become 'unknown'
  outcome: 'success' | 'signed-out' | 'deployment-missing' | 'forbidden' |
           'blocked' | 'rate-limited' | 'offline' | 'conflict' | 'failed';
  authenticated: boolean;
  online: boolean;
  schemaGeneration: number | null;
}
reportOperation(feature, outcome, operationId?): SafeActionDiagnostic
```

There is **no free-text field**. `feature` is validated against a fixed list,
so a call site cannot smuggle a room code or search term into a log line.

### 3.3 Drive workspace (Phase 37 consumes these)

```ts
// shared/driveWorkspaceContracts.ts
interface DriveWorkspaceEntry {
  id: string; parentId: string; name: string;
  kind: 'folder' | 'video'; mimeType: string;
  size: number | null; modifiedAt: string;
  thumbnailUrl: string | null; canDownload: boolean;
}
interface DriveWorkspaceFolder { id: string; name: string; webViewLink: string }
interface DriveWorkspacePage {
  folder: DriveWorkspaceFolder;
  entries: DriveWorkspaceEntry[];
  nextPageToken: string | null;
}
interface DriveUploadProgress {
  uploadId: string; bytesSent: number; totalBytes: number;
  phase: 'preparing' | 'uploading' | 'finalizing' | 'done' | 'cancelled' | 'failed';
}
interface DriveWorkspaceBridge {
  listWorkspace(options?): Promise<DriveWorkspacePage>;
  createWorkspaceFolder(name, parentId?): Promise<DriveWorkspaceFolder | null>;
  authorizeWorkspaceFolder(folderId): Promise<boolean>;
  startWorkspaceUpload(localHandle, parentId?): Promise<string>;
  cancelWorkspaceUpload(uploadId): Promise<void>;
  onUploadProgress(cb): () => void;
  openInDrive(id): Promise<void>;
}
```

Note on naming: the existing `DriveWorkspaceInfo` in `shared/mediaBridge.ts`
uses `folderId`; the handoff's Phase 37 shape uses `id`. I introduced
`DriveWorkspaceFolder` (with `id`) as the NEW contract rather than renaming the
shipped field, so no existing call site breaks. Codex may unify them in Phase 37
with a deliberate migration.

**Scope unchanged:** `drive.file` only, Picker-authorized or app-created items
only. No `drive.readonly`, no full-Drive browsing, no silent grants. Tokens,
Authorization headers, raw Drive responses and filesystem paths never cross the
bridge. `DriveWorkspaceBridge` is a **contract only** in Phase 34 — the Electron
implementation lands in Phase 37, so no capability changes state here.

### 3.4 Release smoke

```ts
// shared/releaseSmoke.ts
type SmokeStatus = 'pass' | 'warn' | 'fail' | 'skipped';
interface ReleaseSmokeReport {
  reportVersion: 1; appVersion: string; packaged: boolean;
  checks: { id: SmokeCheckId; status: SmokeStatus }[];
  verdict: 'pass' | 'warn' | 'fail';
}
smokeExitCode(report): 0 | 1     // fail → 1; pass/warn → 0
runReleaseSmoke(environment): Promise<ReleaseSmokeReport>  // src/lib/platform
```

## 4. Test results

Codex executed the complete lane gate on 2026-07-25:

```powershell
npm ci
npm run typecheck
npm test
npm run build:activity
npm run build -- --publish never
```

New vitest files and their case counts:

| File | Cases | Covers |
|---|---|---|
| `shared/runtimeCapabilities.test.ts` | 6 | parse acceptance/rejection, flag filtering, missing-key semantics, auth+completeness, empty-manifest denial |
| `shared/safeDiagnostics.test.ts` | 9 | field-shape lock, feature normalization, id opacity, formatter output, error mapping, provider-text exclusion, sanitizer |
| `shared/driveWorkspaceContracts.test.ts` | 17 | id/token grammar, page-size clamping, option normalization, folder-name rules, thumbnail host allowlist, entry/page parsing |
| `shared/releaseSmoke.test.ts` | 8 | verdict rules, skipped neutrality, exit codes, unknown-check dropping, formatter |
| `src/lib/platform/runtimeCapabilityService.test.ts` | 10 | publish/subscribe, legacy fallback, malformed fail-closed, offline path, redaction, dedup, reset, `reportOperation` |

Observed total: **48 files and 439 tests, all passing**. The initial review run
found eight timeouts because public capability methods could wait forever when
called before explicit initialization. `whenSessionSettled()` and `refresh()`
now initialize idempotently, and the test fixture supplies a settled empty
session; the targeted 50-test set and the full suite both pass.

## 5. SQL and Edge Function deployment

### Migrations the owner must deploy — in this order

1. **`supabase/migrations/0028_runtime_capabilities_v2.sql`** — the only new
   migration. Requires 0001–0027 already applied.

Grants/RLS/publication changes introduced by 0028:

- `grant execute on function public.runtime_capabilities_v2() to anon, authenticated;`
  (anon is intentional — a signed-out client must be able to learn that it is
  signed out; the function returns deployment facts plus the caller's own auth
  state and nothing about any other user)
- `revoke execute ... from public, anon, authenticated` on
  `runtime_schema_generation()` and `runtime_realtime_tables()` (0025 convention)
- **No table, RLS policy, or publication change.** Nothing is added to
  `supabase_realtime`; the manifest only *reports* what is already there,
  filtered through a four-table allowlist.
- No schema reload or restart required. PostgREST picks up new functions
  automatically; if the owner sees `42883` immediately after deploy, a
  `NOTIFY pgrst, 'reload schema';` resolves the cache.

### Verification commands

```bash
psql "$DISPOSABLE_DB_URL" -v ON_ERROR_STOP=1 \
  -f supabase/tests/phase34_runtime_capabilities_test.sql
# expected final row:
#   phase34 runtime capability test: all assertions passed

psql "$DISPOSABLE_DB_URL" -v ON_ERROR_STOP=1 \
  -f supabase/tests/phase34_social_contract_test.sql
# expected final row:
#   phase34 social contract test: all assertions passed
```

Both scripts run in a single transaction and roll themselves back.

### Edge Functions

**None changed in Phase 34.** `turn-credentials`, `search-youtube`,
`discord-token`, and `log-session` are untouched. No new secrets. No Verify-JWT
changes.

### Backward compatibility with the v0.1.27 client

`social_diagnostics()` is unmodified and still granted to `anon, authenticated`
— assertion 6 of the runtime test verifies it. A v0.1.27 client therefore
behaves identically after 0028 deploys. Conversely, a Phase 34 client against a
pre-0028 database falls back to `social_diagnostics()` automatically and reports
`schemaGeneration: 0`, so the compatibility cycle runs in both directions.

## 6. Capability flags still disabled

| Flag | Still false | Acceptance prerequisite |
|---|---|---|
| `fileWatch` | yes | `PHASE_33_PACKAGED_ACCEPTANCE.md` §C on packaged builds |
| `driveWorkspace` | yes | §D on packaged builds with two Google accounts (Phase 37 implements the workspace UI) |
| `voiceChat` | yes | TURN deployed + §E across different networks |
| `liveShare` | yes | TURN deployed + §F across different networks |
| `publicUserSearch` | unchanged | 0026/0027 already verified; enabling remains an owner decision |
| `roomPeopleActions` | unchanged | as above |

**Phase 34 enables nothing.** It only makes the *reason* a surface is hidden
knowable.

## 7. Known limitations and security review

### Limitations

- `DriveWorkspaceBridge` is a contract with no Electron implementation yet —
  deliberate, per the handoff's "Phase 34 delivers contracts only" instruction.
  Any frontend written against it must stay behind `driveWorkspace`.
- `runtime_capabilities_v2` reports a **static** function list. A function
  deployed under a name absent from that list is invisible to the manifest;
  adding a contract means editing 0028's successor and bumping
  `runtime_schema_generation()`.
- The group-cap assertion in the social test asserts the cap **empirically**
  (adds members until refusal) plus a structural check in the runtime test.
  If a future migration changes the cap constant, both need updating together.
- `runReleaseSmoke` is a library function. Wiring it to a packaged entry point
  (a `--smoke` flag, for example) is a frontend/packaging task; the deterministic
  exit code exists so that wiring is trivial.
- Session-restore correctness is proven by unit tests over the service, not by a
  packaged relaunch. The real proof is the packaged run in §H of the acceptance
  checklist.

### Security review

- **Manifest exposure.** Returns: a schema integer, the caller's own auth
  boolean, deployment booleans for a fixed function list, and an allowlisted
  subset of publication tables. It reveals no user data, no other user's state,
  and no table contents. Anonymous access is a deliberate trade: the alternative
  (auth-gating the diagnostic) reproduces the exact bug where a signed-out user
  cannot learn why everything is hidden.
- **Publication disclosure minimized.** `runtime_realtime_tables()` filters to
  four client-relevant tables rather than returning the publication, because a
  publication listing is a schema map and a schema map is reconnaissance.
- **Helper lockdown.** Both new internal helpers are execute-revoked from
  `public`, `anon`, and `authenticated` in the same migration that creates them,
  following the 0025 remediation convention.
- **Diagnostics cannot leak.** The diagnostic type has no free-text field; the
  only string a caller supplies is `feature`, which is allowlist-normalized.
  `outcomeFromError` inspects codes/status and a small set of our own sentinel
  words, and copies **no** provider message into the result — provider errors
  routinely echo the offending input. A regression test asserts a message
  containing a fake room code never appears in the emitted line.
- **Fail-closed everywhere.** A malformed manifest, an RPC error, or a thrown
  transport yields `emptyManifest()` — no feature is enabled on ambiguity.
- **No RLS relaxation.** The social test verifies the *deployed* contracts and
  is written to fail rather than to be satisfied by loosening policy. Per the
  handoff: a signed-out renderer is never papered over with weaker RLS.
- **Drive scope unchanged.** Contracts describe app-created/Picker-authorized
  items only; `isSafeThumbnailUrl` restricts thumbnails to Google hosts;
  `isValidFolderName` rejects path separators and control characters so a name
  can never render as a path; `normalizeListOptions` drops malformed ids and
  tokens instead of forwarding them to Drive.
- **Compliance untouched.** No YouTube iframe changes, no media relay, no
  recording, no new client-side secrets.

## 8. Git delivery

- Branch: `backend/phase-34-production-parity`.
- Target: `main` through a reviewed feature PR.
- Commit/PR identifiers are recorded in the final Codex handback after push.
- No direct `main` push, version change, tag, or Release workflow run is part
  of Phase 34 delivery.

## 9. Deviations from the handoff, stated plainly

1. `ROADMAP.md` remains owned by the frontend integration lane to avoid a
   needless merge conflict; backend status, tasks, and changelog were updated.
2. The handoff's `DriveWorkspaceInfo { id }` conflicts with the shipped
   `DriveWorkspaceInfo { folderId }`. Resolved by adding
   `DriveWorkspaceFolder { id }` rather than renaming a live field (§3.3).
