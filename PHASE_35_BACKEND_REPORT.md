# Phase 35 backend report — Discord social surface & opaque room invites

For: Codex (frontend + Git/validation lane) and the owner.
Author: backend/platform lane. Date: 2026-07-25.

## Validation honesty statement

My command sandbox is unavailable (`HYPERVISOR_VIRT_DISABLED`), so I ran no
npm, git, or psql command in this session. Every claim below is marked with how
it was verified.

| Artifact | Verification |
| --- | --- |
| `supabase/migrations/0029_room_invite_tokens.sql` | **executed by the owner — applied successfully** |
| `supabase/tests/phase35_invite_token_test.sql` | **executed by the owner — all assertions passed** |
| All TypeScript | **written, not compiled, not tested.** Codex must run the gates. |

## Read this first: branch

These files were authored in the worktree while
`backend/phase-34-production-parity` was checked out and under validation.

**They must not ship in the Phase 34 PR.** After Phase 34 merges, cut
`backend/phase-35-discord-social` from `origin/main` and move the file list
below onto it. I performed no Git operations.

## What Phase 35 solves

The owner asked for a Discord friends list, invite-from-Activity, and room
sharing. Two findings shaped the result.

**1. There is no Discord friends list available to us.** `relationships.read`
is whitelist-only and is not granted to ordinary applications. Any UI that
claims to show Discord friends would fail at Discord's API, not at our code.
The honest surface is *people currently in this Activity* plus Discord's own
invite dialog, backed by NightWatch's existing friend graph for anything
cross-platform.

**2. Sharing a room must not share the room code.** The obvious Rich Presence
implementation puts the code in a `joinSecret`. A room code is a permanent,
reusable credential, so anyone who ever saw that payload could rejoin forever —
and a Discord channel keeps history indefinitely. The owner rejected accepting
that trade-off and asked for a workaround. The workaround is the invite token.

## The invite token

Presence and share links carry a **token**, never a code:

- **opaque** — 32 random hex characters (`gen_random_bytes(16)`), encoding
  nothing about the room;
- **short-lived** — 15 minutes by default, clamped server-side to 60–3600s
  regardless of what the client asks for;
- **single-use** — redemption marks it spent;
- **revocable** — the issuer can kill an outstanding token;
- **block-aware** — checked in both directions at redemption;
- **membership-gated** — only a *current* room member (fresh presence
  heartbeat) can mint one, so knowing a code is not enough;
- **rate-limited** — 30 per issuer per hour.

Redemption returns one **indistinguishable `forbidden`** for missing, spent,
expired, and revoked tokens, so a holder cannot probe which tokens exist. The
row is taken `FOR UPDATE`, so two simultaneous redemptions cannot both win.

Net effect: an intercepted token is already dead, or dies on first use by its
intended recipient. The room code crosses the wire exactly once,
server-to-redeemer, at redemption.

Deep-link form: `nightwatch://invite/<32 hex>`.

## Files

**New**

| File | Purpose |
| --- | --- |
| `supabase/migrations/0029_room_invite_tokens.sql` | table + `mint_room_invite_token(text,integer)`, `redeem_room_invite_token(text)`, `revoke_room_invite_token(text)`, internal `under_limit_invite_tokens(uuid)`. RLS forced, zero client table privileges. |
| `supabase/tests/phase35_invite_token_test.sql` | 10 assertion blocks incl. a preflight that fails loudly if 0029 is absent. |
| `shared/inviteToken.ts` | pure token/link helpers, shared by main and renderer. |
| `shared/inviteToken.test.ts` | shape + link-parsing cases. |
| `src/lib/room/InviteTokenService.ts` | typed `mintRoomInvite` / `redeemRoomInvite` / `revokeRoomInvite` over `CommsOutcome`. |
| `src/lib/room/inviteTokenService.test.ts` | ~18 cases, all RPCs mocked. |

**Modified**

| File | Change |
| --- | --- |
| `shared/safeDiagnostics.ts` | added `room.invite-mint/redeem/revoke`, `discord.invite`, `discord.participants` to the closed feature vocabulary. |
| `shared/ipc.ts` | new `IpcChannel.InviteLink` + `onInviteLink` on the renderer API. |
| `electron/main.ts` | routes `nightwatch://invite/<token>`; **also fixes a log leak** — the legacy join path was writing the room code into the log file. |
| `electron/preload.ts` | `onInviteLink` with a `^[0-9a-f]{32}$` guard mirroring the DB constraint. |
| `electron/richPresence.ts` | `largeImageKey: 'nightwatch'` now that the owner uploaded the art. |
| `src/platform/PlatformBridge.ts` | optional `listActivityParticipants?` / `inviteToActivity?` + `PlatformParticipant`, `PlatformInviteOutcome`. |
| `src/platform/discordBridge.ts` | implements both via `getInstanceConnectedParticipants` and `openInviteDialog`. |
| `PHASE_35_DISCORD_SOCIAL_SCOPE.md` | approved design + status table. |

## Two defects found by execution, both now fixed

Recording these because both were invisible to static review, and they argue
for running migrations early rather than at the end of a phase.

1. **`42883` — function does not exist.** 0029 had not been applied. My test
   made this worse: every block used
   `exception when others then if sqlerrm like '%sentinel%' then raise; end if`,
   which swallowed the real error and surfaced it at an unrelated later block.
   Rewritten so every assertion re-raises anything that is not the exact
   expected error, plus a `to_regprocedure` preflight.
2. **`42702` — ambiguous column `expires_at`.** `RETURNS TABLE (token,
   expires_at)` declares OUT variables that collide with the column names in
   the cleanup `DELETE`. Fixed with a table alias. Any future statement in that
   function touching those two columns must alias them.

## What Codex needs to do

1. Move these files to a new branch off `origin/main` after Phase 34 merges.
2. Run the five gates: `npm ci`, `npm run typecheck`, `npm test`,
   `npm run build:activity`, `npm run build -- --publish never`. **None of
   these has been run.** Expect the TypeScript to need at least a small fix.
3. Build the renderer UI — this is the frontend lane and I did not touch it:
   - a Share button that calls `mintRoomInvite(roomCode)` and copies
     `buildInviteTokenLink(token)`; show the expiry, and offer Revoke;
   - `window.nightwatch.onInviteLink(token => redeemRoomInvite(token))` wired
     in `App.tsx` next to the existing `onJoinLink` subscription, joining the
     room the redemption returns;
   - a Discord-only "people in this call" list from
     `bridge.listActivityParticipants?.()`, with an Invite button calling
     `bridge.inviteToActivity?.()`. Both are optional methods — when they are
     `undefined` (Electron, web) the surface must not render at all.
4. Do not surface the token in any UI text, tooltip, log, or error message. It
   belongs in the clipboard and nowhere else.

## What the owner needs to do

- **Done:** 0029 applied, invite-token test passed, Rich Presence art uploaded.
- **Remaining:** confirm the Rich Presence art asset key in the Discord
  Developer Portal (Rich Presence → Art Assets) is exactly `nightwatch`.
  Discord silently ignores an unknown key and falls back to the default app
  icon, so a mismatch will look like "the icon fix didn't work" with no error.

## Explicitly not done

- No Discord friends list (impossible — see above).
- No renderer UI, no visual/CSS changes, no React component edits.
- No version change, no tag, no push to `main`, no release.
- No change to `voiceChat`, `liveShare`, `fileWatch`, or `driveWorkspace`
  gating — those still wait on TURN deployment and packaged two-client
  acceptance per `PHASE_33_PACKAGED_ACCEPTANCE.md`.
