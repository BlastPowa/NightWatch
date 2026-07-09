import { useCallback, useEffect, useState } from 'react';
import type { AppInfo } from '@shared/ipc';
import { AboutScreen } from '@/components/AboutScreen';
import { HomeScreen } from '@/components/HomeScreen';
import { RoomScreen } from '@/components/RoomScreen';
import { SettingsPanel } from '@/components/SettingsPanel';
import { UserCard } from '@/components/UserCard';
import { achievementTracker, type AchievementDef } from '@/lib/engagement/AchievementTracker';
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

type View = 'main' | 'settings' | 'card' | 'about';

export function App(): JSX.Element {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [identity, setIdentity] = useState<GuestIdentity | null>(() => loadIdentity());
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [view, setView] = useState<View>('main');
  const connectionStatus = useConnectionStatus();
  const session = useRoom(roomCode, identity);
  const settings = useSettings();
  const [unlockToast, setUnlockToast] = useState<AchievementDef | null>(null);

  useEffect(() => {
    return achievementTracker.onUnlock((achievement) => {
      setUnlockToast(achievement);
      window.setTimeout(() => setUnlockToast(null), 4000);
    });
  }, []);

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
    achievementTracker.record('room-joined');
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
            className={`nav-item${view === 'card' ? ' nav-item-active' : ''}`}
            onClick={() => setView('card')}
          >
            My Card
          </button>
          <button
            type="button"
            className={`nav-item${view === 'settings' ? ' nav-item-active' : ''}`}
            onClick={() => setView('settings')}
          >
            Settings
          </button>
          <button
            type="button"
            className={`nav-item${view === 'about' ? ' nav-item-active' : ''}`}
            onClick={() => setView('about')}
          >
            About
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
        {view === 'settings' && <SettingsPanel />}
        {view === 'card' && <UserCard displayName={identity?.displayName ?? ''} />}
        {view === 'about' && <AboutScreen />}
        {/* The room stays mounted while other views are open so the player,
            sync engine, and chat survive navigation (host state has no
            server-side source to restore from). */}
        <div style={{ display: view === 'main' ? 'contents' : 'none' }}>
          {inRoom ? (
            <RoomScreen
              room={session.state}
              service={session.service}
              selfId={identity.id}
              onLeave={handleLeaveRoom}
            />
          ) : (
            <HomeScreen initialName={identity?.displayName ?? ''} onEnterRoom={handleEnterRoom} />
          )}
        </div>

        {unlockToast !== null && (
          <div className="unlock-toast">
            <span className="unlock-emoji">{unlockToast.emoji}</span>
            <div>
              <p className="unlock-title">Achievement unlocked!</p>
              <p className="unlock-name">{unlockToast.title}</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
