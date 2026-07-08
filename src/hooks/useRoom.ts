import { useEffect, useState } from 'react';
import type { GuestIdentity } from '@/lib/identity';
import { realtimeService } from '@/lib/realtime/RealtimeService';
import { RoomService, type RoomState } from '@/lib/room/RoomService';

/**
 * Joins the given room while mounted with a non-null code, and leaves on
 * unmount or when the code changes. Returns live room state, or null when
 * not in a room.
 */
export function useRoom(code: string | null, identity: GuestIdentity | null): RoomState | null {
  const [state, setState] = useState<RoomState | null>(null);

  useEffect(() => {
    if (code === null || identity === null) {
      setState(null);
      return;
    }

    const service = new RoomService(realtimeService, identity, code, (roomState) => {
      if (roomState.status !== 'left') {
        setState(roomState);
      }
    });
    service.join();

    return () => {
      setState(null);
      void service.leave();
    };
  }, [code, identity]);

  return state;
}
