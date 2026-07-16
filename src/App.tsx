import { useCallback, useEffect, useState } from 'react';
import type { AppInfo } from '@shared/ipc';
import { generateRoomCode } from '@shared/room';
import { AboutScreen } from '@/components/AboutScreen';
import { AppShell, type AppView } from '@/components/AppShell';
import { DiscoveryPanel } from '@/components/DiscoveryPanel';
import { HomeScreen } from '@/components/HomeScreen';
import { FriendsScreen } from '@/components/FriendsScreen';
import { MyRoomsScreen } from '@/components/MyRoomsScreen';
import { MessagesScreen } from '@/components/MessagesScreen';
import { CreatorClubScreen } from '@/components/CreatorClubScreen';
import { RoomInvitesPanel } from '@/components/RoomInvitesPanel';
import { useAuth } from '@/hooks/useAuth';
import { getRoomMeta, type RoomMeta } from '@/lib/rooms/PersistentRoomService';
import { RoomScreen } from '@/components/RoomScreen';
import { SettingsPanel } from '@/components/SettingsPanel';
import { UserCard } from '@/components/UserCard';
import { achievementTracker, type AchievementDef } from '@/lib/engagement/AchievementTracker';
import { recordParticipation } from '@/lib/social/FriendService';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useSettings } from '@/hooks/useSettings';
import { useRoom } from '@/hooks/useRoom';
import { useSocialCapabilities } from '@/hooks/useSocialCapabilities';
import { createDirectConversation } from '@/lib/social/MessagingService';
import { heartbeat } from '@/lib/social/PresenceService';
import { setProfileAvatar } from '@/lib/social/SocialProfileService';
import {
  createIdentity,
  loadIdentity,
  updateDisplayName,
  withAvatarUrl,
  type GuestIdentity,
} from '@/lib/identity';
import { getPlatformBridge } from '@/platform/PlatformBridge';
import { canonicalDiscordAvatarUrl } from '@/lib/assets';

interface PendingVideo {
  videoId: string;
  title: string;
  mode: 'play' | 'queue';
  positionSeconds?: number;
}

export function App(): JSX.Element {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [identity, setIdentity] = useState<GuestIdentity | null>(() => loadIdentity());
  const [roomCode, setRoomCode] = useState<string | null>(null);
  // The Discover grid is the app's home page; the Room (player) page is
  // where a picked video takes you.
  const [view, setView] = useState<AppView>('discover');
  const [platformAvatarUrl, setPlatformAvatarUrl] = useState<string | null>(null);
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [browseSearchRequest, setBrowseSearchRequest] = useState<{ query: string; nonce: number } | null>(null);
  const [browseSearching, setBrowseSearching] = useState(false);
  const [roomHasVideo, setRoomHasVideo] = useState(false);
  const connectionStatus = useConnectionStatus();
  const session = useRoom(roomCode, identity);
  const settings = useSettings();
  const [unlockToast, setUnlockToast] = useState<AchievementDef | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);

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
    document.documentElement.dataset['cardStyle'] = settings.cardStyle;
    document.documentElement.dataset['uiFont'] = settings.uiFont;
    document.documentElement.dataset['reduceMotion'] = String(settings.reduceMotion);
    document.documentElement.dataset['highContrast'] = String(settings.highContrast);
    document.documentElement.dataset['reduceTransparency'] = String(settings.reduceTransparency);
    document.documentElement.dataset['enhancedFocus'] = String(settings.enhancedFocus);
    document.documentElement.style.setProperty('--nw-text-scale', String(settings.textScalePercent / 100));
    document.documentElement.style.setProperty('--nw-accent', settings.accent);
    if (settings.theme === 'custom') {
      document.documentElement.style.setProperty('--nw-bg', settings.customAtmosphere.canvas);
      document.documentElement.style.setProperty('--nw-bg-raised', settings.customAtmosphere.surface);
      document.documentElement.style.setProperty('--nw-bg-sunken', settings.customAtmosphere.panel);
      document.documentElement.style.setProperty('--nw-border', `color-mix(in srgb, ${settings.customAtmosphere.surface} 68%, white)`);
    } else {
      document.documentElement.style.removeProperty('--nw-bg');
      document.documentElement.style.removeProperty('--nw-bg-raised');
      document.documentElement.style.removeProperty('--nw-bg-sunken');
      document.documentElement.style.removeProperty('--nw-border');
    }
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

  // Publish the Discord avatar to the profile row (0020). Without this nobody
  // else can see it: the avatar lives in the auth session, which is private to
  // this client. The server enforces a Discord-CDN allowlist, so a rejected URL
  // simply does not publish rather than becoming a beacon in other people's UI.
  useEffect(() => {
    if (authUser === null) {
      return;
    }
    void setProfileAvatar(canonicalDiscordAvatarUrl(authUser.avatarUrl));
  }, [authUser]);

  // Carry the Discord avatar into room presence (Phase 24). Non-persisted and
  // validated inside withAvatarUrl, so signing out (authUser → null) clears it.
  useEffect(() => {
    setIdentity((current) =>
      current === null ? current : withAvatarUrl(current, authUser?.avatarUrl ?? null),
    );
  }, [authUser]);
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
          setPlatformAvatarUrl(canonicalDiscordAvatarUrl(platformIdentity.avatarUrl));
          setIdentity((current) =>
            withAvatarUrl(
              current === null
                ? createIdentity(platformIdentity.name)
                : updateDisplayName(current, platformIdentity.name),
              platformIdentity.avatarUrl,
            ),
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
    setRoomHasVideo(false);
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

  const handlePlayHighlight = useCallback(
    (code: string, videoId: string, positionSeconds: number): void => {
      const fallbackName = authUser?.name ?? '';
      setIdentity((current) => current ?? (fallbackName.length > 0 ? createIdentity(fallbackName) : null));
      setRoomCode(code);
      setPendingVideo({ videoId, title: 'Highlight reel', mode: 'play', positionSeconds });
      setView('main');
      achievementTracker.record('room-joined');
    },
    [authUser],
  );

  const inRoom = roomCode !== null && session !== null && identity !== null;
  const selfIsHost =
    inRoom && session.state.members.some((m) => m.id === identity.id && m.isHost);

  // Consent is enforced server-side. Heartbeats carry only a coarse state and
  // never a private room code; opted-out accounts remain invisible.
  useEffect(() => {
    if (authUser === null) return;
    const publish = (): void => { void heartbeat(inRoom ? 'in_party' : 'online'); };
    publish();
    const timer = window.setInterval(publish, 45_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [authUser, inRoom]);

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

  const displayName = authUser?.name ?? identity?.displayName ?? 'Guest';
  const displayAvatarUrl = canonicalDiscordAvatarUrl(authUser?.avatarUrl ?? platformAvatarUrl);

  const handleGlobalSearch = useCallback((query: string): void => {
    const clean = query.trim();
    if (clean === '') return;
    setView('discover');
    setBrowseSearchRequest((current) => ({ query: clean, nonce: (current?.nonce ?? 0) + 1 }));
  }, []);

  return (
    <AppShell
      view={view}
      onNavigate={setView}
      isElectron={isElectron}
      capabilities={socialCapabilities}
      room={{ active: inRoom, code: inRoom ? session.state.code : '', name: roomMeta?.name ?? 'Watch room', memberCount: inRoom ? session.state.members.length : 0 }}
      identity={{ name: displayName, avatarUrl: displayAvatarUrl, connected: authUser !== null || platformAvatarUrl !== null }}
      runtime={{ connectionStatus, bridgeError, appInfo }}
      search={{ query: globalSearchQuery, busy: browseSearching, onQueryChange: setGlobalSearchQuery, onSubmit: handleGlobalSearch }}
    >
        {view === 'discover' && (
          <div className="discover-layout discover-layout-full fade-up">
            <div className="discover-main">
              <DiscoveryPanel
                callerId={identity?.id ?? 'anonymous'}
                isHost={inRoom ? selfIsHost : true}
                roomCode={roomCode ?? ''}
                searchRequest={browseSearchRequest}
                friendMediaPresence={socialCapabilities.friendMediaPresence}
                onSearchBusyChange={setBrowseSearching}
                onPlayNow={(videoId, title) => handleDiscoverPick(videoId, title, 'play')}
                onQueueAdd={(videoId, title) => {
                  handleDiscoverPick(videoId, title, 'queue');
                  return true;
                }}
              />
            </div>
          </div>
        )}
        {view === 'settings' && <SettingsPanel user={authUser} />}
        {view === 'rooms' && (
          <>
            {socialCapabilities.friends && <RoomInvitesPanel onJoin={handleJoinPersistentRoom} />}
            <MyRoomsScreen user={authUser} onJoinRoom={handleJoinPersistentRoom} onPlayHighlight={handlePlayHighlight} />
          </>
        )}
        {view === 'friends' && socialCapabilities.friends && <FriendsScreen onMessage={(userId) => { void createDirectConversation(userId).then((result) => { if (result.status === 'ok') { setSelectedConversationId(result.data); setView('messages'); } }); }} />}
        {view === 'messages' && socialCapabilities.messaging && authUser !== null && <MessagesScreen initialConversationId={selectedConversationId} currentUserId={authUser.id} />}
        {view === 'creator' && socialCapabilities.creatorClubs && <CreatorClubScreen discoveryEnabled={socialCapabilities.clubDiscovery} />}
        {view === 'card' && <UserCard displayName={authUser?.name ?? identity?.displayName ?? ''} user={authUser} />}
        {view === 'about' && <AboutScreen />}
        {/* A joined room always remains mounted. Navigating away changes the
            presentation of the SAME official iframe instead of creating a
            second player, so sync, chat, and host state survive navigation. */}
        {inRoom ? (
          <RoomScreen
            room={session.state}
            service={session.service}
            selfId={identity.id}
            meta={roomMeta}
            presentation={
              view === 'main'
                ? 'full'
                : settings.miniPlayerEnabled && roomHasVideo
                  ? 'mini'
                  : 'hidden'
            }
            pendingVideo={pendingVideo}
            onPendingHandled={() => setPendingVideo(null)}
            onMediaStateChange={setRoomHasVideo}
            onReturnToRoom={() => setView('main')}
            onLeave={handleLeaveRoom}
          />
        ) : (
          view === 'main' && (
            <HomeScreen
              initialName={identity?.displayName ?? ''}
              lockedRoom={fixedRoomCode !== null}
              onEnterRoom={handleEnterRoom}
            />
          )
        )}

        {unlockToast !== null && (
          <div className="unlock-toast">
            <span className="unlock-emoji">{unlockToast.emoji}</span>
            <div>
              <p className="unlock-title">Achievement unlocked!</p>
              <p className="unlock-name">{unlockToast.title}</p>
            </div>
          </div>
        )}
    </AppShell>
  );
}
