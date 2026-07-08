import { useEffect, useState } from 'react';
import { realtimeService } from '@/lib/realtime/RealtimeService';
import { ChannelName, type ConnectionStatus } from '@/lib/realtime/types';

/**
 * Tracks realtime connectivity by subscribing to the lightweight system
 * channel. Used by the app shell to surface backend reachability.
 */
export function useConnectionStatus(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');

  useEffect(() => {
    const handle = realtimeService.join(ChannelName.system(), setStatus);
    return () => {
      void handle.leave();
    };
  }, []);

  return status;
}
