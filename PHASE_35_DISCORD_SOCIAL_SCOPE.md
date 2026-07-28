# Phase 35 scope — Discord friends, invites, room sharing, and app icon

Requested by the owner 2026-07-21. This document is the scoped plan plus the
one item the owner can do immediately with no code.

## Status update — 2026-07-25

Backend implementation has started, at the owner's direction, after the
owner rejected the "accept the Rich Presence privacy trade-off" framing with:
*"if the invite share has a privacy issue we can find a work around for it
instead."* The workaround is section 2a below and is now written.

**Branch warning.** These files were authored in the worktree while
`backend/phase-34-production-parity` was still checked out and under
validation. They must be moved onto a fresh branch cut from `origin/main`
after the Phase 34 PR merges. Codex owns that move; nothing here should ship
in the Phase 34 PR.

| Item | State |
| --- | --- |
| `supabase/migrations/0029_room_invite_tokens.sql` | written, **not deployed** |
| `supabase/tests/phase35_invite_token_test.sql` | written, **not executed**; preflight added after a run failed with `42883` because 0029 was not applied |
| `shared/safeDiagnostics.ts` — invite/Discord feature ids | written |
| `src/lib/room/InviteTokenService.ts` | written, **not executed** |
| `src/lib/room/inviteTokenService.test.ts` | written, **not executed** |
| `src/platform/PlatformBridge.ts` — optional social methods | written |
| `src/platform/discordBridge.ts` — participants + invite dialog | written, **not run in a real Activity** |
| `electron/richPresence.ts` — `largeImageKey: 'nightwatch'` | written; depends on the portal asset key matching |
| Renderer UI for any of the above | **not started** — frontend lane (Codex) |

## 2a. The invite-token workaround (approved design)

The obvious Rich Presence "join" implementation puts the room code in a
`joinSecret`. A room code is a permanent, reusable credential, so anyone who
ever saw that payload could rejoin forever. That is why the standing rule is
that room codes never appear in presence.

Instead, presence and share links carry a **token**:

- opaque — 32 random hex characters, mathematically unrelated to the room;
- short-lived — 15 minutes by default, clamped server-side to 60–3600s;
- single-use — redeeming marks it spent;
- revocable — the issuer can kill it;
- block-aware — checked in both directions at redemption;
- mintable only by a **current** room member (fresh presence heartbeat), so
  knowing a code is not enough to mint an invite for it;
- rate-limited to 30 per issuer per hour.

Redemption returns one indistinguishable `forbidden` for missing, spent,
expired, and revoked tokens, so a holder cannot probe which tokens exist. An
intercepted token is therefore already dead, or dies on first use by its
intended recipient — strictly safer than the status quo of pasting a permanent
room code into a Discord channel that keeps history forever.

Deep-link form: `nightwatch://invite/<32 hex>`. The room code appears exactly
once, server-to-redeemer, at redemption.

## 1. "Show my Discord friends list" — what is actually possible

**We cannot list a user's Discord friends.** Discord has no generally
available OAuth scope for the relationship graph; `relationships.read` exists
but is restricted to whitelisted/verified applications and is not granted to
ordinary apps. Any design that assumes NightWatch can enumerate Discord
friends will fail at the API, not at our code.

What IS available, and covers the real intent:

| Source | API | Gives us |
|---|---|---|
| Activity participants | `sdk.commands.getInstanceConnectedParticipants()` | Everyone currently in this Activity instance — real Discord identities |
| Voice channel members | implied by the Activity instance | The people already sitting in the call |
| NightWatch friend graph | `get_social_graph()` (deployed) | Our own accepted friends, cross-platform |
| Discord identity | `discord-token` + `sdk.commands.authenticate` (Phase 32) | The signed-in user's real name/avatar |

**Recommended product framing:** "People in this call" (Activity participants,
one tap to add as a NightWatch friend) plus "My NightWatch friends". That
delivers what the owner wants — invite the people you're actually with —
without promising a friends list we cannot read.

## 2. Invite friends from inside the Discord Activity

Supported natively by the Embedded App SDK:

```ts
// Opens Discord's OWN invite dialog for the current voice channel/Activity.
await sdk.commands.openInviteDialog();
```

Requirements: the Activity must be launched in a context that can be invited
to (voice channel or DM), and the app needs no extra scope. This is the
correct path — NightWatch never constructs a Discord invite itself.

Planned bridge addition (`PlatformBridge`, additive, non-breaking):

```ts
interface PlatformBridge {
  /** Discord Activity only; null elsewhere so the UI hides the control. */
  inviteToActivity?(): Promise<CommsOutcome<void>>;
  listActivityParticipants?(): Promise<
    Array<{ id: string; name: string; avatarUrl: string | null }>
  >;
}
```

## 3. Share room

Two distinct surfaces, both already half-built:

- **Desktop:** `buildInviteLink(code)` → `nightwatch://join/CODE` already
  exists (Phase 16) and the main process already routes it. Phase 35 adds a
  "Copy invite" / "Share" affordance and, optionally, Rich Presence join
  secrets (`partyId` + `joinSecret` + `instance: true` via the existing
  `@xhayper/discord-rpc` connection, listening for `ACTIVITY_JOIN`). The join
  secret must be the room code, which means **presence would then carry the
  room code** — currently forbidden by our own privacy rule (we removed it
  deliberately). Owner decision required: Discord join secrets are delivered
  only to users the host explicitly accepts, so this is defensible, but it is
  a reversal of an earlier decision and should be made knowingly.
- **Activity:** `openInviteDialog()` (§2) is the share action; the room is
  already fixed to the voice channel, so no code needs to travel.

## 4. Discord app icon — owner action, no code needed

The icon is Developer Portal configuration, not something the app ships.
Assets already exist in the repo from the frontend lane:

- `build/nightwatch-mark-512.png` — square app icon
- `build/nightwatch-activity-cover-1024x576.png` — Activity cover art

Steps:

1. https://discord.com/developers/applications → **NightWatch**
2. **General Information → App Icon** → upload `nightwatch-mark-512.png` → Save
3. **Activities → Art Assets**:
   - *Activity icon / square* → `nightwatch-mark-512.png`
   - *Cover image (1024×576)* → `nightwatch-activity-cover-1024x576.png`
4. **Rich Presence → Art Assets** → add `nightwatch-mark-512.png` with the key
   `nightwatch` if the desktop presence should show a large image (the current
   `setActivity` call sends no image key, which is why presence looks bare).
5. Fully quit and reopen Discord — asset changes are cached aggressively and
   can take several minutes to appear.

If Rich Presence should show the logo, the backend lane must also add
`largeImageKey: 'nightwatch'` to `electron/richPresence.ts` — a one-line
change, deliberately deferred so it lands with the uploaded asset rather than
referencing a key that does not exist yet.

## 5. Suggested Phase 35 split

Backend/platform (this lane):
- `PlatformBridge` additions in §2, implemented in `discordBridge.ts`.
- `richPresence.ts` image key (after the asset exists) and, if approved,
  join-secret support with its privacy consequence documented.
- Share-link service wrapper around the existing `buildInviteLink`.

Frontend (Codex):
- "People in this call" and "My NightWatch friends" surfaces.
- Invite / Share affordances, gated on the bridge methods being present.

Owner:
- Upload the three Discord art assets (§4).
- Decide the join-secret question in §3.
