import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { AppInfo } from '@shared/ipc';
import type { ConnectionStatus } from '@/lib/realtime/types';
import { BrandMark } from '@/components/BrandMark';
import { Icon, type IconName } from '@/components/Icon';
import { NotificationCenter } from '@/components/NotificationCenter';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { TitleBar } from '@/components/TitleBar';
import { OnboardingTour } from '@/components/OnboardingTour';
import { FriendActivityDrawer } from '@/components/FriendActivityDrawer';

export type AppView =
  | 'main'
  | 'discover'
  | 'rooms'
  | 'friends'
  | 'messages'
  | 'creator'
  | 'library'
  | 'faq'
  | 'settings'
  | 'card'
  | 'about';

interface AppShellProps {
  children: ReactNode;
  view: AppView;
  onNavigate(view: AppView): void;
  isElectron: boolean;
  capabilities: {
    friends: boolean;
    messaging: boolean;
    creatorClubs: boolean;
    notifications: boolean;
    library: boolean;
  };
  room: {
    active: boolean;
    code: string;
    name: string;
    memberCount: number;
  };
  identity: {
    name: string;
    avatarUrl: string | null;
    connected: boolean;
    connectionLabel?: string;
  };
  runtime: {
    connectionStatus: ConnectionStatus;
    bridgeError: string | null;
    appInfo: AppInfo | null;
  };
  search: {
    query: string;
    busy: boolean;
    onQueryChange(query: string): void;
    onSubmit(query: string): void;
  };
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: 'Connecting…',
  connected: 'Connected',
  error: 'Connection error',
  disconnected: 'Disconnected',
};

interface NavItem {
  view: AppView;
  label: string;
  icon: IconName;
  visible: boolean;
}

export function AppShell({
  children,
  view,
  onNavigate,
  isElectron,
  capabilities,
  room,
  identity,
  runtime,
  search,
}: AppShellProps): JSX.Element {
  const [friendActivityOpen, setFriendActivityOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const mobileMoreButtonRef = useRef<HTMLButtonElement>(null);
  const mobileMoreMenuRef = useRef<HTMLDivElement>(null);
  const watchItems: NavItem[] = [
    { view: 'discover', label: 'Browse', icon: 'home', visible: true },
    { view: 'main', label: room.active ? 'Room' : 'Join', icon: 'play', visible: true },
    { view: 'rooms', label: 'Parties', icon: 'parties', visible: isElectron },
    { view: 'library', label: 'Library', icon: 'library', visible: capabilities.library },
    // Keep account-backed destinations discoverable. Their screens explain
    // whether Discord sign-in, deployment, or connectivity is required.
    { view: 'friends', label: 'Friends', icon: 'friends', visible: true },
    { view: 'messages', label: 'Messages', icon: 'message', visible: true },
    { view: 'creator', label: 'Creator Club', icon: 'creator', visible: true },
  ];
  const userItems: NavItem[] = [
    { view: 'settings', label: 'Settings', icon: 'settings', visible: true },
    { view: 'faq', label: 'FAQ', icon: 'help', visible: true },
    { view: 'about', label: 'About', icon: 'info', visible: true },
  ];
  const visibleItems = [...watchItems, ...userItems].filter((item) => item.visible);
  const mobilePreferredViews: readonly AppView[] = ['discover', 'main', 'friends', 'messages'];
  const mobilePrimaryItems = [
    ...mobilePreferredViews
      .map((primaryView) => visibleItems.find((item) => item.view === primaryView))
      .filter((item): item is NavItem => item !== undefined),
    ...visibleItems.filter((item) => !mobilePreferredViews.includes(item.view)),
  ].slice(0, 4);
  const mobilePrimaryViews = mobilePrimaryItems.map((item) => item.view);
  const mobileMoreItems = visibleItems.filter((item) => !mobilePrimaryViews.includes(item.view));

  useEffect(() => {
    if (!mobileMoreOpen) return undefined;

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (mobileMoreMenuRef.current?.contains(target) || mobileMoreButtonRef.current?.contains(target)) return;
      setMobileMoreOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [mobileMoreOpen]);

  function submitSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const query = search.query.trim();
    if (query !== '' && !search.busy) search.onSubmit(query);
  }

  return (
    <div className={`app app-cinematic-shell app-view-${view}`} data-revamp="entertainment">
      <TitleBar subtitle={room.active ? room.name : undefined} />
      <div className="cinematic-ambient" aria-hidden="true" />
      <aside className="sidebar">
        <div className="brand">
          <BrandMark />
          <span className="brand-name">NightWatch</span>
        </div>

        <nav className="side-nav" aria-label="NightWatch">
          <NavSection label="Watch" items={watchItems} active={view} onNavigate={onNavigate} />
          <NavSection label="You" items={userItems} active={view} onNavigate={onNavigate} />
        </nav>

        <nav className="mobile-nav" aria-label="Primary mobile navigation">
          {mobilePrimaryItems.map((item) => (
            <MobileNavButton key={item.view} item={item} active={view === item.view} onNavigate={onNavigate} />
          ))}
          <div className="mobile-nav-more">
            <button
              ref={mobileMoreButtonRef}
              type="button"
              className={`mobile-nav-button${mobileMoreOpen || mobileMoreItems.some((item) => item.view === view) ? ' mobile-nav-button-active' : ''}`}
              aria-label="More navigation options"
              aria-haspopup="menu"
              aria-expanded={mobileMoreOpen}
              aria-controls="mobile-navigation-more-menu"
              onClick={() => setMobileMoreOpen((open) => !open)}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                event.preventDefault();
                setMobileMoreOpen(true);
                requestAnimationFrame(() => focusMobileMenuItem(mobileMoreMenuRef.current, event.key === 'ArrowUp' ? 'last' : 'first'));
              }}
            >
              <span className="mobile-nav-more-glyph" aria-hidden="true"><span /><span /><span /></span>
              <span className="mobile-nav-label">More</span>
            </button>
            {mobileMoreOpen && (
              <div
                ref={mobileMoreMenuRef}
                id="mobile-navigation-more-menu"
                className="mobile-nav-more-menu"
                role="menu"
                aria-label="More navigation"
                onKeyDown={(event) => handleMobileMenuKeyDown(event, mobileMoreMenuRef.current, () => {
                  setMobileMoreOpen(false);
                  mobileMoreButtonRef.current?.focus();
                })}
              >
                {mobileMoreItems.map((item) => (
                  <button
                    key={item.view}
                    type="button"
                    role="menuitem"
                    className={`mobile-nav-more-item${view === item.view ? ' mobile-nav-more-item-active' : ''}`}
                    aria-current={view === item.view ? 'page' : undefined}
                    onClick={() => {
                      setMobileMoreOpen(false);
                      onNavigate(item.view);
                    }}
                  >
                    <span className="nav-icon"><Icon name={item.icon} /></span>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </nav>

        {room.active && (
          <button type="button" className="side-room" onClick={() => onNavigate('main')}>
            <span className="side-label">Current room</span>
            <span className="side-code">{room.code}</span>
            <span className="side-members">{room.memberCount} {room.memberCount === 1 ? 'person' : 'people'} watching</span>
          </button>
        )}

        <div className="side-footer">
          <span className={`status-indicator status-${runtime.connectionStatus}`}>
            <span className="status-dot" />
            {STATUS_LABEL[runtime.connectionStatus]}
          </span>
          {runtime.bridgeError !== null && <span className="side-meta">{runtime.bridgeError}</span>}
          {runtime.appInfo !== null && <span className="side-meta">v{runtime.appInfo.version} · Electron {runtime.appInfo.electronVersion}</span>}
        </div>
      </aside>

      <main className="content">
        <header className="global-topbar">
          <div className="global-topbar-context">
            <span className="eyebrow">NightWatch</span>
            <strong>{viewLabel(view)}</strong>
          </div>
          <form className="global-search" role="search" onSubmit={submitSearch} data-tour="search">
            <Icon name="search" size={18} />
            <input
              value={search.query}
              onChange={(event) => search.onQueryChange(event.target.value)}
              placeholder="Search videos, creators, and topics"
              aria-label="Search videos, creators, and topics"
            />
            {search.query !== '' && <button type="button" className="global-search-clear" onClick={() => search.onQueryChange('')} aria-label="Clear search"><Icon name="close" size={14} /></button>}
            <button type="submit" className="global-search-submit" disabled={search.busy || search.query.trim() === ''}>{search.busy ? 'Searching…' : 'Search'}</button>
          </form>
          <div className="global-topbar-actions">
            <button type="button" className="button button-primary topbar-room-action" data-tour="room" onClick={() => onNavigate('main')} aria-label={room.active ? 'Open current room' : 'Create or join a room'} title={room.active ? 'Current room' : 'Create or join'}>
              <Icon name="play" size={16} />
              <span>{room.active ? 'Open room' : 'Watch room'}</span>
            </button>
            {capabilities.friends && (
              <button
                type="button"
                className={`topbar-icon friend-activity-trigger${friendActivityOpen ? ' friend-activity-trigger-active' : ''}`}
                onClick={() => setFriendActivityOpen((open) => !open)}
                aria-label="Friend activity"
                aria-expanded={friendActivityOpen}
                title="Friend activity"
              >
                <Icon name="friends" size={18} />
              </button>
            )}
            {capabilities.notifications && <NotificationCenter />}
            <button type="button" className="profile-chip" data-tour="profile" onClick={() => onNavigate('card')} aria-label="Open your profile">
              <ProfileAvatar src={identity.avatarUrl} name={identity.name} />
              <span className="profile-chip-copy"><strong>{identity.name}</strong><small>{identity.connectionLabel ?? (identity.connected ? 'NightWatch account' : 'Local profile')}</small></span>
            </button>
          </div>
        </header>
        {children}
      </main>
      {view === 'discover' && (
        <nav className="cinema-dock" aria-label="Quick navigation">
          <CinemaDockButton view="discover" label="Browse" icon="home" active onNavigate={onNavigate} />
          <CinemaDockButton view="main" label={room.active ? 'Open room' : 'Join room'} icon="play" onNavigate={onNavigate} />
          {isElectron && <CinemaDockButton view="rooms" label="Parties" icon="parties" onNavigate={onNavigate} />}
          {capabilities.friends && <CinemaDockButton view="friends" label="Friends" icon="friends" onNavigate={onNavigate} />}
          {capabilities.messaging && <CinemaDockButton view="messages" label="Messages" icon="message" onNavigate={onNavigate} />}
          {capabilities.library && <CinemaDockButton view="library" label="Library" icon="library" onNavigate={onNavigate} />}
          <CinemaDockButton view="settings" label="Settings" icon="settings" onNavigate={onNavigate} />
        </nav>
      )}
      {capabilities.friends && (
        <FriendActivityDrawer
          open={friendActivityOpen}
          onClose={() => setFriendActivityOpen(false)}
          onOpenFriends={() => { setFriendActivityOpen(false); onNavigate('friends'); }}
        />
      )}
      <OnboardingTour
        includeLibrary={capabilities.library}
        currentView={view}
        onNavigate={onNavigate}
      />
    </div>
  );
}

function CinemaDockButton({ view, label, icon, active = false, onNavigate }: { view: AppView; label: string; icon: IconName; active?: boolean; onNavigate(view: AppView): void }): JSX.Element {
  return <button type="button" className={active ? 'cinema-dock-button cinema-dock-button-active' : 'cinema-dock-button'} onClick={() => onNavigate(view)} aria-label={`Quick navigation: ${label}`} title={label}><Icon name={icon} size={18} /></button>;
}

function MobileNavButton({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate(view: AppView): void }): JSX.Element {
  return (
    <button
      type="button"
      className={`mobile-nav-button${active ? ' mobile-nav-button-active' : ''}`}
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      onClick={() => onNavigate(item.view)}
    >
      <span className="nav-icon"><Icon name={item.icon} /></span>
      <span className="mobile-nav-label">{item.label}</span>
    </button>
  );
}

function focusMobileMenuItem(menu: HTMLDivElement | null, target: 'first' | 'last'): void {
  const items = Array.from(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
  if (items.length === 0) return;
  items[target === 'first' ? 0 : items.length - 1]?.focus();
}

function handleMobileMenuKeyDown(event: KeyboardEvent<HTMLDivElement>, menu: HTMLDivElement | null, closeMenu: () => void): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeMenu();
    return;
  }

  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const items = Array.from(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
  if (items.length === 0) return;

  event.preventDefault();
  const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
  if (event.key === 'Home') {
    items[0]?.focus();
    return;
  }
  if (event.key === 'End') {
    items[items.length - 1]?.focus();
    return;
  }

  const step = event.key === 'ArrowDown' ? 1 : -1;
  const nextIndex = currentIndex < 0 ? (step > 0 ? 0 : items.length - 1) : (currentIndex + step + items.length) % items.length;
  items[nextIndex]?.focus();
}

function NavSection({ label, items, active, onNavigate }: { label: string; items: readonly NavItem[]; active: AppView; onNavigate(view: AppView): void }): JSX.Element {
  return <>
    <span className="nav-section-label">{label}</span>
    {items.filter((item) => item.visible).map((item) => <button key={item.view} type="button" data-tour={`nav-${item.view}`} className={`nav-item${active === item.view ? ' nav-item-active' : ''}`} onClick={() => onNavigate(item.view)} aria-label={item.label} aria-current={active === item.view ? 'page' : undefined} title={item.label}><span className="nav-icon"><Icon name={item.icon} /></span><span className="nav-label">{item.label}</span></button>)}
  </>;
}

function viewLabel(view: AppView): string {
  switch (view) {
    case 'main': return 'Watch room';
    case 'discover': return 'Browse';
    case 'rooms': return 'Parties';
    case 'friends': return 'Friends';
    case 'messages': return 'Messages';
    case 'creator': return 'Creator Club';
    case 'library': return 'Library';
    case 'faq': return 'FAQ';
    case 'settings': return 'Settings';
    case 'card': return 'Profile';
    case 'about': return 'About';
  }
}
