import { useCallback, useEffect, useState } from 'react';
import type { AppInfo } from '@shared/ipc';
import { HomeScreen } from '@/components/HomeScreen';
import { RoomScreen } from '@/components/RoomScreen';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useRoom } from '@/hooks/useRoom';
import {
  createIdentity,
  loadIdentity,
  updateDisplayName,
  type GuestIdentity,
} from '@/lib/identity';
import type { ConnectionStatus } from '@/lib/realtime/types';

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: 'Connecting…',
  connected: 'Connected',
  error: 'Connection error',
  disconnected: 'Disconnected',
};

export function App(): JSX.Element {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [identity, setIdentity] = useState<GuestIdentity | null>(() => loadIdentity());
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const connectionStatus = useConnectionStatus();
  const room = useRoom(roomCode, identity);

  useEffect(() => {
    let cancelled = false;

    // window.nightwatch only exists inside Electron (injected by preload).
    // In a plain browser tab (dev-only scenario) skip IPC gracefully.
    if (typeof window.nightwatch === 'undefined') {
      setBridgeError('Running outside Electron');
      return;
    }

    window.nightwatch
      .getAppInfo()
      .then((info) => {
        if (!cancelled) {
          setAppInfo(info);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBridgeError('IPC bridge unavailable');
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleEnterRoom = useCallback(
    (displayName: string, code: string): void => {
      setIdentity((current) =>
        current === null ? createIdentity(displayName) : updateDisplayName(current, displayName),
      );
      setRoomCode(code);
    },
    [],
  );

  const handleLeaveRoom = useCallback((): void => {
    setRoomCode(null);
  }, []);

  return (
    <main className="shell">
      <h1 className="shell-title">NightWatch</h1>
      <p className="shell-subtitle">Watch together. Perfectly in sync.</p>

      {roomCode === null || room === null || identity === null ? (
        <HomeScreen initialName={identity?.displayName ?? ''} onEnterRoom={handleEnterRoom} />
      ) : (
        <RoomScreen room={room} selfId={identity.id} onLeave={handleLeaveRoom} />
      )}

      <footer className="shell-footer">
        <span className={`status-indicator status-${connectionStatus}`}>
          <span className="status-dot" />
          {STATUS_LABEL[connectionStatus]}
        </span>
        {bridgeError !== null && <span className="shell-meta">{bridgeError}</span>}
        {appInfo !== null && (
          <span className="shell-meta">
            v{appInfo.version} · Electron {appInfo.electronVersion} · {appInfo.platform}
          </span>
        )}
      </footer>
    </main>
  );
}
