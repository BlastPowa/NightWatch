import { useCallback, useEffect, useState } from 'react';
import type { AppInfo } from '@shared/ipc';
import { HomeScreen } from '@/components/HomeScreen';
import { RoomScreen } from '@/components/RoomScreen';
import { SettingsPanel } from '@/components/SettingsPanel';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useSettings } from '@/hooks/useSettings';
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

type View = 'main' | 'settings';

export function App(): JSX.Element {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [identity, setIdentity] = useState<GuestIdentity | null>(() => loadIdentity());
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [view, setView] = useState<View>('main');
  const connectionStatus = useConnectionStatus();
  const session = useRoom(roomCode, identity);
  const settings = useSettings();

  useEffect(() => {
    document.documentElement.dataset['theme'] = settings.theme;
    document.documentElement.style.setProperty('--nw-accent', settings.accent);
  }, [settings.theme, settings.accent]);

  useEffect(() => {
    let cancelled = false;

    // window.nightwatch only exists inside Electron (injected by preload).
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

  const handleEnterRoom = useCallback((displayName: string, code: string): void => {
    setIdentity((current) =>
      current === null ? createIdentity(displayName) : updateDisplayName(current, displayName),
    );
    setRoomCode(code);
    setView('main');
  }, []);

  const handleLeaveRoom = useCallback((): void => {
    setRoomCode(null);
  }, []);

  const inRoom = roomCode !== null && session !== null && identity !== null;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">◗</span>
          <span className="brand-name">NightWatch</span>
        </div>

        <nav className="side-nav">
          <button
            type="button"
            className={`nav-item${view === 'main' ? ' nav-item-active' : ''}`}
            onClick={() => setView('main')}
          >
            {inRoom ? 'Room' : 'Home'}
          </button>
          <button
            type="button"
            className={`nav-item${view === 'settings' ? ' nav-item-active' : ''}`}
            onClick={() => setView('settings')}
          >
            Settings
          </button>
        </nav>

        {inRoom && (
          <div className="side-room">
            <span className="side-label">Current room</span>
            <span className="side-code">{session.state.code}</span>
            <span className="side-members">
              {session.state.members.length}{' '}
              {session.state.members.length === 1 ? 'person' : 'people'} watching
            </span>
          </div>
        )}

        <div className="side-footer">
          <span className={`status-indicator status-${connectionStatus}`}>
            <span className="status-dot" />
            {STATUS_LABEL[connectionStatus]}
          </span>
          {bridgeError !== null && <span className="side-meta">{bridgeError}</span>}
          {appInfo !== null && (
            <span className="side-meta">
              v{appInfo.version} · Electron {appInfo.electronVersion}
            </span>
          )}
        </div>
      </aside>

      <main className="content">
        {view === 'settings' ? (
          <SettingsPanel />
        ) : inRoom ? (
          <RoomScreen
            room={session.state}
            service={session.service}
            selfId={identity.id}
            onLeave={handleLeaveRoom}
          />
        ) : (
          <HomeScreen initialName={identity?.displayName ?? ''} onEnterRoom={handleEnterRoom} />
        )}
      </main>
    </div>
  );
}
