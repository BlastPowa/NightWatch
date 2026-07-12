import { useCallback, useEffect, useState } from 'react';
import type { AppInfo } from '@shared/ipc';
import { generateRoomCode } from '@shared/room';
import { AboutScreen } from '@/components/AboutScreen';
import { BrandMark } from '@/components/BrandMark';
import { DiscoveryPanel } from '@/components/DiscoveryPanel';
import { HomeScreen } from '@/components/HomeScreen';
import { FriendsScreen } from '@/components/FriendsScreen';
import { MyRoomsScreen } from '@/components/MyRoomsScreen';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { useAuth } from '@/hooks/useAuth';
import { getRoomMeta, type RoomMeta } from '@/lib/rooms/PersistentRoomService';
import { RoomScreen } from '@/components/RoomScreen';
import { NotificationBell } from '@/components/NotificationBell';
import { SettingsPanel } from '@/components/SettingsPanel';
import { TitleBar } from '@/components/TitleBar';
import { UserCard } from '@/components/UserCard';
import { achievementTracker, type AchievementDef } from '@/lib/engagement/AchievementTracker';
import { recordParticipation } from '@/lib/social/FriendService';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useSettings } from '@/hooks/useSettings';
import { useRoom } from '@/hooks/useRoom';
import { useSocialCapabilities } from '@/hooks/useSocialCapabilities';
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

type View = 'main' | 'discover' | 'rooms' | 'friends' | 'settings' | 'card' | 'about';

interface PendingVideo {
  videoId: string;
  title: string;
  mode: 'play' | 'queue';
}

export function App(): JSX.Element {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [identity, setIdentity] = useState<GuestIdentity | null>(() => loadIdentity());
  const [roomCode, setRoomCode] = useState<string | null>(null);
  // The Discover grid is the app's home page; the Room (player) page is
  // where a picked video takes you.
  const [view, setView] = useState<View>('discover');
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
    document.documentElement.dataset['density'] = settings.density;
    document.documentElement.dataset['background'] = settings.backgroundStyle;
    document.documentElement.dataset['reduceMotion'] = String(settings.reduceMotion);
    document.documentElement.dataset['highContrast'] = String(settings.highContrast);
    document.documentElement.dataset['reduceTransparency'] = String(settings.reduceTransparency);
    document.documentElement.dataset['enhancedFocus'] = String(settings.enhancedFocus);
    document.documentElement.style.setProperty('--nw-text-scale', String(settings.textScalePercent / 100));
    document.documentElement.style.setProperty('--nw-accent', settings.accent);
    document.documentElement.style.setProperty('--nw-glow-strength', `${settings.accentGlowPercent}%`);
    document.documentElement.style.setProperty('--nw-radius-lg', `${settings.cornerRadiusPx}px`);
    document.documentElement.style.setProperty(
      '--nw-radius',
      `${Math.max(4, settings.cornerRadiusPx - 4)}px`,
    );
  }, [settings]);

  const [fixedRoomCode, setFixedRoomCode] = useState<string | null>(null);
  const [roomMeta, setRoomMeta] = useState<RoomMeta | null>(null);
  const [pendingJoinCode, setPendingJoinCode] = useState<string | null>(null);
  const [pendingVideo, setPendingVideo] = useState<PendingVideo | null>(null);

  // Invite deep links (nightwatch://join/CODE, Phase 16).
  useEffect(() => {
    if (typeof window.nightwatch === 'undefined') {
      return;
    }
    return window.nightwatch.onJoinLink((code) => {
      setPendingJoinCode(code);
      setView('discover');
    });
  }, []);

  // Complete a pending invite once an identity exists (immediately for
  // returning users; after the name prompt for first-timers).
  useEffect(() => {
    if (pendingJoinCode !== null && identity !== null) {
      setRoomCode(pendingJoinCode);
      setPendingJoinCode(null);
      achievementTracker.record('room-joined');
    }
  }, [pendingJoinCode, identity]);
  const authUser = useAuth();
  const socialCapabilities = useSocialCapabilities(authUser !== null);
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

  // Phase 19: note the co-watch for the friend graph. No-ops for guests,
  // opted-out users, and ephemeral rooms. Keyed on authUser too, so signing in
  // while already in a room still records it.
  useEffect(() => {
    if (roomCode !== null && authUser !== null) {
      void recordParticipation(roomCode);
    }
  }, [roomCode, authUser]);

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

    // Discord Activity: with a platform identity AND a channel-fixed room,
    // skip the name prompt entirely and drop straight into the party.
    void Promise.all([bridge.getFixedRoomCode(), bridge.getPlatformIdentity()]).then(
      ([code, platformIdentity]) => {
        if (cancelled) {
          return;
        }
        setFixedRoomCode(code);
        if (platformIdentity !== null) {
          setIdentity((current) =>
            current === null
              ? createIdentity(platformIdentity.name)
              : updateDisplayName(current, platformIdentity.name),
          );
          if (code !== null) {
            setRoomCode(code);
            achievementTracker.record('room-joined');
          }
        }
      },
    );

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
      // Land on the grid — unless a Discover pick is waiting to play.
      setView(pendingVideo?.mode === 'play' ? 'main' : 'discover');
      achievementTracker.record('room-joined');
    },
    [fixedRoomCode, pendingVideo],
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
      setView('discover');
      achievementTracker.record('room-joined');
    },
    [authUser],
  );

  const inRoom = roomCode !== null && session !== null && identity !== null;
  const selfIsHost =
    inRoom && session.state.members.some((m) => m.id === identity.id && m.isHost);

  /** Discover-page pick: route into a room (existing or new) with it. */
  const handleDiscoverPick = useCallback(
    (videoId: string, title: string, mode: 'play' | 'queue'): void => {
      setPendingVideo({ videoId, title, mode });
      if (roomCode === null) {
        if (identity !== null) {
          // Start a fresh watch party around the pick.
          setRoomCode(generateRoomCode());
          achievementTracker.record('room-joined');
        } else {
          // Name prompt first; the pick applies right after.
          setView('main');
          return;
        }
      }
      // Playing takes you to the room; queueing keeps you browsing.
      if (mode === 'play') {
        setView('main');
      }
    },
    [roomCode, identity],
  );

  return (
    <div className="app">
      <TitleBar subtitle={inRoom ? `Room ${roomCode}` : undefined} />
      <aside className="sidebar">
        <div className="brand">
          <BrandMark />
          <span className="brand-name">NightWatch</span>
        </div>

        <nav className="side-nav">
          <NotificationBell />
          <span className="nav-section-label">Watch</span>
          <button
            type="button"
            className={`nav-item${view === 'discover' ? ' nav-item-active' : ''}`}
            onClick={() => setView('discover')}
          >
            <span className="nav-icon" aria-hidden="true">⌂</span><span className="nav-label">Browse</span>
          </button>
          <button
            type="button"
            className={`nav-item${view === 'main' ? ' nav-item-active' : ''}`}
            onClick={() => setView('main')}
          >
            <span className="nav-icon" aria-hidden="true">▶</span><span className="nav-label">{inRoom ? 'Room' : 'Join'}</span>
          </button>
          {isElectron && (
            <button
              type="button"
              className={`nav-item${view === 'rooms' ? ' nav-item-active' : ''}`}
              onClick={() => setView('rooms')}
            >
              <span className="nav-icon" aria-hidden="true">▣</span><span className="nav-label">Parties</span>
            </button>
          )}
          {socialCapabilities.friends && <button type="button" className={`nav-item${view === 'friends' ? ' nav-item-active' : ''}`} onClick={() => setView('friends')}><span className="nav-icon" aria-hidden="true">♧</span><span className="nav-label">Friends</span></button>}
          <span className="nav-section-label">You</span>
          <button
            type="button"
            className={`nav-item${view === 'card' ? ' nav-item-active' : ''}`}
            onClick={() => setView('card')}
          >
            <span className="nav-icon" aria-hidden="true">◇</span><span className="nav-label">Profile</span>
          </button>
          <button
            type="button"
            className={`nav-item${view === 'settings' ? ' nav-item-active' : ''}`}
            onClick={() => setView('settings')}
          >
            <span className="nav-icon" aria-hidden="true">⚙</span><span className="nav-label">Settings</span>
          </button>
          <button
            type="button"
            className={`nav-item${view === 'about' ? ' nav-item-active' : ''}`}
            onClick={() => setView('about')}
          >
            <span className="nav-icon" aria-hidden="true">i</span><span className="nav-label">About</span>
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

        <button type="button" className="sidebar-profile" onClick={() => setView('card')} aria-label="Open your NightWatch profile">
          <ProfileAvatar src={authUser?.avatarUrl ?? null} name={authUser?.name ?? identity?.displayName ?? 'Guest'} className="sidebar-profile-avatar" />
          <span className="sidebar-profile-copy"><strong>{authUser?.name ?? identity?.displayName ?? 'Guest'}</strong><small>{authUser !== null ? 'Discord connected' : 'Local profile'}</small></span>
          <span className="sidebar-profile-more" aria-hidden="true">›</span>
        </button>

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
        {view === 'discover' && (
          <header className="browse-topbar">
            <div className="browse-topbar-title"><span className="eyebrow">NightWatch</span><strong>Browse</strong></div>
            <div className="browse-topbar-actions">
              <button type="button" className="topbar-icon" onClick={() => setView('main')} aria-label={inRoom ? 'Open current room' : 'Create or join a room'} title={inRoom ? 'Current room' : 'Create or join'}>▶</button>
              <button type="button" className="topbar-icon" onClick={() => setView('settings')} aria-label="Open settings" title="Settings">⚙</button>
              <button type="button" className="profile-chip" onClick={() => setView(authUser !== null && isElectron ? 'rooms' : 'settings')} aria-label="Open account settings">
                <ProfileAvatar src={authUser?.avatarUrl ?? null} name={authUser?.name ?? identity?.displayName ?? 'Guest'} />
                <span className="profile-chip-copy"><strong>{authUser?.name ?? identity?.displayName ?? 'Guest'}</strong><small>{authUser !== null ? 'Discord connected' : 'Local profile'}</small></span>
              </button>
            </div>
          </header>
        )}
        {view === 'discover' && (
          <div className="discover-layout discover-layout-full fade-up">
            <div className="discover-main">
              <DiscoveryPanel
                callerId={identity?.id ?? 'anonymous'}
                isHost={inRoom ? selfIsHost : true}
                roomCode={roomCode ?? ''}
                onPlayNow={(videoId) => handleDiscoverPick(videoId, '', 'play')}
                onQueueAdd={(videoId, title) => {
                  handleDiscoverPick(videoId, title, 'queue');
                  return true;
                }}
              />
            </div>
          </div>
        )}
        {view === 'settings' && <SettingsPanel user={authUser} />}
        {view === 'rooms' && <MyRoomsScreen user={authUser} onJoinRoom={handleJoinPersistentRoom} />}
        {view === 'friends' && socialCapabilities.friends && <FriendsScreen />}
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
              pendingVideo={pendingVideo}
              onPendingHandled={() => setPendingVideo(null)}
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
