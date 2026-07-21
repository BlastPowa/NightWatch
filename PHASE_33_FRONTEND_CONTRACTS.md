# Phase 33 — Frontend Integration Contracts (backend lane → Codex)

Typed guidance for wiring the Phase 32/33 backend into the UI. Nothing here
requires new backend work; every symbol below exists in the repository.
Codex owns all visual design — this file only states what to call, what comes
back, and what must never be assumed.

Golden rules that apply to every section:

- Capability flags gate visibility. **Hide** gated surfaces; never render a
  dead control.
- Every operation returns a typed outcome. Show the reason, not a spinner
  that never resolves.
- No media bytes, Drive tokens, local paths, raw room codes, or recording
  data may pass through Supabase.
- Nothing interactive may be rendered over the official YouTube iframe.

---

## 1. Capabilities and disabled reasons

```ts
import {
  getRoomMediaCapabilities,
  explainRoomMediaCapabilities,
  isTurnDeployed,
  resetRoomMediaCapabilities,
} from '@/lib/media/roomMediaCapabilities';

const platform = { htmlMedia, googleDrive };      // from the Phase 29 bridge
const caps = await getRoomMediaCapabilities(platform);
const why  = explainRoomMediaCapabilities(platform);
```

`caps` → `RoomMediaCapabilities` (`fileWatch`, `driveWorkspace`, `liveShare`,
`voiceChat`, `publicUserSearch`, `roomPeopleActions`), all false until the
server contracts are deployed.

`why[flag]` → `'available' | 'signed-out' | 'not-deployed' |
'unsupported-platform' | 'relay-not-configured'`. Use it for the actionable
copy behind a hidden or disabled control (e.g. "Sign in to use voice",
"Voice needs a relay — ask the owner to finish setup").

Call `resetRoomMediaCapabilities()` on sign-in/sign-out.

Relay diagnostics without secrets:

```ts
import { getTurnDiagnostics } from '@/lib/rtc/TurnService';
const { configured, provider } = await getTurnDiagnostics(); // 'cloudflare' | 'coturn' | null
```

## 2. Room media modes

```ts
import {
  publishRoomMediaDescriptor,
  getRoomMediaDescriptor,
  reportMediaReadiness,
  getMediaReadinessRoster,
} from '@/lib/media/RoomMediaService';
import { parseRoomMediaMode, mayStartFileWatch } from '@shared/roomComms';
```

- **Publishing** (controller only) carries an optimistic `revision`. On a
  revision conflict, re-read with `getRoomMediaDescriptor` and re-apply the
  user's intent — do not blind-retry.
- **Receiving**: always run the payload through `parseRoomMediaMode`. A
  `not-supported` outcome means an older/newer client — show "update
  NightWatch to join this watch", never a broken player.
- **Host/controller migration**: the controller lease is held by a fresh
  member; when it moves, the new controller republishes at the next revision.
  Viewers need no action beyond re-reading state.
- **Start gating**: `mayStartFileWatch(policy, readinessMap, hostId)` decides
  whether the host's Start control is enabled.

## 3. File-watch readiness

```ts
import { evaluateReadiness } from '@/lib/media/ReadinessProbe';

const { readiness, detail } = await evaluateReadiness(descriptor, {
  probeDriveAccess: (id) => window.nightwatch.media.getDriveFileAccess(id),
  resolveLocalMatch: (d) => window.nightwatch.media.resolveLocalMatch(d),
  canPlayType: (mime) => document.createElement('video').canPlayType(mime) !== '',
});
await reportMediaReadiness(roomCode, revision, readiness);
```

Roster states and the guidance each one implies:

| state | meaning | user action |
|---|---|---|
| `ready` | playable now | none |
| `missing-file` | no matching local copy / not visible in Drive | pick their own copy |
| `permission-required` | Drive access not granted to this viewer | ask host to share, then retry |
| `fingerprint-mismatch` | different file with the same name/size | get the same file |
| `unsupported-codec` | this build cannot decode it | use MP4/WebM the browser supports |
| `buffering` | preparing | wait |
| `offline` | device offline | reconnect |
| `rate-limited` | too many attempts | retry shortly |

`detail` carries safe, already-written copy for each actionable case.

## 4. Google Drive shared viewing (host flow)

```ts
import { DriveShareFlow, probeViewerAccess } from '@/lib/media/DriveShareFlow';

const flow = new DriveShareFlow(bridge, (state) => render(state));
await flow.initialize();
```

Steps are explicit: `connect → workspace → add-file → share-access →
pick-file → publish → done`, with `state.error` carrying a typed, retryable
failure at each step. `auth-expired`/`auth-required` automatically returns the
flow to `connect`.

Critical product truth to reflect in the copy: **NightWatch never grants Drive
access.** Step 4 opens Google's own sharing UI (`openSharingControls()`), and
each viewer proves their own access via `probeViewerAccess`. Never imply that
a host upload makes the file playable for everyone.

## 5. People, friends, presence

```ts
import { searchPeople, getRoomPeople, setPublicHandle, setDiscoverable }
  from '@/lib/people/PeopleService';
```

- `searchPeople(query)` — min 3 normalized chars, max 10 results, excludes the
  caller, blocked pairs, and anyone not opted in.
- `getRoomPeople(roomCode)` — current members → `PublicPerson` with
  `relationship` (`none | friends | pending-incoming | pending-outgoing |
  self`). Requires the caller to be a member; never returns room codes.
- Friend/message/invite/block actions reuse the existing Phase 20B services
  with the returned `userId`.
- Handles are optional and unique; discoverability defaults **off**
  (`setDiscoverable(true)` is an explicit opt-in). Do not change these
  defaults in the UI.

## 6. Voice

```ts
import { VoiceSession } from '@/lib/rtc/VoiceSession';
import { commsLifecycle } from '@/lib/rtc/CommsLifecycle';

if (!VoiceSession.supported()) hideVoiceControls();
const session = new VoiceSession(roomCode, selfId, events);
const unregister = commsLifecycle.registerVoice(session);
const started = await session.start();       // typed outcome
```

- `events.onSnapshot` drives the roster: `phase` (`idle | requesting-permission
  | connecting | connected | reconnecting | ended`), `self` and per-peer
  `{ muted, deafened, speaking }`, plus `endReason`.
- `events.onCapability` reports what the platform actually honoured for
  `echoCancellation` / `noiseSuppression` / `autoGainControl` + device label.
- `setMuted` / `setDeafened` (deafen implies mute). Speaking is suppressed
  while muted.
- Failure states to render: `permission-required` (denied mic),
  `not-supported` (insecure context / no API), `forbidden` (not in the room),
  `rate-limited`, `offline`.
- **A permanent microphone indicator with a stop control must be visible
  whenever `phase` is not `idle`/`ended`.**

## 7. Screen / window share

```ts
const sources = await window.nightwatch.capture.listSources();  // name + thumb
await window.nightwatch.capture.chooseSource(sourceId);          // explicit pick
const share = new ShareSession(roomCode, selfId, events);
commsLifecycle.registerShare(share);
await share.startSharing();
```

- A pick is **single-use and valid 30 s**; capture without one is denied by
  the main process. Call `capture.clearSource()` if the user cancels.
- Viewer side: `startViewing(sharerId, sessionId)` after an explicit click
  (that click is the consent).
- `onPhase` gives `idle | picking-source | connecting | sharing | ended` with
  `ShareEndReason` (`stopped | source-closed | permission-denied |
  viewer-limit | signed-out | window-closed | error`).
- Viewer cap: 7 viewers (8-peer mesh). Beyond that the extra viewer simply
  receives no answer — surface "this share is full".
- **A permanent sharing indicator with a stop control must be visible while
  `phase === 'sharing'`.**

## 8. Lifecycle cleanup (mandatory)

```ts
commsLifecycle.attachWindowHooks(window);        // once at app start
commsLifecycle.endAll('room-leave');             // on leaving a room
commsLifecycle.endAll('signed-out');             // on sign-out
commsLifecycle.endAll('host-migration');         // ends SHARE, keeps voice
```

`pagehide` (window close/navigation) is handled automatically once hooks are
attached. Losing host status must not drop an ongoing call — only the capture.

## 9. Never do these

- Render controls above the YouTube iframe (compliance).
- Send Drive tokens, file paths, media bytes, or room codes through Supabase.
- Claim rooms larger than 8 peers work — the mesh is capped; SFU is unbuilt.
- Enable `voiceChat`/`liveShare` before packaged two-client verification on
  different networks.
- Show a control whose capability flag is false.
