import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { extractVideoId } from '@shared/youtube';
import {
  castVote,
  createBounty,
  createClub,
  getBountyResults,
  leaveClub,
  listBounties,
  listMyClubs,
  retractVote,
  setBountyStatus,
  submitToBounty,
  type Bounty,
  type BountyResult,
  type Club,
} from '@/lib/social/CreatorService';
import { Icon } from '@/components/Icon';

type BountyTab = 'active' | 'submissions' | 'completed';

function creatorFailure(status: string): string {
  if (status === 'rate-limited') return 'That action is moving too quickly. Try again shortly.';
  if (status === 'forbidden') return 'Your club role does not allow that action.';
  if (status === 'blocked') return 'That member relationship prevents this action.';
  if (status === 'offline') return 'Creator Club is offline. Check your connection.';
  return 'Creator Club could not complete that action.';
}

function nextStatus(bounty: Bounty): 'open' | 'judging' | 'closed' | null {
  if (bounty.status === 'draft') return 'open';
  if (bounty.status === 'open') return 'judging';
  if (bounty.status === 'judging') return 'closed';
  return null;
}

export function CreatorClubScreen(): JSX.Element {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [selectedClubId, setSelectedClubId] = useState<string | null>(null);
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [selectedBountyId, setSelectedBountyId] = useState<string | null>(null);
  const [results, setResults] = useState<BountyResult[]>([]);
  const [tab, setTab] = useState<BountyTab>('active');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showClubComposer, setShowClubComposer] = useState(false);
  const [showBountyComposer, setShowBountyComposer] = useState(false);

  const selectedClub = clubs.find((club) => club.id === selectedClubId) ?? null;
  const selectedBounty = bounties.find((bounty) => bounty.id === selectedBountyId) ?? null;
  const visibleBounties = useMemo(() => bounties.filter((bounty) => {
    if (tab === 'completed') return bounty.status === 'closed' || bounty.status === 'cancelled';
    if (tab === 'submissions') return bounty.submissionCount > 0;
    return bounty.status !== 'closed' && bounty.status !== 'cancelled';
  }), [bounties, tab]);

  async function refreshClubs(preferred?: string): Promise<void> {
    setLoading(true);
    const result = await listMyClubs();
    if (result.status === 'ok') {
      setClubs(result.data);
      setSelectedClubId((current) => preferred ?? current ?? result.data[0]?.id ?? null);
      setError(null);
    } else {
      setError(creatorFailure(result.status));
    }
    setLoading(false);
  }

  async function refreshBounties(clubId: string): Promise<void> {
    const result = await listBounties(clubId);
    if (result.status === 'ok') {
      setBounties(result.data);
      setSelectedBountyId((current) => result.data.some((item) => item.id === current) ? current : result.data[0]?.id ?? null);
      setError(null);
    } else {
      setError(creatorFailure(result.status));
    }
  }

  useEffect(() => { void refreshClubs(); }, []);
  useEffect(() => {
    if (selectedClubId === null) { setBounties([]); return; }
    void refreshBounties(selectedClubId);
  }, [selectedClubId]);
  useEffect(() => {
    if (selectedBountyId === null) { setResults([]); return; }
    void getBountyResults(selectedBountyId).then((result) => {
      if (result.status === 'ok') setResults(result.data);
    });
  }, [selectedBountyId]);

  async function transition(bounty: Bounty): Promise<void> {
    const target = nextStatus(bounty);
    if (target === null || selectedClubId === null) return;
    const result = await setBountyStatus(bounty.id, target);
    if (result.status === 'ok') await refreshBounties(selectedClubId);
    else setError(creatorFailure(result.status));
  }

  return (
    <div className="creator-page fade-up">
      <header className="creator-hero">
        <div><span className="eyebrow">Community studio</span><h1>Creator Club</h1><p>Turn watch-party ideas into community challenges, vote on submissions, and celebrate the videos people make together.</p></div>
        <button type="button" className="button button-primary" onClick={() => setShowClubComposer((value) => !value)}>+ New club</button>
      </header>

      {showClubComposer && <ClubComposer onCancel={() => setShowClubComposer(false)} onCreated={(id) => { setShowClubComposer(false); void refreshClubs(id); }} onError={setError} />}
      {error !== null && <p className="form-error" role="status">{error}</p>}

      <div className="creator-workspace">
        <aside className="creator-club-rail card">
          <div className="creator-section-heading"><div><span className="eyebrow">Your spaces</span><h2>Joined clubs</h2></div><span>{clubs.length}</span></div>
          {loading ? <div className="creator-loading"><span className="loader-orbit" />Loading clubs…</div> : clubs.map((club) => (
            <button key={club.id} type="button" className={`creator-club-card${club.id === selectedClubId ? ' creator-club-card-active' : ''}`} onClick={() => setSelectedClubId(club.id)}>
              <span className="creator-club-avatar">{club.name.slice(0, 2).toUpperCase()}</span>
              <span><strong>{club.name}</strong><small>{club.memberCount} members · {club.role}</small></span>
            </button>
          ))}
          {!loading && clubs.length === 0 && <div className="creator-empty"><Icon name="creator" size={28} /><strong>Create the first club</strong><small>Clubs you own or join will live here.</small></div>}
        </aside>

        <main className="creator-board card">
          {selectedClub === null ? <div className="creator-empty creator-empty-large"><Icon name="sparkle" size={30} /><strong>Your creator board is ready</strong><small>Create a club to start collecting and judging community video ideas.</small></div> : <>
            <header className="creator-board-header"><div><span className="eyebrow">{selectedClub.role} · {selectedClub.memberCount} members</span><h2>{selectedClub.name}</h2><p>{selectedClub.description || 'A cinematic space for community ideas.'}</p></div><div className="creator-board-actions">{selectedClub.role !== 'member' && <button type="button" className="button button-primary" onClick={() => setShowBountyComposer((value) => !value)}>Create bounty</button>}{selectedClub.role !== 'owner' && <button type="button" className="button" onClick={() => void leaveClub(selectedClub.id).then((result) => result.status === 'ok' ? refreshClubs() : setError(creatorFailure(result.status)))}>Leave</button>}</div></header>
            {showBountyComposer && <BountyComposer clubId={selectedClub.id} onCancel={() => setShowBountyComposer(false)} onCreated={() => { setShowBountyComposer(false); void refreshBounties(selectedClub.id); }} onError={setError} />}
            <div className="creator-tabs">{(['active','submissions','completed'] as const).map((value) => <button key={value} type="button" className={tab === value ? 'creator-tab creator-tab-active' : 'creator-tab'} onClick={() => setTab(value)}>{value === 'active' ? 'Active bounties' : value === 'submissions' ? 'With submissions' : 'Completed'}</button>)}</div>
            <div className="bounty-list">{visibleBounties.map((bounty, index) => <article key={bounty.id} className={`bounty-card${bounty.id === selectedBountyId ? ' bounty-card-active' : ''}`} onClick={() => setSelectedBountyId(bounty.id)}><span className="bounty-rank">{String(index + 1).padStart(2,'0')}</span><div className="bounty-copy"><span><span className={`bounty-status bounty-status-${bounty.status}`}>{bounty.status}</span>{bounty.closesAt !== null && <small>Ends {new Date(bounty.closesAt).toLocaleDateString()}</small>}</span><h3>{bounty.title}</h3><p>{bounty.brief || 'No additional brief.'}</p><small>{bounty.submissionCount} submission{bounty.submissionCount === 1 ? '' : 's'}</small></div><div className="bounty-actions">{selectedClub.role !== 'member' && nextStatus(bounty) !== null && <button type="button" className="button" onClick={(event) => { event.stopPropagation(); void transition(bounty); }}>Move to {nextStatus(bounty)}</button>}<button type="button" className="button button-primary" onClick={(event) => { event.stopPropagation(); setSelectedBountyId(bounty.id); }}>Open</button></div></article>)}</div>
            {visibleBounties.length === 0 && <div className="creator-empty"><Icon name="creator" size={26} /><strong>Nothing in this view</strong><small>New challenges and submissions will appear here.</small></div>}
          </>}
        </main>

        <aside className="creator-detail card">
          {selectedBounty === null ? <div className="creator-empty creator-empty-large"><Icon name="chevron-right" size={28} /><strong>Select a bounty</strong><small>Open a challenge to see its submissions and voting state.</small></div> : <BountyDetail bounty={selectedBounty} results={results} onRefresh={() => { void getBountyResults(selectedBounty.id).then((result) => { if (result.status === 'ok') setResults(result.data); }); if (selectedClubId !== null) void refreshBounties(selectedClubId); }} onError={setError} />}
        </aside>
      </div>
    </div>
  );
}

function ClubComposer({ onCancel, onCreated, onError }: { onCancel(): void; onCreated(id: string): void; onError(message: string): void }): JSX.Element {
  const [name, setName] = useState(''); const [description, setDescription] = useState(''); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent): Promise<void> { event.preventDefault(); setSaving(true); const result = await createClub(name.trim(), description.trim()); setSaving(false); if (result.status === 'ok') onCreated(result.data); else onError(creatorFailure(result.status)); }
  return <form className="card creator-composer" onSubmit={(event) => void submit(event)}><div><span className="eyebrow">New community</span><h2>Create a club</h2></div><input className="input" value={name} minLength={2} maxLength={60} required placeholder="Club name" onChange={(event) => setName(event.target.value)} /><input className="input" value={description} maxLength={500} placeholder="What will your community create?" onChange={(event) => setDescription(event.target.value)} /><button className="button button-primary" disabled={saving}>{saving ? 'Creating…' : 'Create club'}</button><button type="button" className="button" onClick={onCancel}>Cancel</button></form>;
}

function BountyComposer({ clubId, onCancel, onCreated, onError }: { clubId: string; onCancel(): void; onCreated(): void; onError(message: string): void }): JSX.Element {
  const [title, setTitle] = useState(''); const [brief, setBrief] = useState(''); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent): Promise<void> { event.preventDefault(); setSaving(true); const result = await createBounty(clubId, title.trim(), brief.trim()); setSaving(false); if (result.status === 'ok') onCreated(); else onError(creatorFailure(result.status)); }
  return <form className="creator-composer creator-composer-inline" onSubmit={(event) => void submit(event)}><input className="input" value={title} required minLength={3} maxLength={100} placeholder="Challenge title" onChange={(event) => setTitle(event.target.value)} /><input className="input" value={brief} maxLength={1000} placeholder="Give creators a clear brief" onChange={(event) => setBrief(event.target.value)} /><button className="button button-primary" disabled={saving}>{saving ? 'Saving…' : 'Save draft'}</button><button type="button" className="button" onClick={onCancel}>Cancel</button></form>;
}

function BountyDetail({ bounty, results, onRefresh, onError }: { bounty: Bounty; results: BountyResult[]; onRefresh(): void; onError(message: string): void }): JSX.Element {
  const [url, setUrl] = useState(''); const [note, setNote] = useState(''); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent): Promise<void> { event.preventDefault(); const id = extractVideoId(url); if (id === null) { onError('Paste a valid YouTube link or video ID.'); return; } setSaving(true); const result = await submitToBounty(bounty.id, id, note.trim()); setSaving(false); if (result.status === 'ok') { setUrl(''); setNote(''); onRefresh(); } else onError(creatorFailure(result.status)); }
  async function vote(result: BountyResult): Promise<void> { const response = result.votedByMe ? await retractVote(bounty.id) : await castVote(result.submissionId); if (response.status === 'ok') onRefresh(); else onError(creatorFailure(response.status)); }
  return <><header className="creator-detail-header"><span className={`bounty-status bounty-status-${bounty.status}`}>{bounty.status}</span><h2>{bounty.title}</h2><p>{bounty.brief || 'No additional brief.'}</p></header>{bounty.status === 'open' && <form className="bounty-submit" onSubmit={(event) => void submit(event)}><span className="eyebrow">Your entry</span><input className="input" value={url} required placeholder="YouTube link" onChange={(event) => setUrl(event.target.value)} /><textarea className="input" value={note} maxLength={500} placeholder="Tell the club about your submission" onChange={(event) => setNote(event.target.value)} /><button className="button button-primary" disabled={saving}>{saving ? 'Submitting…' : 'Submit video'}</button></form>}<div className="submission-list">{results.map((result) => <article key={result.submissionId} className="submission-card"><div className="submission-thumbnail"><img src={`https://i.ytimg.com/vi/${result.videoId}/mqdefault.jpg`} alt="" onError={(event) => { event.currentTarget.hidden = true; event.currentTarget.parentElement?.classList.add('thumbnail-unavailable'); }} /><span><Icon name="play" /></span></div><div><strong>{result.displayName}</strong><p>{result.note || 'Video submission'}</p><small>{result.votes} vote{result.votes === 1 ? '' : 's'} · {result.status}</small></div>{bounty.status === 'judging' && !result.isMine && <button type="button" className={result.votedByMe ? 'button button-primary' : 'button'} onClick={() => void vote(result)}>{result.votedByMe ? 'Voted' : 'Vote'}</button>}</article>)}{results.length === 0 && <div className="creator-empty"><Icon name="play" size={26} /><strong>No submissions yet</strong><small>Entries will appear here once the bounty opens.</small></div>}</div></>;
}
