# Phase 21 Platform/Brand Handoff for Opus

Frontend reference: Figma `YIrCEGqx0THUJOpmoYScYj`, node `2235:2839` (exact MCP inspection pending quota reset). Public product rename is pending the owner's chosen name.

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

## Public rename compatibility

- Public display name, wordmark, executable description, shortcuts, installer copy, Discord art, and About copy may change.
- Keep internal app ID, GitHub repo/update feed, Supabase project/schema, localStorage keys, and `nightwatch://` protocol for the first rename release. Add a later compatibility migration only if the owner insists on changing internals.
- Do not implement rename until the owner supplies the exact public name and confirms trademark/domain checks.

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
