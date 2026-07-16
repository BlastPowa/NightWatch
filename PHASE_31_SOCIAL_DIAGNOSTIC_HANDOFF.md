# Phase 31 — Social, Messaging, Realtime, and Room Discovery Diagnostic Handoff

## Owner and branch

Claude owns the backend/platform investigation on:

`backend/phase-31-social-reliability`

Do not edit the visual shell, shared CSS, `MessagesScreen.tsx`, `FriendsScreen.tsx`,
or the Movie Watch renderer while the frontend branch is active. Typed contract
changes and SQL migrations are in scope.

## Reported release symptoms

Two real users on `v0.1.25` reported:

- They can be in the same active watch room but cannot find or add each other.
- Persistent message Send appears unavailable or fails.
- Group creation/member controls appear unavailable.
- Room chat and reactions appear not to work.
- Several controls look disabled at the same time.

Treat this as a shared-state investigation first. Do not assume every symptom is
an independent button bug.

## Important product distinctions

- Connecting a YouTube account does **not** sign the user into NightWatch.
  Friends, persistent messages, groups, profiles, presence, and Creator Club
  require the Supabase/Discord NightWatch session.
- Room chat and YouTube reactions use Supabase Realtime Broadcast. They do not
  use the social SQL RPCs.
- Persistent direct/group messages use the authenticated social RPCs and RLS.
- Reactions are intentionally unavailable until a video is loaded.
- The current co-watcher suggestion model records only signed-in, opted-in users
  in persistent rooms. Ephemeral six-character rooms do not create
  `room_participants` rows because of the persistent-room foreign key. That is
  the main reason two users in an ordinary live room cannot discover each other.

## Required deployment audit

Run these checks against the production Supabase project used by the packaged
release.

### Migration and function presence

```sql
select
  to_regprocedure('public.get_social_graph()') as get_social_graph,
  to_regprocedure('public.send_friend_request(uuid)') as send_friend_request,
  to_regprocedure('public.list_conversations()') as list_conversations,
  to_regprocedure('public.create_group_conversation(text)') as create_group,
  to_regprocedure('public.send_message(uuid,text)') as send_message,
  to_regprocedure('public.get_messages(uuid,bigint,integer)') as get_messages,
  to_regprocedure('public.get_conversation_members(uuid)') as conversation_members,
  to_regprocedure('public.get_friend_presence_v2()') as friend_presence_v2;
```

Every value must be non-null. Verify migrations `0006` through `0010`, `0014`,
`0020`, and `0021` were applied in order.

### Execute grants

```sql
select
  has_function_privilege('authenticated', 'public.get_social_graph()', 'EXECUTE') as graph,
  has_function_privilege('authenticated', 'public.send_friend_request(uuid)', 'EXECUTE') as friend_request,
  has_function_privilege('authenticated', 'public.list_conversations()', 'EXECUTE') as conversations,
  has_function_privilege('authenticated', 'public.create_group_conversation(text)', 'EXECUTE') as create_group,
  has_function_privilege('authenticated', 'public.send_message(uuid,text)', 'EXECUTE') as send_message,
  has_function_privilege('authenticated', 'public.get_messages(uuid,bigint,integer)', 'EXECUTE') as messages;
```

Every value must be true.

### Realtime publication

```sql
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename in ('messages', 'friend_requests')
order by tablename;
```

Both rows must exist. Also verify both tables use `REPLICA IDENTITY FULL`.

### RLS and memberships

For a failing conversation, confirm:

- both users have an active `conversation_members` row;
- `left_at` is null;
- the direct conversation users are still accepted friends;
- neither direction exists in `user_blocks`;
- the caller's JWT subject matches `conversation_members.user_id`;
- `send_message` inserts one row and advances `conversations.updated_at`.

Do not disable RLS to make the tests pass.

## Realtime room diagnostics

Room chat and reactions use the `room:<CODE>` Realtime channel. Capture local
logs for both clients and verify:

- channel status reaches `SUBSCRIBED`;
- Presence `track()` returns `ok`;
- Broadcast `send()` returns `ok`;
- the two users are connected to the same normalized room code;
- no stale duplicate channel object is being reused after leave/rejoin;
- a failed send is logged with event name and safe error status, never message
  content or room secrets.

Because NightWatch renders its own room chat/reaction locally before broadcast,
a click that produces no local result is likely a frontend disabled-state or
pointer issue. Report that clearly rather than changing SQL.

## Required backend addition: live-room co-watcher discovery

The persistent-only `room_participants` model cannot satisfy “add the person I
am watching with right now” in an ephemeral room. Add a short-lived,
security-definer-backed live room presence contract.

Recommended schema:

```sql
create table public.live_room_social_presence (
  room_key_hash text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  presence_id text not null,
  last_seen_at timestamptz not null default now(),
  primary key (room_key_hash, user_id)
);
```

Requirements:

- Never store a raw room code. Store a server-derived keyed hash.
- Direct table access is denied; callers use security-definer RPCs only.
- `heartbeat_live_room_social(p_room_code text, p_presence_id text)`:
  - requires `auth.uid()`;
  - validates the six-character room code and bounded presence id;
  - upserts only the caller;
  - rate limits;
  - returns no other user data.
- `list_live_room_co_watchers(p_room_code text)`:
  - requires the caller to have a fresh heartbeat for the same room;
  - returns only other fresh authenticated users in that room;
  - excludes blocks, accepted friends, and existing live requests;
  - returns safe display name, safe Discord avatar, and validated border;
  - never returns the room code or private stats.
- `leave_live_room_social(p_room_code text)` deletes the caller's row.
- Fresh means at most two minutes old. Add scheduled or opportunistic cleanup.
- A caller who only knows a guessed room code must not be able to enumerate
  users unless they first establish a fresh presence for that exact room.
- Old clients and guests continue working in the room but do not appear in
  social discovery.

Typed frontend result:

```ts
interface LiveRoomCoWatcher {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  selectedBorderId: string | null;
}
```

The frontend will merge these rows into the existing Suggestions section and
send requests through the existing block-aware `send_friend_request` RPC.

## Capability and authentication diagnostics

The frontend capability probe considers an RPC deployed when the error is not
`42883`/`42P01`. Add a diagnostic RPC or structured log output that can
distinguish:

- no NightWatch session;
- RPC missing;
- RLS/permission failure;
- offline;
- deployed and ready.

Do not make YouTube OAuth imply NightWatch authentication. Instead expose a
clear `NightWatch account required` state so the UI can explain why social
actions are unavailable.

## Acceptance tests

- Two Discord/Supabase-authenticated users in the same ephemeral room appear as
  live co-watcher suggestions within one heartbeat.
- Guests do not appear.
- Leaving or timing out removes the suggestion.
- Blocks hide both directions.
- A user cannot enumerate another room by calling the list RPC without a fresh
  matching heartbeat.
- Friend request lifecycle works from the live-room suggestion.
- Direct message send, group creation, member add/remove, unread state, and
  Realtime message delivery work with RLS enabled.
- Room chat and reactions work between two clients; a network failure produces
  safe visible feedback.
- YouTube account connection alone does not unlock social features.
- Migration tests run in a fresh database and on an upgraded production-shaped
  database.

## Handoff output

Claude should return:

1. root cause for each reported symptom;
2. exact migration/RPC changes;
3. RLS and Realtime test results;
4. any required dashboard setting;
5. typed frontend contracts before the frontend integrates them.
