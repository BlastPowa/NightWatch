# Phase 24 UI backend and platform handoff

Owner: Claude / backend lane

Baseline: `origin/main` at NightWatch `v0.1.22`

Branch: `backend/phase-24-ui-support`

The frontend lane is rebuilding the application shell, Browse, player room, profiles, and messaging. This backend lane supplies only the typed identity, presence, and YouTube metadata contracts needed by those screens. Do not edit React layout components or shared visual CSS.

## Invariants

- Keep the official YouTube IFrame API and existing playback events intact.
- Never expose a private room code through friend presence.
- Keep Discord and Google secrets server-side. Canonical public avatar URLs may be exposed only after host validation.
- Preserve every existing RPC for `v0.1.22` clients. Add versioned RPCs instead of changing an existing signature.
- Treat selected profile borders as server-validated data. Do not broadcast a raw client-selected border in Realtime presence.
- Return the existing `SocialResult<T>` failure categories: `forbidden`, `blocked`, `rate-limited`, `offline`, and `not-ready` where applicable.

## 1. Platform identity and room-member presentation

Keep the public platform identity shape backward-compatible:

```ts
interface PlatformIdentity {
  name: string;
  /** Canonical HTTPS Discord CDN URL, with query/hash removed. */
  avatarUrl: string | null;
}
```

Add one shared helper that accepts only `https://cdn.discordapp.com/...` avatar paths, removes query/hash fragments, rejects credentials and non-HTTPS URLs, and caps the result length. Rendering code will rewrite the canonical URL to `/discordcdn/...` inside Discord Activity.

Extend room presence additively:

```ts
interface PresenceMeta {
  memberId: string;
  displayName: string;
  joinedAt: number;
  streakDays?: number;
  avatarUrl?: string;
}

interface RoomMember {
  id: string;
  displayName: string;
  joinedAt: number;
  isHost: boolean;
  streakDays: number;
  avatarUrl: string | null;
}
```

Validate presence avatar URLs when deriving members. Invalid or missing values become `null`. Old clients that omit the field must continue to join normally.

Acceptance:

- Electron OAuth and Discord Activity identities retain their avatar.
- Invalid hosts, query injection, oversized URLs, and non-HTTPS URLs render the initial fallback.
- Existing room, host-election, and reconnect tests remain green.

## 2. Consent-safe playable friend activity

Add the next available migration with two new RPCs while retaining the old heartbeat and presence RPCs:

```sql
heartbeat_media_presence(
  p_status text,
  p_video_title text default null,
  p_video_id text default null
)

get_friend_presence_v2()
```

Rules:

- `p_video_id` is null or an exact 11-character YouTube video id.
- Store no room code or invite URL.
- `share_online = false` returns no row to friends.
- `share_activity = false` returns the coarse status but null title and video id.
- Only accepted, unblocked friends may receive a row.
- Return the safe display name, canonical avatar URL, and `validated_border(user_id)` alongside activity.
- Stale presence uses the same expiry as the existing implementation.
- Add a `friendMediaPresence` capability probe; the Browse shelf stays hidden until it succeeds.

Expected frontend type:

```ts
interface FriendMediaPresence {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  selectedBorderId: string | null;
  status: 'offline' | 'online' | 'watching' | 'in_party';
  videoTitle: string | null;
  videoId: string | null;
  updatedAt: string;
}
```

SQL tests must cover consent combinations, friendship transitions, blocks in both directions, invalid video ids, stale presence, and the guarantee that no returned column contains a room code.

## 3. YouTube video details

Extend `search-youtube` with `kind: "details"`:

Request:

```json
{ "kind": "details", "videoId": "abcdefghijk", "callerId": "..." }
```

Success response uses the existing normalized result shape:

```ts
interface VideoDetails {
  videoId: string;
  title: string;
  channelTitle: string;
  channelThumbnailUrl: string;
  thumbnailUrl: string;
  durationText: string;
}
```

Implementation rules:

- Reject invalid ids before an upstream request.
- Use one `videos.list(part=snippet,contentDetails)` call and the existing batched channel-thumbnail helper.
- Cache details for 30 minutes and include them in the existing request/rate accounting.
- Return explicit 404/unavailable, 429/rate-limited, 503/not-configured, and generic error outcomes without leaking the API key.
- Do not download or proxy video content.

Add `getVideoDetails(videoId, callerId)` in the typed search service without changing current search/trending signatures.

## Validation and handoff

Run:

```powershell
npm ci
npm run typecheck
npm test
npm run build:activity
npm run build -- --publish never
```

Also run every new SQL/RLS test against a disposable Supabase database. Commit and push with:

```powershell
npm run git:finish -- -Message "feat: add Phase 24 identity presence and video details support" -AutoMerge
```

The frontend lane rebases only after this branch is green and merged. Deployment order is migration first, then `search-youtube`, then frontend capability enablement.

## Deferred Phase 29 boundary

Do not begin Google Drive OAuth, local file streaming, a custom HTML media player, or media-library tables in this branch. Those require a separate reviewed contract after Phases 24-28 pass packaged acceptance. Arbitrary-site downloading, DRM bypass, YouTube downloads, and hosted movie storage are out of scope.
