import type { FormEvent, ReactNode } from 'react';
import type { AppInfo } from '@shared/ipc';
import type { ConnectionStatus } from '@/lib/realtime/types';
import { BrandMark } from '@/components/BrandMark';
import { Icon, type IconName } from '@/components/Icon';
import { NotificationCenter } from '@/components/NotificationCenter';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { TitleBar } from '@/components/TitleBar';

export type AppView =
  | 'main'
  | 'discover'
  | 'rooms'
  | 'friends'
  | 'messages'
  | 'creator'
  | 'library'
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
  const watchItems: NavItem[] = [
    { view: 'discover', label: 'Browse', icon: 'home', visible: true },
    { view: 'main', label: room.active ? 'Room' : 'Join', icon: 'play', visible: true },
    { view: 'rooms', label: 'Parties', icon: 'parties', visible: isElectron },
    { view: 'library', label: 'Library', icon: 'library', visible: capabilities.library },
    { view: 'friends', label: 'Friends', icon: 'friends', visible: capabilities.friends },
    { view: 'messages', label: 'Messages', icon: 'message', visible: capabilities.messaging },
    { view: 'creator', label: 'Creator Club', icon: 'creator', visible: capabilities.creatorClubs },
  ];
  const userItems: NavItem[] = [
    { view: 'card', label: 'Profile', icon: 'profile', visible: true },
    { view: 'settings', label: 'Settings', icon: 'settings', visible: true },
    { view: 'about', label: 'About', icon: 'info', visible: true },
  ];

  function submitSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const query = search.query.trim();
    if (query !== '' && !search.busy) search.onSubmit(query);
  }

  return (
    <div className="app app-cinematic-shell">
      <TitleBar subtitle={room.active ? room.name : undefined} />
      <aside className="sidebar">
        <div className="brand">
          <BrandMark />
          <span className="brand-name">NightWatch</span>
        </div>

        <nav className="side-nav" aria-label="NightWatch">
          <NavSection label="Watch" items={watchItems} active={view} onNavigate={onNavigate} />
          <NavSection label="You" items={userItems} active={view} onNavigate={onNavigate} />
        </nav>

        {room.active && (
          <button type="button" className="side-room" onClick={() => onNavigate('main')}>
            <span className="side-label">Current room</span>
            <span className="side-code">{room.code}</span>
            <span className="side-members">{room.memberCount} {room.memberCount === 1 ? 'person' : 'people'} watching</span>
          </button>
        )}

        <button type="button" className="sidebar-profile" onClick={() => onNavigate('card')} aria-label="Open your NightWatch profile">
          <ProfileAvatar src={identity.avatarUrl} name={identity.name} className="sidebar-profile-avatar" />
          <span className="sidebar-profile-copy"><strong>{identity.name}</strong><small>{identity.connected ? 'Discord connected' : 'Local profile'}</small></span>
          <Icon name="chevron-right" className="sidebar-profile-more" size={16} />
        </button>

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
          <form className="global-search" role="search" onSubmit={submitSearch}>
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
            <button type="button" className="button button-primary topbar-room-action" onClick={() => onNavigate('main')} aria-label={room.active ? 'Open current room' : 'Create or join a room'} title={room.active ? 'Current room' : 'Create or join'}>
              <Icon name="play" size={16} />
              <span>{room.active ? 'Open room' : 'Watch room'}</span>
            </button>
            {capabilities.notifications && <NotificationCenter />}
            <button type="button" className="profile-chip" onClick={() => onNavigate('card')} aria-label="Open your profile">
              <ProfileAvatar src={identity.avatarUrl} name={identity.name} />
              <span className="profile-chip-copy"><strong>{identity.name}</strong><small>{identity.connected ? 'Discord connected' : 'Local profile'}</small></span>
            </button>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}

function NavSection({ label, items, active, onNavigate }: { label: string; items: readonly NavItem[]; active: AppView; onNavigate(view: AppView): void }): JSX.Element {
  return <>
    <span className="nav-section-label">{label}</span>
    {items.filter((item) => item.visible).map((item) => <button key={item.view} type="button" className={`nav-item${active === item.view ? ' nav-item-active' : ''}`} onClick={() => onNavigate(item.view)} title={item.label}><span className="nav-icon"><Icon name={item.icon} /></span><span className="nav-label">{item.label}</span></button>)}
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
    case 'settings': return 'Settings';
    case 'card': return 'Profile';
    case 'about': return 'About';
  }
}
