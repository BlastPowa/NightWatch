# Phase 21 Platform/Brand Handoff for Opus

Frontend reference: Figma `YIrCEGqx0THUJOpmoYScYj`, node `2235:2839` (exact MCP inspection pending quota reset). NightWatch is the final product name; the rename is cancelled.

## Ownership

Opus owns Electron/window/platform and installer work. Codex owns React/CSS Browse, room, chat, social, creator, and design tokens. Coordinate before editing `App.tsx`, `PlayerPanel.tsx`, shared IPC, or packaging config.

## Custom Windows title bar

- Use Electron's supported hidden/custom title-bar configuration, retaining resize, snap layouts, maximize/restore state, accessibility, keyboard behavior, and high-DPI support.
- Add typed, sender-validated IPC for minimize, maximize/restore, close, and maximize-state updates. No generic window-control IPC.
- Expose only those methods through preload/PlatformBridge. Activity/web implementations are safe no-ops and do not render desktop controls.
- Preserve the 940x600 minimum, deep-link focus behavior, updater dialogs, and external-navigation guards.
- Provide a draggable title-bar region with `app-region: drag`; every interactive child must use `no-drag`.

## Custom Windows installer

- Build a branded assisted NSIS installer: welcome, install scope/location, Start Menu/Desktop shortcuts, install progress, finish/launch option, uninstall branding, and upgrade-safe behavior.
- Preserve current `appId`, update publisher/feed, install directory identity, silent updater arguments, and `nightwatch://` registration unless the owner separately approves an internal-identity migration.
- Consume final logo/wordmark/background assets from the frontend brand pack. Do not introduce network-loaded installer assets.
- Verify clean install, upgrade from v0.1.18+, silent auto-update, uninstall, shortcut repair, per-user install, and cancelled installation.

## Public rename — CANCELLED (2026-07-12)

**NightWatch is the final name.** The owner has cancelled the rename.

Do no rename-compatibility work: no brand-neutral naming, no indirection layer for the display name, no holding back on the wordmark. Treat "NightWatch" as permanent in the display name, wordmark, executable description, shortcuts, installer copy, Discord art, and About copy — as well as in the app ID, update feed, Supabase project, localStorage keys, and the `nightwatch://` protocol, which were never going to change anyway.

Anything in this file that assumed a pending rename is void.

## YouTube/player boundary

- NightWatch may add custom play/pause/seek/volume/status controls below or beside the iframe through the official IFrame API.
- Never hide YouTube branding/ads, disable native controls, proxy media, or place interactive UI over the iframe. Reaction animation remains non-interactive only.

## Phase 20C/D integration

- Keep Creator Club and notification capabilities hidden until deployed probes succeed.
- Notification bell reads server notifications, handles unknown kinds, and never trusts payload fields without validation.
- No payments, downloads, YouTube account scopes, subscriptions, or channel administration.

## Validation

- Strict typecheck, Activity build, Electron build with `--publish never`, installer build, packaged two-client room regression, window-control regression, and v0.1.18-to-new-version update test.
- Hand back typed IPC changes before frontend integration and list all deployment/release steps.

## Frontend integration snapshot (2026-07-12)

- `frontend/phase-20b-profile-social` now renders Friends, Messages, presence consent, Moment Notes, profile borders, and Creator Club/bounties behind deployed capability probes.
- Moment-note seeking adds host-only `SyncEngine.seekTo()` and reuses existing playback events; no event payload changed.
- Creator Club exposes only RPC-backed actions. Public club discovery remains absent because there is no moderated directory RPC.
- After `0014` merges, Messages must render system rows as centred notices and expose owner/moderator membership controls while keeping sequence paging.
- Resolve the `first-night` versus `first-room` achievement-border mismatch in a forward migration.
