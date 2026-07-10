import { useCallback, useEffect, useState } from 'react';
import type { AppInfo } from '@shared/ipc';
import { AboutScreen } from '@/components/AboutScreen';
import { BrandMark } from '@/components/BrandMark';
import { HomeScreen } from '@/components/HomeScreen';
import { MyRoomsScreen } from '@/components/MyRoomsScreen';
import { useAuth } from '@/hooks/useAuth';
import { getRoomMeta, type RoomMeta } from '@/lib/rooms/PersistentRoomService';
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
import { getPlatformBridge } from '@/platform/PlatformBridge';

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: 'Connecting…',
  connected: 'Connected',
  error: 'Connection error',
  disconnected: 'Disconnected',
};

type View = 'main' | 'rooms' | 'settings' | 'card' | 'about';

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

  const [fixedRoomCode, setFixedRoomCode] = useState<string | null>(null);
  const [roomMeta, setRoomMeta] = useState<RoomMeta | null>(null);
  const authUser = useAuth();
  const isElectron = getPlatformBridge().kind === 'electron';

  // Persistent-room banner: look the code up when joining (null = ephemeral).
  useEffect(() => {
    if (roomCode === null) {
      setRoomMeta(null);
      return;
    }
    let cancelled = false;
    void getRoomMeta(roomCode).then((meta) => {
      if (!cancelled) {
        setRoomMeta(meta);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [roomCode]);

  useEffect(() => {
    let cancelled = false;
    const bridge = getPlatformBridge();

    if (bridge.kind !== 'electron') {
      setBridgeError(bridge.kind === 'discord' ? 'Discord Activity' : 'Running outside Electron');
    }

    void bridge.getAppInfo().then((info) => {
      if (!cancelled && info !== null) {
        setAppInfo(info);
      }
    });

    void bridge.getFixedRoomCode().then((code) => {
      if (!cancelled) {
        setFixedRoomCode(code);
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
      // Inside a Discord Activity the room is fixed to the voice channel.
      setRoomCode(fixedRoomCode ?? code);
      setView('main');
      achievementTracker.record('room-joined');
    },
    [fixedRoomCode],
  );

  const handleLeaveRoom = useCallback((): void => {
    setRoomCode(null);
  }, []);

  const handleJoinPersistentRoom = useCallback(
    (code: string): void => {
      const fallbackName = authUser?.name ?? '';
      setIdentity((current) => {
        if (current !== null) {
          return current;
        }
        return fallbackName.length > 0 ? createIdentity(fallbackName) : null;
      });
      setRoomCode(code);
      setView('main');
      achievementTracker.record('room-joined');
    },
    [authUser],
  );

  const inRoom = roomCode !== null && session !== null && identity !== null;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <BrandMark />
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
          {isElectron && (
            <button
              type="button"
              className={`nav-item${view === 'rooms' ? ' nav-item-active' : ''}`}
              onClick={() => setView('rooms')}
            >
              My Rooms
            </button>
          )}
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
        {view === 'rooms' && <MyRoomsScreen user={authUser} onJoinRoom={handleJoinPersistentRoom} />}
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
              meta={roomMeta}
              onLeave={handleLeaveRoom}
            />
          ) : (
            <HomeScreen
              initialName={identity?.displayName ?? ''}
              lockedRoom={fixedRoomCode !== null}
              onEnterRoom={handleEnterRoom}
            />
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
