# Phase 29 backend status

Last updated: 2026-07-16.

Two branches, in the handoff's delivery order:

- `backend/phase-29-media-library` — steps 1, 2, and 5: contracts, the Electron
  local-media platform, and migration `0022`. Pushed; ready for Codex to rebase
  the Phase 29 frontend onto the typed contracts.
- `backend/phase-29-drive` — step 3, built on the branch above: system-browser
  PKCE, safeStorage refresh tokens, the isolated Picker, Drive metadata
  validation, and Drive range streaming.

The owner has since run migration `0022` and `phase29_media_library_test.sql`
successfully, so the Library deployment prerequisite is met; the
`NIGHTWATCH_ENABLE_LIBRARY` flag is now the owner's call.

Every capability still defaults to off, and no UI is wired.

## What is on the branch

| Area | File | State |
| --- | --- | --- |
| Source/capability/result contracts | `shared/media.ts` | Complete, 33 tests |
| Playback adapter + `media:v1:*` events | `shared/mediaPlayback.ts` | Contracts + validators, 23 tests |
| Bridge/lease/handle types | `shared/mediaBridge.ts` | Complete |
| Typed IPC channels | `shared/ipc.ts` | Complete |
| Preload media surface | `electron/preload.ts` | Complete |
| Capability gate | `electron/media/capabilities.ts` | Complete, 13 tests |
| Local pick / streaming SHA-256 / mapping store | `electron/media/mappingStore.ts` | Complete, 22 tests |
| Leases + byte-range parsing | `electron/media/leases.ts` | Complete, 24 tests |
| IPC handlers + `nightwatch-media://` streaming | `electron/media/service.ts` | Complete, 22 tests |
| Platform bridges | `src/platform/*` | Electron delegates; Discord/web `media: null` |
| Library metadata | `supabase/migrations/0022_media_library.sql` | Owner reports applied successfully |
| Library RLS tests | `supabase/tests/phase29_media_library_test.sql` | Owner reports all checks passed |

## Verification actually performed

- `npm run typecheck` — passes.
- `npm test` — 265 tests across 22 files, all passing.
- `npm run build:activity` — succeeds. Verified by grep that the Activity bundle
  contains no `nightwatch-media`, `pickLocalFile`, or `pickDriveFile` symbol: with
  `media: null` the whole surface tree-shakes out.
- Electron renderer build — verified the production CSP emits
  `media-src 'self' nightwatch-media: blob:;`.
- `npm run build -- --publish never` — succeeds and creates the Windows NSIS
  installer plus blockmap. The app preload and isolated Picker preload are built
  as separate single-entry bundles so neither preload is code-split.
- Owner database run — migration `0022` applied and
  `phase29_media_library_test.sql` reported all checks passing.

## Not verified — owner action required

- The packaged Windows local-playback test (selection, range seeking, same-size
  replacement rejection, app restart) still needs owner interaction.
- Two-client synchronization remains a later delivery step: only the typed
  `media:v1:*` contracts exist on this branch.

## Google Drive (step 3) — delivered on `backend/phase-29-drive`

| Area | File | State |
| --- | --- | --- |
| PKCE + loopback + token endpoints | `electron/media/driveAuth.ts` | Complete, 24 tests |
| safeStorage token store | `electron/media/tokenStore.ts` | Complete, 9 tests |
| Metadata validation + range streaming + session | `electron/media/driveClient.ts` | Complete, 22 tests |
| Isolated Picker window | `electron/media/drivePicker.ts`, `public/picker.html`, `electron/media/pickerPreload.ts` | Complete |
| Orchestration (connect/pick/disconnect/lease) | `electron/media/driveManager.ts` | Complete, 11 tests |

Key properties, each with a test: only `drive.file` is requested; state is
verified in constant time and a forged/replayed callback is rejected; the code
never appears in the browser response; there is no plaintext token fallback;
`invalid_grant` clears the credential and reports `auth-expired`; refreshes are
serialized; Picker metadata is never trusted (main re-fetches with the user's own
token); missing `sha256Checksum` is `fingerprint-unavailable`, never a
substitute; `canDownload=false` and trashed files are refused; leases re-check
permission with the participant's own token; the Authorization header cannot
reach the renderer; disconnect always deletes local credentials, revocation
being best-effort.

Drive turns on only when ALL of these hold: `NIGHTWATCH_ENABLE_DRIVE=1`,
`NIGHTWATCH_GOOGLE_CLIENT_ID`, `NIGHTWATCH_GOOGLE_PICKER_API_KEY`, and
`NIGHTWATCH_GOOGLE_APP_ID` are set. Any missing piece reports `not-configured`;
no flag reports `disabled-by-owner`. Per the handoff, the owner enables it only
after OAuth verification and the packaged revocation/range tests — not because
TypeScript builds.

**Room synchronization (delivery step 4) remains contracts only.** The
`media:v1:*` event map, validators, host-authority list, revision rules, and
session gating all exist and are tested. Nothing is registered on a room channel:
`MEDIA_V1_EVENTS` is deliberately absent from `ROOM_EVENTS`, and there is a test
that fails if someone adds it. Wiring the SyncEngine is the next lane.

### Google Cloud setup (owner, before enabling Drive)

1. Create a **Desktop app** OAuth client in Google Cloud Console; set
   `NIGHTWATCH_GOOGLE_CLIENT_ID` (and `NIGHTWATCH_GOOGLE_CLIENT_SECRET` if the
   client has one — it ships in the binary and is not treated as a secret).
2. Configure the consent screen with only the `drive.file` scope.
3. Enable the Google Picker API; create an API key restricted to it; set
   `NIGHTWATCH_GOOGLE_PICKER_API_KEY` and `NIGHTWATCH_GOOGLE_APP_ID` (the
   project number).
4. No credentials are committed anywhere; all of these are environment
   configuration at build/packaging time.

## Supabase deployment steps (owner)

1. Run `supabase/tests/phase29_media_library_test.sql` against a **disposable**
   database first. It creates throwaway users, asserts, and rolls back. Any failure
   aborts with a message naming the case.
2. Apply `supabase/migrations/0022_media_library.sql` to staging, then production.
   It is additive: a new table, its policies, and four RPCs. No existing table,
   policy, or function is altered.
3. Confirm after applying:
   - `media_library_items` exists with RLS enabled **and forced**;
   - four owner-only policies (select/insert/update/delete) are present;
   - `save_media_library_item`, `set_media_library_progress`,
     `export_media_library`, `delete_media_library`, and `clamp_progress` are
     executable by `authenticated`.
4. Leave `NIGHTWATCH_ENABLE_LIBRARY` unset until the above is deployed. The
   capability reports `deployment-required` until then.

Note on the RLS tests: they switch to the `authenticated` role, not just the JWT
claim. The existing Phase 20–24 test files set `request.jwt.claims` alone, which
does not exercise RLS if the running role holds `BYPASSRLS` — worth a look when
those are next touched.

## Configuration keys introduced

All optional; all default to off/safe.

| Key | Default | Effect |
| --- | --- | --- |
| `NIGHTWATCH_ENABLE_LOCAL_FILES` | unset (off) | `1` enables local selection + playback. |
| `NIGHTWATCH_ENABLE_DRIVE` | unset (off) | `1` enables Drive only when every required Google value is configured. |
| `NIGHTWATCH_GOOGLE_CLIENT_ID` | unset | Desktop OAuth client id. |
| `NIGHTWATCH_GOOGLE_CLIENT_SECRET` | unset | Optional desktop client secret; never treated as confidential in the binary. |
| `NIGHTWATCH_GOOGLE_PICKER_API_KEY` | unset | Google Picker API key restricted to the Picker API. |
| `NIGHTWATCH_GOOGLE_APP_ID` | unset | Google Cloud project number used by Picker. |
| `NIGHTWATCH_ENABLE_LIBRARY` | unset (off) | `1` enables cloud Library metadata. |
| `NIGHTWATCH_MAX_MEDIA_BYTES` | 32 GiB | Packaged-app size ceiling. |

No credentials are committed. Drive remains disabled until the owner completes
the Google Cloud setup and packaged OAuth/revocation/range acceptance.

## Boundaries held

- No media is downloaded, cached, proxied, restreamed, or relayed. The private
  scheme serves only a file the user selected on their own device, to their own
  renderer, under a lease that dies with the process.
- YouTube is untouched: same iframe, same `playback:*` events, same validation,
  same tests. Custom media has its own namespace precisely so it cannot reach an
  old client.
- No path, token, credential, media byte, or lease URL can enter Supabase or
  Realtime. The descriptor type cannot express a path; the migration rejects one;
  and tests assert both.

## For Codex

The typed contracts are stable and safe to build against:
`shared/media.ts`, `shared/mediaPlayback.ts`, `shared/mediaBridge.ts`, and
`PlatformBridge.media`.

Read `platform.media === null` as "this platform is YouTube-only — render no
Library or file controls at all", and use `capabilities.reasons.*` to explain a
disabled capability rather than showing a control that fails when pressed. Local
files return real data once `NIGHTWATCH_ENABLE_LOCAL_FILES=1`; Drive becomes
available only when its owner flag and full Google configuration are present.
