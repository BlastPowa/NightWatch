import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { extractVideoId } from '@shared/youtube';
import {
  castVote,
  createBounty,
  createClub,
  getBountyResults,
  getClubAudit,
  joinClub,
  leaveClub,
  listBounties,
  listClubReports,
  listMyClubs,
  retractVote,
  reportContent,
  resolveReport,
  searchClubs,
  setClubVisibility,
  setBountyStatus,
  submitToBounty,
  type Bounty,
  type BountyResult,
  type Club,
  type ClubReport,
  type AuditEntry,
  type DirectoryClub,
} from '@/lib/social/CreatorService';
import { Icon } from '@/components/Icon';

type BountyTab = 'active' | 'submissions' | 'completed' | 'moderation';

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

interface CreatorClubScreenProps {
  discoveryEnabled: boolean;
}

export function CreatorClubScreen({ discoveryEnabled }: CreatorClubScreenProps): JSX.Element {
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
  const [reports, setReports] = useState<ClubReport[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [moderationLoading, setModerationLoading] = useState(false);
  const [view, setView] = useState<'board' | 'discover'>('board');
  const [directory, setDirectory] = useState<DirectoryClub[]>([]);
  const [publicClubIds, setPublicClubIds] = useState<Set<string>>(new Set());
  const [directoryQuery, setDirectoryQuery] = useState('');
  const [directoryLoading, setDirectoryLoading] = useState(false);

  const selectedClub = clubs.find((club) => club.id === selectedClubId) ?? null;
  const selectedBounty = bounties.find((bounty) => bounty.id === selectedBountyId) ?? null;
  const visibleBounties = useMemo(() => bounties.filter((bounty) => {
    if (tab === 'completed') return bounty.status === 'closed' || bounty.status === 'cancelled';
    if (tab === 'moderation') return false;
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

  async function loadDirectory(query = ''): Promise<void> {
    if (!discoveryEnabled) return;
    setDirectoryLoading(true);
    const result = await searchClubs(query);
    setDirectoryLoading(false);
    if (result.status === 'ok') {
      setDirectory(result.data);
      if (query === '') setPublicClubIds(new Set(result.data.map((club) => club.id)));
      setError(null);
    } else {
      setError(creatorFailure(result.status));
    }
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
  useEffect(() => { if (discoveryEnabled) void loadDirectory(); }, [discoveryEnabled]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!discoveryEnabled || selectedClub === null || selectedClub.role !== 'owner') return;
    void searchClubs(selectedClub.name).then((result) => {
      if (result.status !== 'ok') return;
      const isPublic = result.data.some((club) => club.id === selectedClub.id);
      setPublicClubIds((current) => {
        const next = new Set(current);
        if (isPublic) next.add(selectedClub.id); else next.delete(selectedClub.id);
        return next;
      });
    });
  }, [discoveryEnabled, selectedClubId]); // eslint-disable-line react-hooks/exhaustive-deps
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

  useEffect(() => {
    if (tab !== 'moderation' || selectedClub === null || selectedClub.role === 'member') return;
    setModerationLoading(true);
    void Promise.all([listClubReports(selectedClub.id), getClubAudit(selectedClub.id)]).then(([reportResult, auditResult]) => {
      if (reportResult.status === 'ok') setReports(reportResult.data);
      else setError(creatorFailure(reportResult.status));
      if (auditResult.status === 'ok') setAudit(auditResult.data);
      else setError(creatorFailure(auditResult.status));
      setModerationLoading(false);
    });
  }, [tab, selectedClubId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function resolve(reportId: string, status: 'actioned' | 'dismissed'): Promise<void> {
    if (selectedClub === null) return;
    const result = await resolveReport(reportId, selectedClub.id, status);
    if (result.status !== 'ok') { setError(creatorFailure(result.status)); return; }
    const refreshed = await listClubReports(selectedClub.id);
    if (refreshed.status === 'ok') setReports(refreshed.data);
  }

  async function joinDirectoryClub(club: DirectoryClub): Promise<void> {
    if (club.isMember) {
      setSelectedClubId(club.id);
      setView('board');
      return;
    }
    const result = await joinClub(club.id);
    if (result.status !== 'ok') { setError(creatorFailure(result.status)); return; }
    await refreshClubs(club.id);
    await loadDirectory(directoryQuery.trim());
    setView('board');
  }

  async function toggleVisibility(): Promise<void> {
    if (selectedClub === null || selectedClub.role !== 'owner') return;
    const isPublic = publicClubIds.has(selectedClub.id);
    const result = await setClubVisibility(selectedClub.id, isPublic ? 'private' : 'public');
    if (result.status !== 'ok') { setError(creatorFailure(result.status)); return; }
    await loadDirectory();
  }

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
        <div className="creator-hero-actions">{discoveryEnabled && <button type="button" className={view === 'discover' ? 'button button-primary' : 'button'} onClick={() => setView(view === 'discover' ? 'board' : 'discover')}><Icon name={view === 'discover' ? 'creator' : 'search'} size={16} />{view === 'discover' ? 'My clubs' : 'Discover clubs'}</button>}<button type="button" className="button button-primary" onClick={() => setShowClubComposer((value) => !value)}><Icon name="plus" size={16} />New club</button></div>
      </header>

      {showClubComposer && <ClubComposer onCancel={() => setShowClubComposer(false)} onCreated={(id) => { setShowClubComposer(false); void refreshClubs(id); }} onError={setError} />}
      {error !== null && <p className="form-error" role="status">{error}</p>}

      {view === 'discover' && discoveryEnabled ? <ClubDirectory query={directoryQuery} onQuery={setDirectoryQuery} clubs={directory} loading={directoryLoading} onSearch={() => void loadDirectory(directoryQuery.trim())} onOpen={(club) => void joinDirectoryClub(club)} /> : <div className="creator-workspace">
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
            <header className="creator-board-header"><div><span className="eyebrow">{selectedClub.role} · {selectedClub.memberCount} members</span><h2>{selectedClub.name}</h2><p>{selectedClub.description || 'A cinematic space for community ideas.'}</p></div><div className="creator-board-actions">{discoveryEnabled && selectedClub.role === 'owner' && <button type="button" className="button" onClick={() => void toggleVisibility()}><Icon name={publicClubIds.has(selectedClub.id) ? 'lock' : 'search'} size={15} />{publicClubIds.has(selectedClub.id) ? 'Make private' : 'List publicly'}</button>}{selectedClub.role !== 'member' && <button type="button" className="button button-primary" onClick={() => setShowBountyComposer((value) => !value)}>Create bounty</button>}{selectedClub.role !== 'owner' && <button type="button" className="button" onClick={() => void leaveClub(selectedClub.id).then((result) => result.status === 'ok' ? refreshClubs() : setError(creatorFailure(result.status)))}>Leave</button>}</div></header>
            {showBountyComposer && <BountyComposer clubId={selectedClub.id} onCancel={() => setShowBountyComposer(false)} onCreated={() => { setShowBountyComposer(false); void refreshBounties(selectedClub.id); }} onError={setError} />}
            <div className="creator-tabs">{(['active','submissions','completed', ...(selectedClub.role !== 'member' ? ['moderation' as const] : [])] as const).map((value) => <button key={value} type="button" className={tab === value ? 'creator-tab creator-tab-active' : 'creator-tab'} onClick={() => setTab(value)}>{value === 'active' ? 'Active bounties' : value === 'submissions' ? 'With submissions' : value === 'moderation' ? 'Moderation' : 'Completed'}</button>)}</div>
            {tab === 'moderation' ? <ModerationBoard reports={reports} audit={audit} loading={moderationLoading} onResolve={resolve} /> : <><div className="bounty-list">{visibleBounties.map((bounty, index) => <article key={bounty.id} className={`bounty-card${bounty.id === selectedBountyId ? ' bounty-card-active' : ''}`} onClick={() => setSelectedBountyId(bounty.id)}><span className="bounty-rank">{String(index + 1).padStart(2,'0')}</span><div className="bounty-copy"><span><span className={`bounty-status bounty-status-${bounty.status}`}>{bounty.status}</span>{bounty.closesAt !== null && <small>Ends {new Date(bounty.closesAt).toLocaleDateString()}</small>}</span><h3>{bounty.title}</h3><p>{bounty.brief || 'No additional brief.'}</p><small>{bounty.submissionCount} submission{bounty.submissionCount === 1 ? '' : 's'}</small></div><div className="bounty-actions">{selectedClub.role !== 'member' && nextStatus(bounty) !== null && <button type="button" className="button" onClick={(event) => { event.stopPropagation(); void transition(bounty); }}>Move to {nextStatus(bounty)}</button>}<button type="button" className="button button-primary" onClick={(event) => { event.stopPropagation(); setSelectedBountyId(bounty.id); }}>Open</button></div></article>)}</div>{visibleBounties.length === 0 && <div className="creator-empty"><Icon name="creator" size={26} /><strong>Nothing in this view</strong><small>New challenges and submissions will appear here.</small></div>}</>}
          </>}
        </main>

        <aside className="creator-detail card">
          {selectedBounty === null ? <div className="creator-empty creator-empty-large"><Icon name="chevron-right" size={28} /><strong>Select a bounty</strong><small>Open a challenge to see its submissions and voting state.</small></div> : <BountyDetail bounty={selectedBounty} results={results} onRefresh={() => { void getBountyResults(selectedBounty.id).then((result) => { if (result.status === 'ok') setResults(result.data); }); if (selectedClubId !== null) void refreshBounties(selectedClubId); }} onError={setError} />}
        </aside>
      </div>}
    </div>
  );
}

function ClubDirectory({ query, onQuery, clubs, loading, onSearch, onOpen }: { query: string; onQuery(value: string): void; clubs: readonly DirectoryClub[]; loading: boolean; onSearch(): void; onOpen(club: DirectoryClub): void }): JSX.Element {
  function submit(event: FormEvent): void { event.preventDefault(); onSearch(); }
  return <section className="club-directory card" aria-labelledby="club-directory-title"><header className="club-directory-header"><div><span className="eyebrow">Public communities</span><h2 id="club-directory-title">Find your next watch circle</h2><p>Only owner-listed, moderation-ready clubs appear here.</p></div><form className="club-directory-search" onSubmit={submit}><Icon name="search" size={18} /><input value={query} placeholder="Search club names and descriptions" onChange={(event) => onQuery(event.target.value)} aria-label="Search public clubs" />{query !== '' && <button type="button" onClick={() => { onQuery(''); }} aria-label="Clear club search"><Icon name="close" size={14} /></button>}<button type="submit" className="button button-primary">Search</button></form></header>{loading ? <div className="creator-loading creator-loading-large"><span className="loader-orbit" />Searching public clubs…</div> : <div className="club-directory-grid">{clubs.map((club) => <article key={club.id} className="directory-club-card"><div className="directory-club-art"><span>{club.name.slice(0,2).toUpperCase()}</span><Icon name="creator" size={32} /></div><div className="directory-club-copy"><span className="eyebrow">{club.memberCount} members</span><h3>{club.name}</h3><p>{club.description || 'A NightWatch creator community.'}</p><button type="button" className={club.isMember ? 'button' : 'button button-primary'} onClick={() => onOpen(club)}>{club.isMember ? 'Open club' : 'Join club'}<Icon name="chevron-right" size={15} /></button></div></article>)}</div>}{!loading && clubs.length === 0 && <div className="creator-empty creator-empty-large"><Icon name="search" size={30} /><strong>No public clubs found</strong><small>Try a broader search, or create a club and list it publicly.</small></div>}</section>;
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
  const [reporting, setReporting] = useState(false); const [reportReason, setReportReason] = useState('');
  async function submit(event: FormEvent): Promise<void> { event.preventDefault(); const id = extractVideoId(url); if (id === null) { onError('Paste a valid YouTube link or video ID.'); return; } setSaving(true); const result = await submitToBounty(bounty.id, id, note.trim()); setSaving(false); if (result.status === 'ok') { setUrl(''); setNote(''); onRefresh(); } else onError(creatorFailure(result.status)); }
  async function vote(result: BountyResult): Promise<void> { const response = result.votedByMe ? await retractVote(bounty.id) : await castVote(result.submissionId); if (response.status === 'ok') onRefresh(); else onError(creatorFailure(response.status)); }
  async function sendReport(event: FormEvent): Promise<void> { event.preventDefault(); const reason = reportReason.trim(); if (reason.length < 3) return; const response = await reportContent('bounty', bounty.id, reason); if (response.status === 'ok') { setReportReason(''); setReporting(false); } else onError(creatorFailure(response.status)); }
  return <><header className="creator-detail-header"><span className={`bounty-status bounty-status-${bounty.status}`}>{bounty.status}</span><h2>{bounty.title}</h2><p>{bounty.brief || 'No additional brief.'}</p><button type="button" className="creator-report-toggle" onClick={() => setReporting((value) => !value)}><Icon name="info" size={14} />Report</button></header>{reporting && <form className="creator-report-form" onSubmit={(event) => void sendReport(event)}><label htmlFor="bounty-report-reason">Why should club staff review this bounty?</label><textarea id="bounty-report-reason" className="input" value={reportReason} minLength={3} maxLength={500} required placeholder="Describe the issue without including private information" onChange={(event) => setReportReason(event.target.value)} /><div><button type="submit" className="button button-primary">Send report</button><button type="button" className="button" onClick={() => setReporting(false)}>Cancel</button></div></form>}{bounty.status === 'open' && <form className="bounty-submit" onSubmit={(event) => void submit(event)}><span className="eyebrow">Your entry</span><input className="input" value={url} required placeholder="YouTube link" onChange={(event) => setUrl(event.target.value)} /><textarea className="input" value={note} maxLength={500} placeholder="Tell the club about your submission" onChange={(event) => setNote(event.target.value)} /><button className="button button-primary" disabled={saving}>{saving ? 'Submitting…' : 'Submit video'}</button></form>}<div className="submission-list">{results.map((result) => <article key={result.submissionId} className="submission-card"><div className="submission-thumbnail"><img src={`https://i.ytimg.com/vi/${result.videoId}/mqdefault.jpg`} alt="" onError={(event) => { event.currentTarget.hidden = true; event.currentTarget.parentElement?.classList.add('thumbnail-unavailable'); }} /><span><Icon name="play" /></span></div><div><strong>{result.displayName}</strong><p>{result.note || 'Video submission'}</p><small>{result.votes} vote{result.votes === 1 ? '' : 's'} · {result.status}</small></div>{bounty.status === 'judging' && !result.isMine && <button type="button" className={result.votedByMe ? 'button button-primary' : 'button'} onClick={() => void vote(result)}>{result.votedByMe ? 'Voted' : 'Vote'}</button>}</article>)}{results.length === 0 && <div className="creator-empty"><Icon name="play" size={26} /><strong>No submissions yet</strong><small>Entries will appear here once the bounty opens.</small></div>}</div></>;
}

function ModerationBoard({ reports, audit, loading, onResolve }: { reports: readonly ClubReport[]; audit: readonly AuditEntry[]; loading: boolean; onResolve(id: string, status: 'actioned' | 'dismissed'): Promise<void> }): JSX.Element {
  if (loading) return <div className="creator-loading creator-loading-large"><span className="loader-orbit" />Loading moderation history…</div>;
  return <div className="moderation-board"><section><header className="moderation-heading"><div><span className="eyebrow">Human review</span><h3>Open reports</h3></div><span>{reports.length}</span></header><div className="moderation-list">{reports.map((report) => <article key={report.id} className="moderation-report"><span className="moderation-kind">{report.targetKind}</span><div><strong>{report.reason}</strong><small>Filed {new Date(report.createdAt).toLocaleString()}</small></div><div><button type="button" className="button button-primary" onClick={() => void onResolve(report.id, 'actioned')}>Action</button><button type="button" className="button" onClick={() => void onResolve(report.id, 'dismissed')}>Dismiss</button></div></article>)}{reports.length === 0 && <div className="creator-empty"><Icon name="check" size={26} /><strong>No reports waiting</strong><small>The club moderation queue is clear.</small></div>}</div></section><section><header className="moderation-heading"><div><span className="eyebrow">Append-only history</span><h3>Audit log</h3></div><span>{audit.length}</span></header><ol className="audit-list">{audit.map((entry, index) => <li key={`${entry.targetId}-${entry.createdAt}-${index}`}><span className="audit-node"><Icon name="clock" size={13} /></span><div><strong>{entry.displayName} · {entry.action}</strong><p>{entry.detail || `${entry.targetKind} ${entry.targetId.slice(0, 8)}`}</p><time>{new Date(entry.createdAt).toLocaleString()}</time></div></li>)}{audit.length === 0 && <li className="audit-empty">No staff actions recorded yet.</li>}</ol></section></div>;
}
