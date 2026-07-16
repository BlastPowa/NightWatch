# Phase 29 backend status — `backend/phase-29-media-library`

Last updated: 2026-07-16.

This branch delivers steps 1, 2, and 5 of the Phase 29 delivery sequence and stops
at the documented capability handoff gate. Nothing is enabled: every new capability
defaults to off, and no UI is wired.

## What is on the branch

| Area | File | State |
| --- | --- | --- |
| Source/capability/result contracts | `shared/media.ts` | Complete, 33 tests |
| Playback adapter + `media:v1:*` events | `shared/mediaPlayback.ts` | Contracts + validators, 23 tests |
| Bridge/lease/handle types | `shared/mediaBridge.ts` | Complete |
| Typed IPC channels | `shared/ipc.ts` | Complete |
| Preload media surface | `electron/preload.ts` | Complete |
| Capability gate | `electron/media/capabilities.ts` | Complete, 11 tests |
| Local pick / streaming SHA-256 / mapping store | `electron/media/mappingStore.ts` | Complete, 22 tests |
| Leases + byte-range parsing | `electron/media/leases.ts` | Complete, 24 tests |
| IPC handlers + `nightwatch-media://` streaming | `electron/media/service.ts` | Complete, 21 tests |
| Platform bridges | `src/platform/*` | Electron delegates; Discord/web `media: null` |
| Library metadata | `supabase/migrations/0022_media_library.sql` | Owner reports applied successfully |
| Library RLS tests | `supabase/tests/phase29_media_library_test.sql` | Owner reports all checks passed |

## Verification actually performed

- `npm run typecheck` — passes.
- `npm test` — 197 tests across 18 files, all passing (79 of them new, in
  `electron/media/`; 56 new in `shared/`).
- `npm run build:activity` — succeeds. Verified by grep that the Activity bundle
  contains no `nightwatch-media`, `pickLocalFile`, or `pickDriveFile` symbol: with
  `media: null` the whole surface tree-shakes out.
- Electron renderer build — verified the production CSP emits
  `media-src 'self' nightwatch-media: blob:;`.
- `npm run build -- --publish never` — succeeds and creates the Windows NSIS
  installer plus blockmap.
- Owner database run — migration `0022` applied and
  `phase29_media_library_test.sql` reported all checks passing.

## Not verified — owner action required

- The packaged Windows local-playback test (selection, range seeking, same-size
  replacement rejection, app restart) still needs owner interaction.
- Two-client synchronization remains a later delivery step: only the typed
  `media:v1:*` contracts exist on this branch.

## Deliberately deferred

**Google Drive (delivery step 3) is not implemented.** The handoff is explicit:
"Do not start Drive authorization or room synchronization before the contract and
local-file security tests are green." Those tests are green as of this branch, so
Drive is the next branch's work.

What exists today: the full typed Drive surface (`connectDrive`, `pickDriveFile`,
`disconnectDrive`, Drive descriptors, Drive error codes). Every call returns a typed
`capability-disabled` failure, and `capabilities.reasons.googleDrive` is
`security-review-required`. `resolveCapabilities()` pins Drive off behind an
internal `driveImplemented = false` regardless of the environment flag — the flag
exists so the surface is testable, not so Drive can be switched on early. There is a
test asserting exactly this.

**Room synchronization (delivery step 4) is contracts only.** The `media:v1:*` event
map, validators, host-authority list, revision rules, and session gating all exist
and are tested. Nothing is registered on a room channel: `MEDIA_V1_EVENTS` is
deliberately absent from `ROOM_EVENTS`, and there is a test that fails if someone
adds it. Wiring the SyncEngine is the follow-up.

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
| `NIGHTWATCH_ENABLE_DRIVE` | unset (off) | Reserved. Has no effect while Drive is gated. |
| `NIGHTWATCH_GOOGLE_CLIENT_ID` | unset | Reserved for the desktop OAuth client. |
| `NIGHTWATCH_ENABLE_LIBRARY` | unset (off) | `1` enables cloud Library metadata. |
| `NIGHTWATCH_MAX_MEDIA_BYTES` | 32 GiB | Packaged-app size ceiling. |

No credentials are committed. Google Cloud setup (desktop OAuth client, consent
screen, Picker API key/application ID) is not yet required, because Drive is not
implemented.

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
files return real data once `NIGHTWATCH_ENABLE_LOCAL_FILES=1`; Drive returns
`capability-disabled` until the next branch.
