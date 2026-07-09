# Security Review — Phase 12 (MVP)

Checklist against ARCHITECTURE.md §8, performed 2026-07 during Production Preparation.

## Electron hardening

- ✅ `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true` (electron/main.ts)
- ✅ Single minimal preload bridge (`window.nightwatch`); `ipcRenderer` never exposed; push listeners locked to the `update:status` channel only
- ✅ Single-instance lock; `setWindowOpenHandler` denies all window opens and passes only `https://` URLs to the system browser; `will-navigate` allows only the dev server URL or the app's own packaged index
- ✅ No remote module, no `webview` tags

## Content Security Policy

- ✅ Injected at build time only (dev needs React preamble); allows only self, Supabase (https/wss), and YouTube's documented origins (script/frame/img)

## Keys & secrets

- ✅ Only the Supabase anon key and Discord Client ID (both public-by-design) ship in the binary
- ✅ YouTube Data API key lives exclusively as a Supabase Edge Function secret (§7.6); never in the repo or binary
- ⚠️ Service-role/secret Supabase keys were pasted in a chat session during development — owner advised to rotate them in the Supabase dashboard (they are not referenced anywhere in the codebase)

## Untrusted input (broadcast payloads)

- ✅ Envelope shape-check on every incoming broadcast before dispatch (RoomService)
- ✅ Chat: sender name and text type-checked and length-bounded on receipt; rendered as React text nodes only (no `dangerouslySetInnerHTML` anywhere in the codebase)
- ✅ Reactions: emoji validated against fixed palette; positions numeric
- ✅ Playback events: video ids validated against the 11-char id grammar; positions finite, non-negative, bounded (<24h); clocks finite
- ✅ Presence meta: rendered as text; display names bounded at 24 chars on input
- ✅ IPC inputs validated in main (presence state shape/lengths, log level allowlist, message length cap)

## Rate limiting / abuse

- ✅ Client-side: chat 1 msg/500ms, reactions 4/s, search 50/day/caller (Edge Function)
- Accepted (ADR-006): a modified client can bypass client-side limits and host authority; private-room threat model, Edge Function relay documented as the hardening path

## Logging & privacy

- ✅ Local file log only (userData/logs, 512KB rotation); no telemetry, no analytics, no network logging
- ✅ Engagement data device-local only (ADR-009)

## Known accepted limitations (MVP)

- Client-side host enforcement (ADR-006)
- Unsigned Windows binary (SmartScreen warning) — code signing is a future cost decision
- Room codes are capability-style access control: anyone with the code can join (private friend-group model)
