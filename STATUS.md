# Current Status

Current Phase:
Phase 2 — Backend Foundation (Supabase Realtime, per ADR-004)

Completed:
✅ Phase 0 — documentation & planning
✅ Phase 1 — desktop foundation (verified: dev window runs, IPC round-trip works)
✅ Supabase client singleton with env validation (src/lib/supabase.ts)
✅ Typed realtime event architecture (shared/events.ts — EventEnvelope + extensible RealtimeEventMap)
✅ RealtimeService channel wrapper (join/leave, typed broadcast send/on)
✅ Channel naming scheme (src/lib/realtime/types.ts)
✅ useConnectionStatus hook + connection indicator in app shell
✅ Production CSP extended for Supabase (https/wss)

Current Work:
Awaiting local verification (`npm install` && `npm run dev` → footer shows "Connected")

Blocked:
None

Next:
Phase 3 — Room System (create/join/leave, host assignment, presence, reconnection)
