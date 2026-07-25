# NightWatch enabled-control inventory

Baseline: `v0.1.27`
Current lane: Phase 34 production parity

This inventory is the release review map for controls that are visible in a
configured desktop build. A control must either reach the listed implementation
or remain hidden behind its capability. A disabled control is allowed only when
the adjacent copy explains the unmet prerequisite.

## Application shell

| Control | Implementation | Expected failure/empty path |
|---|---|---|
| Browse, Room, Parties, Library, Friends, Messages, Creator Club, Settings, FAQ, About | `AppShell.onNavigate` | Capability-backed destinations explain signed-out/not-deployed/offline state. |
| Global search / clear | `AppShell.search.onSubmit` -> Browse search request | Empty query disabled; stale request protection remains in Browse. |
| Watch/Open room | Navigate to the mounted room screen | Lobby appears when not joined; current room opens when joined. |
| Friend activity | `FriendActivityDrawer` | Hidden when Friends capability is absent; privacy-safe empty state otherwise. |
| Notifications | `NotificationCenter` | Hidden when notification RPC is absent. |
| Profile chip | Profile screen | Local identity remains available while signed out. |

## Browse and playback entry points

| Control | Implementation | Expected failure/empty path |
|---|---|---|
| Category chips / previous-next | Browse category request and scroll controller | Loading, missing configuration, rate limit, offline and empty results have distinct states. |
| Discover / Friends watching / Previously watched | Browse view state | Friend tab capability-gated; history has device-local fallback. |
| Play now | Host room load or lobby/create path | Viewer cannot seize host control; unavailable media remains visible with explanation. |
| Queue | Room queue service | Requires an active room and valid YouTube video. |
| Hover preview | One muted official YouTube iframe | Disabled for touch, reduced motion, compact Activity and user preference. |
| Mini-player expand/collapse/return | Reuses mounted `RoomScreen` and player | Hidden when no media is loaded or preference is off. |

## Room

| Control | Implementation | Expected failure/empty path |
|---|---|---|
| Create/join/leave/copy code/invite | Room service and clipboard bridge | Invalid code, disconnected and clipboard fallback paths are surfaced. |
| Load YouTube URL | Host-only YouTube load contract | Invalid URL, viewer role and disconnected failures remain in the form. |
| Play/pause/seek | Official iframe API and sync engine | No NightWatch control overlays the iframe. |
| Queue add/vote/reorder/remove/play next | Queue service | Host/viewer permissions and delivery failures are explicit. |
| Room chat | Awaited transport delivery | Failed draft remains available; disconnected/rate-limit failure is shown. |
| Reactions | Awaited room event | Disabled without media; failed delivery has visible status. |
| Members / moments / discovery tabs | Existing room dock state | Empty and capability-disabled states remain reachable. |
| Timeline notes | Moment-note service | Requires account and matching visibility permission. |
| Voice / live share / file watch | Phase 33 capability manifest | Hidden until TURN/platform/two-client acceptance passes. |

## Friends and activity

| Control | Implementation | Expected failure/empty path |
|---|---|---|
| Search | Local graph filter plus debounced `search_people` after 3 characters | Opted-out/blocked/self users never appear; offline and deployment-missing differ. |
| Room people | `get_room_people` for current members | Membership protected; v0.1.27 co-watcher fallback during manifest rollout. |
| Add / accept / decline / cancel / remove | Friend transition RPCs | Rate limit, block, forbidden, signed-out and offline are typed. |
| Message | Direct conversation path | Requires accepted friendship. |
| Block/unblock | Blocked users panel | Blocking removes messaging, invites, presence and friend-only content server-side. |
| Friend activity drawer | Consent-safe presence service | Never exposes a private room code. |

## Messages

| Control | Implementation | Expected failure/empty path |
|---|---|---|
| Open/search conversation | `list_conversations` plus authorized roster | Signed-out/deployment/offline copy replaces indefinite loading. |
| Send | Await `send_message`, reload messages, refresh conversation | Draft retained on failure; Retry refreshes both paths; safe diagnostic operation is logged. |
| Edit/delete | Ownership-enforced RPC then local acknowledgement | Failure leaves original message; deletion remains a tombstone. |
| Load older | Sequence cursor pagination | Duplicate IDs removed; end of history disables paging. |
| New group / add members | Create group then accepted-friend additions | 30-person cap; partial addition failure opens retry guidance. |
| Group management | Rename, role, remove, ownership transfer, leave | RLS/role failures are typed; owner must transfer before leaving. |
| Realtime updates | Conversation subscription plus 15-second/focus/online refresh | Polling is the fallback, not a second source of authorization. |

## Library and accounts

| Control | Implementation | Expected failure/empty path |
|---|---|---|
| Local file picker | Electron media bridge | Desktop-only; codec/size/fingerprint failures typed. |
| Connect Drive / Picker | System browser PKCE and isolated Google Picker | `drive.file` only; every viewer authorizes independently. |
| Create/open/copy NightWatch Shared | Drive workspace bridge | Auth expiry, missing configuration and clipboard failure are explicit. |
| YouTube account connect/disconnect | Separate `youtube.readonly` bridge | Does not sign into or alter the official iframe player. |
| Full Drive file browser/upload | Phase 37 capability | Not shown until listing/upload contracts and packaged acceptance are deployed. |

## Settings and help

| Control | Implementation | Expected failure/empty path |
|---|---|---|
| Theme/accent/custom atmosphere | `nightwatch:settings` sanitized store | Custom palette includes canvas, surface, panel and two backdrop glows. |
| Backdrop/card/font/density/radius/glow | Root data attributes and CSS variables | Every preset updates the app; duplicate backdrop selectors removed. |
| Custom background | Resized device-local data image | Unsupported/oversize image rejected; never uploaded. |
| Playback/captions | Local settings and official YouTube API parameters | Caption availability remains controlled by YouTube tracks. |
| Social/accessibility toggles | Local store plus presence preference RPC | Presence defaults private; save failure is visible. |
| Reset appearance/all | Confirmed local settings update | Storage key remains backward-compatible. |
| FAQ search/restart onboarding | FAQ and tour store | Tour may be skipped and restarted. |

## Release gate

Automated validation covers typecheck, all tests, Activity build, unpublished
Windows packaging and a packaged main-process resource smoke boot. It does not
replace the two-account packaged acceptance in `PHASE_33_PACKAGED_ACCEPTANCE.md`.
