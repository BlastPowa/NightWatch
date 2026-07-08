import { useEffect, useState } from 'react';
import type { GuestIdentity } from '@/lib/identity';
import { realtimeService } from '@/lib/realtime/RealtimeService';
import { RoomService, type RoomState } from '@/lib/room/RoomService';

export interface RoomSession {
  state: RoomState;
  service: RoomService;
}

/**
 * Joins the given room while mounted with a non-null code, and leaves on
 * unmount or when the code changes. Returns the live session, or null when
 * not in a room.
 */
export function useRoom(code: string | null, identity: GuestIdentity | null): RoomSession | null {
  const [session, setSession] = useState<RoomSession | null>(null);

  useEffect(() => {
    if (code === null || identity === null) {
      setSession(null);
      return;
    }

    const service = new RoomService(realtimeService, identity, code, (state) => {
      if (state.status !== 'left') {
        setSession({ state, service });
      }
    });
    service.join();

    return () => {
      setSession(null);
      void service.leave();
    };
  }, [code, identity]);

  return session;
}
