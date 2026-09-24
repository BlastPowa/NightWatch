# NightWatch Entertainment Revamp — Concept Set

This folder is the visual reference for the **NightWatch Entertainment Revamp & Completion** milestone.

Open `index.html` in a browser. The left rail switches between every current top-level NightWatch destination. The Watch destination has two concepts because the same route has two materially different states: the lobby before joining and the active synchronized room.

`previews/` contains a rendered 1440×1000 PNG for every concept plus
`contact-sheet.jpg` for a single-glance review of the complete set.

## Concept coverage

| Concept | Current renderer surface | Intended layout |
| --- | --- | --- |
| Browse | `DiscoveryPanel` | cinematic spotlight, continue shelf, category rails, dense discovery grid |
| Watch lobby | `HomeScreen` | compact invite/create panel beside a branded feature hero |
| Active watch room | `RoomScreen` | player-first theatre canvas, right utility dock, social controls below |
| Parties | `MyRoomsScreen` + invites | scheduled-party spotlight, invite tray, room cards, recent highlights |
| Friends | `FriendsScreen` | friend activity hero, online rail, relationship/search workspace |
| Messages | `MessagesScreen` | three-pane messenger with glass conversation rail and room-aware actions |
| Creator Club | `CreatorClubScreen` | club identity header, bounty board, submissions/moderation side panel |
| Library | `LibraryScreen` | local/Drive source switcher, resume rail, media library grid |
| FAQ | `FaqScreen` | help search hero, category cards, focused accordion answers |
| Settings | `SettingsPanel` | persistent settings category rail with large live-preview detail surface |
| Profile | `UserCard` | profile backdrop, identity card, stat strip, achievements and recent activity |
| About | `AboutScreen` | brand/update hero, release status, changelog cards and diagnostics |

## Shared visual rules

- Pandora/Reel-inspired cinema language: deep black-blue canvas, layered glass, thin luminous borders, rounded media cards, restrained accent glow.
- Content owns the centre; navigation and utilities stay compact. Use wide rails for browsing and two/three-column workspaces only where the task benefits from them.
- Motion is progressive enhancement only. `prefers-reduced-motion` removes ambient animation and hover lift.
- The active room is player-first and never puts app UI over the official YouTube iframe.
- Desktop is primary, but each concept collapses to a bottom-navigation/mobile stack below 900px.

## Implementation order

1. Shared shell, tokens, backdrop and navigation.
2. Browse + lobby.
3. Active room/player + queue/chat/people/moments.
4. Parties + Library.
5. Friends + Messages + Creator Club.
6. Profile + Settings + FAQ + About.
7. Reliability completion, responsive/accessibility pass, installer alignment, packaged smoke.
