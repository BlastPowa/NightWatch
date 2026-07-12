import { useCallback, useEffect, useState } from 'react';
import { acceptFriendRequest, cancelFriendRequest, declineFriendRequest, getSocialGraph, removeFriend, sendFriendRequest, type Relation, type SocialGraph } from '@/lib/social/FriendService';
import { subscribeToFriendRequests } from '@/lib/social/SocialRealtime';

const EMPTY: SocialGraph = { friends: [], incoming: [], outgoing: [], suggestions: [] };

export function FriendsScreen(): JSX.Element {
  const [graph, setGraph] = useState<SocialGraph>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const result = await getSocialGraph();
    setLoading(false);
    if (result.status === 'ok') setGraph(result.data);
    else setMessage(result.status === 'offline' ? 'Friends are unavailable while offline.' : 'Friends could not be loaded.');
  }, []);

  useEffect(() => { void refresh(); return subscribeToFriendRequests(() => void refresh()); }, [refresh]);

  async function act(userId: string, action: () => Promise<{ status: string }>, success: string): Promise<void> {
    setBusyId(userId); setMessage(null);
    const result = await action();
    setBusyId(null);
    if (result.status === 'ok') { setMessage(success); await refresh(); }
    else setMessage(result.status === 'rate-limited' ? 'That action is being attempted too quickly.' : 'The friend action could not be completed.');
  }

  return <section className="social-page fade-up" aria-labelledby="friends-title">
    <header className="social-hero"><div><span className="eyebrow">Your circle</span><h1 id="friends-title">Friends</h1><p>People you choose to watch, message, and share moments with.</p></div><span className="social-count">{graph.friends.length} friends</span></header>
    {message !== null && <p className="social-notice" role="status">{message}</p>}
    {loading ? <div className="social-loading"><div className="orbit-loader" aria-hidden="true"><span /><span /><span /></div><span>Loading your circle…</span></div> : <div className="social-sections">
      {graph.incoming.length > 0 && <RelationSection title="Friend requests" subtitle="People waiting for your response" items={graph.incoming} renderActions={(person) => <><button className="button button-primary" disabled={busyId === person.userId} onClick={() => void act(person.userId, () => acceptFriendRequest(person.userId), `${person.displayName} is now your friend.`)}>Accept</button><button className="button" disabled={busyId === person.userId} onClick={() => void act(person.userId, () => declineFriendRequest(person.userId), 'Request declined.')}>Decline</button></>} />}
      <RelationSection title="Your friends" subtitle="Accepted NightWatch connections" items={graph.friends} empty="Watch together in persistent rooms to discover people you know." renderActions={(person) => <button className="button" disabled={busyId === person.userId} onClick={() => void act(person.userId, () => removeFriend(person.userId), `${person.displayName} was removed.`)}>Remove</button>} />
      {graph.suggestions.length > 0 && <RelationSection title="People you watched with" subtitle="Suggestions are not friends until they accept" items={graph.suggestions} renderActions={(person) => <button className="button button-primary" disabled={busyId === person.userId} onClick={() => void act(person.userId, () => sendFriendRequest(person.userId), `Request sent to ${person.displayName}.`)}>Add friend</button>} />}
      {graph.outgoing.length > 0 && <RelationSection title="Sent requests" subtitle="Waiting for a response" items={graph.outgoing} renderActions={(person) => <button className="button" disabled={busyId === person.userId} onClick={() => void act(person.userId, () => cancelFriendRequest(person.userId), 'Request cancelled.')}>Cancel request</button>} />}
    </div>}
  </section>;
}

function RelationSection({ title, subtitle, items, empty, renderActions }: { title: string; subtitle: string; items: readonly Relation[]; empty?: string; renderActions(person: Relation): JSX.Element }): JSX.Element {
  return <section className="social-section"><header><div><h2>{title}</h2><p>{subtitle}</p></div><span>{items.length}</span></header>{items.length === 0 ? <p className="social-empty">{empty}</p> : <ul className="social-grid">{items.map((person) => <li key={`${person.kind}-${person.userId}`} className="person-card"><span className="person-avatar" aria-hidden="true">{person.displayName.slice(0,1).toUpperCase()}</span><span className="person-copy"><strong>{person.displayName}</strong><small>{person.kind === 'suggestion' ? 'Co-watcher suggestion' : person.kind === 'friend' ? 'Friend' : 'NightWatch member'}</small></span><span className="person-actions">{renderActions(person)}</span></li>)}</ul>}</section>;
}
