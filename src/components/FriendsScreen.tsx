import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  getSocialGraph,
  removeFriend,
  sendFriendRequest,
  type Relation,
  type SocialGraph,
} from '@/lib/social/FriendService';
import { listLiveRoomCoWatchers } from '@/lib/social/LiveRoomSocialService';
import { BlockedUsersPanel } from '@/components/BlockedUsersPanel';
import { Icon } from '@/components/Icon';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { SocialProfileCard } from '@/components/SocialProfileCard';
import { subscribeToFriendRequests } from '@/lib/social/SocialRealtime';
import { getFriendPresence, type FriendPresence } from '@/lib/social/PresenceService';
import {
  getRoomPeople,
  searchPeople,
  SEARCH_MIN_CHARS,
  type PublicPerson,
} from '@/lib/people/PeopleService';
import '@/styles/phase26-social.css';

const EMPTY: SocialGraph = { friends: [], incoming: [], outgoing: [], suggestions: [] };

function relationLabel(kind: Relation['kind']): string {
  if (kind === 'friend') return 'Friend';
  if (kind === 'incoming') return 'Request received';
  if (kind === 'outgoing') return 'Request sent';
  return 'Watched together';
}

function relationContextLabel(person: Relation): string {
  return person.context === 'current-room' ? 'In your room' : relationLabel(person.kind);
}

function presenceCopy(person: Relation, activity: FriendPresence | undefined): string {
  if (person.context === 'current-room') {
    return 'Signed in and watching with you';
  }
  if (activity === undefined || activity.status === 'offline') {
    return person.kind === 'friend' ? 'Presence private or offline' : relationLabel(person.kind);
  }
  if (activity.status === 'in_party') return 'In a watch party';
  if (activity.status === 'watching') return activity.videoTitle ?? 'Watching now';
  return 'Online';
}

export function FriendsScreen({
  onMessage,
  currentRoomCode = null,
}: {
  onMessage(userId: string): void;
  currentRoomCode?: string | null;
}): JSX.Element {
  const [profileId, setProfileId] = useState<string | null>(null);
  const [graph, setGraph] = useState<SocialGraph>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [presence, setPresence] = useState<Map<string, FriendPresence>>(new Map());
  const [roomSuggestions, setRoomSuggestions] = useState<Relation[]>([]);
  const [directoryResults, setDirectoryResults] = useState<PublicPerson[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const result = await getSocialGraph();
    setLoading(false);
    if (result.status === 'ok') {
      setGraph(result.data);
    } else {
      setMessage(result.status === 'offline' ? 'Friends are unavailable while offline.' : 'Friends could not be loaded.');
    }
  }, []);

  useEffect(() => { void refresh(); return subscribeToFriendRequests(() => void refresh()); }, [refresh]);
  useEffect(() => {
    let active = true;
    const poll = (): void => {
      void getFriendPresence().then((result) => {
        if (active && result.status === 'ok') setPresence(new Map(result.data.map((item) => [item.userId, item])));
      });
    };
    poll();
    const timer = window.setInterval(poll, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (currentRoomCode === null) {
      setRoomSuggestions([]);
      return;
    }
    let active = true;
    const refreshRoom = (): void => {
      void getRoomPeople(currentRoomCode).then(async (people) => {
        if (!active) return;
        if (people.ok) {
          setRoomSuggestions(
            people.value
              .filter((person) => person.relationship === 'none')
              .map((person) => ({
                kind: 'suggestion',
                userId: person.userId,
                displayName: person.displayName,
                requestId: null,
                createdAt: new Date().toISOString(),
                avatarUrl: person.avatarUrl,
                selectedBorderId: person.border,
                context: 'current-room',
              })),
          );
          return;
        }
        // v0.1.27 compatibility while the Phase 34 manifest rolls out.
        const fallback = await listLiveRoomCoWatchers(currentRoomCode);
        if (!active || fallback.status !== 'ok') return;
        setRoomSuggestions(fallback.data.map((person) => ({
          kind: 'suggestion',
          userId: person.userId,
          displayName: person.displayName,
          requestId: null,
          createdAt: new Date().toISOString(),
          avatarUrl: person.avatarUrl,
          selectedBorderId: person.selectedBorderId,
          context: 'current-room',
        })));
      });
    };
    refreshRoom();
    const timer = window.setInterval(refreshRoom, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [currentRoomCode]);

  useEffect(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (normalized.length < SEARCH_MIN_CHARS) {
      setDirectoryResults([]);
      setDirectoryLoading(false);
      setDirectoryError(null);
      return;
    }
    let active = true;
    setDirectoryLoading(true);
    setDirectoryError(null);
    const timer = window.setTimeout(() => {
      void searchPeople(normalized).then((result) => {
        if (!active) return;
        setDirectoryLoading(false);
        if (result.ok) {
          setDirectoryResults(result.value);
        } else {
          setDirectoryResults([]);
          setDirectoryError(result.code === 'offline'
            ? 'People search is unavailable while offline.'
            : result.code === 'not-supported'
              ? 'People search needs the latest NightWatch server deployment.'
              : result.message);
        }
      });
    }, 320);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const combinedSuggestions = useMemo(() => {
    const existing = new Set(
      [...graph.friends, ...graph.incoming, ...graph.outgoing, ...graph.suggestions]
        .map((person) => person.userId),
    );
    return [
      ...graph.suggestions,
      ...roomSuggestions.filter((person) => !existing.has(person.userId)),
    ];
  }, [graph, roomSuggestions]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = useMemo(() => {
    const select = (items: Relation[]): Relation[] => normalizedQuery === ''
      ? items
      : items.filter((person) => person.displayName.toLocaleLowerCase().includes(normalizedQuery));
    return {
      friends: select(graph.friends),
      incoming: select(graph.incoming),
      outgoing: select(graph.outgoing),
      suggestions: select(combinedSuggestions),
    };
  }, [combinedSuggestions, graph.friends, graph.incoming, graph.outgoing, normalizedQuery]);

  async function act(userId: string, action: () => Promise<{ status: string }>, success: string): Promise<void> {
    setBusyId(userId);
    setMessage(null);
    const result = await action();
    setBusyId(null);
    if (result.status === 'ok') {
      setMessage(success);
      setRoomSuggestions((current) => current.filter((person) => person.userId !== userId));
      await refresh();
    } else {
      setMessage(result.status === 'rate-limited' ? 'That action is being attempted too quickly.' : 'The friend action could not be completed.');
    }
  }

  return (
    <section className="social-page phase26-friends fade-up" aria-labelledby="friends-title">
      <header className="social-hero phase26-social-hero">
        <div><span className="eyebrow">Your circle</span><h1 id="friends-title">Friends</h1><p>People you choose to watch, message, and share moments with.</p></div>
        <div className="friend-summary"><strong>{graph.friends.length}</strong><span>accepted friends</span></div>
      </header>

      <label className="friend-search">
        <Icon name="search" size={18} />
        <span className="sr-only">Search friends and requests</span>
        <input type="search" value={query} placeholder="Search friends, requests, and co-watchers" onChange={(event) => setQuery(event.target.value)} />
        {query !== '' && <button type="button" aria-label="Clear friend search" onClick={() => setQuery('')}><Icon name="close" size={15} /></button>}
      </label>

      {message !== null && <p className="social-notice" role="status">{message}</p>}
      {normalizedQuery.length > 0 && normalizedQuery.length < SEARCH_MIN_CHARS && (
        <p className="social-notice" role="status">Type at least {SEARCH_MIN_CHARS} characters to find opted-in NightWatch users.</p>
      )}
      {directoryError !== null && <p className="social-notice" role="alert">{directoryError}</p>}
      {loading ? (
        <div className="social-loading"><div className="orbit-loader" aria-hidden="true"><span /><span /><span /></div><span>Loading your circle…</span></div>
      ) : (
        <div className="social-sections">
          {normalizedQuery.length >= SEARCH_MIN_CHARS && (
            <DirectorySection
              items={directoryResults}
              loading={directoryLoading}
              busyId={busyId}
              onOpen={setProfileId}
              onMessage={onMessage}
              onAct={act}
            />
          )}
          {graph.incoming.length > 0 && <RelationSection title="Friend requests" subtitle="People waiting for your response" items={filtered.incoming} onOpen={setProfileId} empty={normalizedQuery === '' ? undefined : 'No requests match your search.'} renderActions={(person) => <><button className="button button-primary" disabled={busyId === person.userId} onClick={() => void act(person.userId, () => acceptFriendRequest(person.userId), `${person.displayName} is now your friend.`)}>Accept</button><button className="button" disabled={busyId === person.userId} onClick={() => void act(person.userId, () => declineFriendRequest(person.userId), 'Request declined.')}>Decline</button></>} />}
          <RelationSection title="Your friends" subtitle="Accepted NightWatch connections" items={filtered.friends} onOpen={setProfileId} presence={presence} empty={normalizedQuery === '' ? 'Watch together in persistent rooms to discover people you know.' : 'No friends match your search.'} renderActions={(person) => <><button className="button button-primary" onClick={() => onMessage(person.userId)}><Icon name="message" size={15} />Message</button><button className="button" disabled={busyId === person.userId} onClick={() => void act(person.userId, () => removeFriend(person.userId), `${person.displayName} was removed.`)}>Remove</button></>} />
          {combinedSuggestions.length > 0 && <RelationSection title="People you watched with" subtitle="Current signed-in room members and previous co-watchers" items={filtered.suggestions} onOpen={setProfileId} empty={normalizedQuery === '' ? undefined : 'No co-watchers match your search.'} renderActions={(person) => <button className="button button-primary" disabled={busyId === person.userId} onClick={() => void act(person.userId, () => sendFriendRequest(person.userId), `Request sent to ${person.displayName}.`)}><Icon name="plus" size={15} />Add friend</button>} />}
          {graph.outgoing.length > 0 && <RelationSection title="Sent requests" subtitle="Waiting for a response" items={filtered.outgoing} onOpen={setProfileId} empty={normalizedQuery === '' ? undefined : 'No sent requests match your search.'} renderActions={(person) => <button className="button" disabled={busyId === person.userId} onClick={() => void act(person.userId, () => cancelFriendRequest(person.userId), 'Request cancelled.')}>Cancel request</button>} />}
          <section className="social-section blocked-section"><header><div><h2>Blocked</h2><p>Blocking is mutual and removes access to messages, presence, and friends-only moments.</p></div></header><BlockedUsersPanel /></section>
        </div>
      )}
      {profileId !== null && <SocialProfileCard userId={profileId} onClose={() => setProfileId(null)} onMessage={(id) => { setProfileId(null); onMessage(id); }} />}
    </section>
  );
}

function DirectorySection({
  items,
  loading,
  busyId,
  onOpen,
  onMessage,
  onAct,
}: {
  items: readonly PublicPerson[];
  loading: boolean;
  busyId: string | null;
  onOpen(userId: string): void;
  onMessage(userId: string): void;
  onAct(userId: string, action: () => Promise<{ status: string }>, success: string): Promise<void>;
}): JSX.Element {
  function actions(person: PublicPerson): JSX.Element | null {
    if (person.relationship === 'friends') {
      return <button className="button button-primary" onClick={() => onMessage(person.userId)}><Icon name="message" size={15} />Message</button>;
    }
    if (person.relationship === 'pending-incoming') {
      return <button className="button button-primary" disabled={busyId === person.userId} onClick={() => void onAct(person.userId, () => acceptFriendRequest(person.userId), `${person.displayName} is now your friend.`)}>Accept</button>;
    }
    if (person.relationship === 'pending-outgoing') {
      return <button className="button" disabled={busyId === person.userId} onClick={() => void onAct(person.userId, () => cancelFriendRequest(person.userId), 'Request cancelled.')}>Cancel request</button>;
    }
    if (person.relationship === 'self') return null;
    return <button className="button button-primary" disabled={busyId === person.userId} onClick={() => void onAct(person.userId, () => sendFriendRequest(person.userId), `Request sent to ${person.displayName}.`)}><Icon name="plus" size={15} />Add friend</button>;
  }

  return (
    <section className="social-section phase26-relation-section people-directory-section">
      <header><div><h2>Find people</h2><p>Only users with a public handle and discovery enabled appear here.</p></div><span>{items.length}</span></header>
      {loading ? <div className="social-loading"><span className="settings-mini-loader" aria-hidden="true" />Searching NightWatch...</div> : items.length === 0 ? <p className="social-empty">No opted-in users match that name or handle.</p> : (
        <ul className="social-grid phase26-friend-grid">
          {items.map((person) => (
            <li key={person.userId} className="person-card phase26-person-card">
              <button type="button" className="person-avatar-button" onClick={() => onOpen(person.userId)} aria-label={`View ${person.displayName}'s profile`}>
                <ProfileAvatar name={person.displayName} src={person.avatarUrl} className={person.border === null ? 'person-avatar' : `person-avatar border-${person.border}`} />
              </button>
              <span className="person-copy"><span className="relationship-label">{person.relationship === 'none' ? 'NightWatch user' : person.relationship.replace('-', ' ')}</span><strong>{person.displayName}</strong><small>{person.handle === null ? 'Public profile' : `@${person.handle}`}</small></span>
              <span className="person-actions">{actions(person)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface RelationSectionProps {
  title: string;
  subtitle: string;
  items: readonly Relation[];
  presence?: ReadonlyMap<string, FriendPresence>;
  empty?: string;
  onOpen?(userId: string): void;
  renderActions(person: Relation): JSX.Element;
}

function RelationSection({ title, subtitle, items, presence, empty, onOpen, renderActions }: RelationSectionProps): JSX.Element {
  return (
    <section className="social-section phase26-relation-section">
      <header><div><h2>{title}</h2><p>{subtitle}</p></div><span>{items.length}</span></header>
      {items.length === 0 ? <p className="social-empty">{empty}</p> : (
        <ul className="social-grid phase26-friend-grid">
          {items.map((person) => {
            const activity = presence?.get(person.userId);
            return (
              <li key={`${person.kind}-${person.userId}`} className="person-card phase26-person-card">
                <button type="button" className="person-avatar-button" onClick={() => onOpen?.(person.userId)} aria-label={`View ${person.displayName}'s profile`}>
                  <ProfileAvatar name={person.displayName} src={person.avatarUrl} className={person.selectedBorderId !== null ? `person-avatar border-${person.selectedBorderId}` : 'person-avatar'} />
                  {activity !== undefined && activity.status !== 'offline' && <i className={`presence-dot presence-${activity.status}`} aria-hidden="true" />}
                </button>
                <span className="person-copy"><span className="relationship-label">{relationContextLabel(person)}</span><strong>{person.displayName}</strong><small>{presenceCopy(person, activity)}</small></span>
                <span className="person-actions">{renderActions(person)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
