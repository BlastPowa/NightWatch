# NightWatch — Full Feature Inventory for UI Design (Codex Brief)

Every feature that exists or is in-flight, organized by surface, so the new
UI layout covers all of them. ✅ = shipped and working. 🔨 = Phase 16, being
built now (backend lane) — design for it, interfaces will be provided.
Compliance constant: nothing interactive is ever rendered over the YouTube
iframe; ads/branding untouched.

## 1. App shell / sidebar

- ✅ Brand mark + wordmark
- ✅ Nav: Home/Room, My Rooms, My Card, Settings, About
- ✅ Current-room card (code, watcher count)
- ✅ Connection status pill (connected / connecting pulse / error) + version
- ✅ Signed-in Discord identity (name/avatar available via useAuth) — currently only shown in My Rooms; sidebar treatment welcome

## 2. Home / lobby

- ✅ Display-name field (prefilled from Discord identity when signed in)
- ✅ Create Room (ephemeral, random code)
- ✅ Join by 6-char code
- ✅ Discord Activity mode: single "Join the Watch Party" button (room fixed to voice channel, name auto-filled, may auto-join with zero prompts)

## 3. Watch room

### Player area
- ✅ YouTube player (official IFrame API), 16:9, empty state + skeleton shimmer
- ✅ Host-only source controls: Link paste / Search tabs, animated Load button
- ✅ Viewer note: "The host controls playback" + live sync-delay readout (~ms)
- ✅ Reaction overlay: floating emoji animations (pointer-events: none)
- ✅ Timeline marker strip below player (reactions pinned to timestamps, hover = emoji + time)
- ✅ Reaction bar: 6 emoji buttons (all members)
- ✅ Video filters applied (brightness/contrast/saturation from Settings)

### Queue ("Up next")
- ✅ Add by link (all members, rate-limited)
- ✅ Vote toggle per entry (▲ count), sorted by votes then age
- ✅ Remove own entry; host removes any
- ✅ Host "▶ Play next" (manual skip / livestream case)
- ✅ Auto-advance to top-voted when video ends
- 🔨 "Add to queue" from search results (search opens to all members)

### Room header
- ✅ Room code chip (click to copy)
- ✅ Persistent room name + "Scheduled …" banner (when the code is a persistent room)
- ✅ Status text (joining / in room / reconnecting)
- 🔨 "Copy invite link" button (nightwatch://join/CODE deep link)

### Chat & members
- ✅ Chat: bubbles, sender + time, self highlighted, smart auto-scroll, pop-in animation
- ✅ System notices: joined / left / "X is now the host" / delivery failure
- ✅ Profanity filter (sender-side, toggle in Settings)
- ✅ Member list: name, (you), HOST badge; host migrates automatically
- ✅ Leave Room

## 4. Discovery & Watch Hub (🔨 Phase 16 — new surface, design needed)

- 🔨 Search results as a LIBRARY GRID: large thumbnails, title, channel,
  duration; per-card actions: Play now (host) / Add to queue (everyone)
- 🔨 Trending tab: mostPopular grid with category chips (Music, Gaming,
  Film…) — browsable without typing
- 🔨 "Previously watched" shelf for persistent rooms (room history from DB):
  watch again / queue again
- 🔨 States needed: not-configured (Edge Function missing), rate-limited,
  loading skeletons, empty results

## 5. My Rooms (persistent rooms — desktop only)

- ✅ Signed-out state: pitch + "Sign in with Discord" + error display
- ✅ Signed-in header: avatar, name, X/10 rooms, sign out
- ✅ Create: name + optional datetime schedule
- ✅ Room rows: name, permanent code, schedule; Join / Schedule (edit) / Delete
- 🔨 Copy-invite-link per room

## 6. My Card (engagement — local)

- ✅ Avatar initial, display name, unlocked count
- ✅ Stat tiles: rooms, watch time, reactions, messages, videos loaded
- ✅ 8-achievement grid (locked/unlocked treatments)
- ✅ Unlock toast (bottom-right, any screen)
- Future (Phase 18, design-aware but not now): cross-device sync, friend
  leaderboards, watch streaks

## 7. Settings

- ✅ Discord: Rich Presence toggle (never shows room code)
- ✅ Chat: profanity filter toggle
- ✅ Accent color: 8 swatches (runtime CSS var --nw-accent)
- ✅ Background/theme: Electric Teal / Shiny Gold / Legacy swatches
- ✅ Volume slider (official player API, persisted)
- ✅ Video filter sliders + reset
- ✅ Reset to NightWatch default

## 8. About

- ✅ Version / Electron / platform info
- ✅ Check for Updates with live states: dev / checking / downloading % /
  downloaded ("Restart & Update", silent install) / up-to-date / error
- ✅ Patch notes (bundled CHANGELOG)

## 9. Platform variants to design for

- ✅ Desktop Electron (primary, min 940×600)
- ✅ Discord Activity (compact viewport; My Rooms hidden; room locked to
  voice channel; Discord identity; guest fallback)
- ✅ Sub-900px responsive collapse (sidebar → rail, chat below player)

## Interfaces available for the Phase 16 grid (backend lane, shipped)

```ts
// src/lib/search/SearchService.ts
interface SearchResult { videoId; title; channelTitle; thumbnailUrl; durationText }
searchYouTube(query, callerId): Promise<SearchOutcome>
getTrending(categoryId, callerId): Promise<SearchOutcome>   // '' = all
TRENDING_CATEGORIES: { id, label }[]                        // chip data
// SearchOutcome.status: 'ok' | 'not-configured' | 'rate-limited' | 'error'

// src/lib/rooms/HistoryService.ts
interface HistoryEntry { videoId; title; watchedAt }
listHistory(roomCode): Promise<HistoryEntry[]>   // [] for ephemeral rooms
// recordWatch is already wired (host-side, automatic)

// shared/room.ts
buildInviteLink(code): string          // nightwatch://join/CODE
// Deep link arrival is already wired: opening an invite link brings the
// app forward and joins (after the name prompt for first-run users).

// Queue add from search (all members): useQueue's add(videoId, title, selfName)
```

## 10. Later phases (do NOT design yet — listed so layouts leave room)

- Phase 17: Creator/Host tools — retention graph, reaction-density timeline,
  highlight export, premiere events (opt-in analytics, ADR-014)
- Phase 18: Gamification upgrade — leaderboards, streaks, shared achievements
- Custom installer UI (separate Codex+Fable collab, NSIS)
