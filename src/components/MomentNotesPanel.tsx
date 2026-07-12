import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { REACTION_EMOJIS } from '@shared/reactions';
import {
  createMomentNote,
  deleteMomentNote,
  editMomentNote,
  listMomentNotes,
  MAX_MOMENT_BODY,
  type MomentNote,
  type MomentVisibility,
} from '@/lib/social/MomentsService';
import { Icon } from '@/components/Icon';

interface MomentNotesPanelProps {
  videoId: string;
  roomCode: string;
  durationSeconds: number;
  currentSeconds: number;
  currentUserId: string;
  isHost: boolean;
  allowRoomVisibility: boolean;
  onSeek(seconds: number): void;
}

type NoteFilter = 'all' | MomentVisibility | 'mine';

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`
    : `${minutes}:${remainder.toString().padStart(2, '0')}`;
}

function failureMessage(status: string): string {
  if (status === 'rate-limited') return 'You are adding notes too quickly. Try again shortly.';
  if (status === 'blocked' || status === 'forbidden') return 'That note is not available with the selected privacy.';
  if (status === 'offline') return 'Moment notes are offline. Check your connection and retry.';
  if (status === 'not-ready') return 'Moment notes are not deployed for this environment yet.';
  return 'Moment notes could not be updated.';
}

export function MomentNotesPanel({
  videoId,
  roomCode,
  durationSeconds,
  currentSeconds,
  currentUserId,
  isHost,
  allowRoomVisibility,
  onSeek,
}: MomentNotesPanelProps): JSX.Element {
  const [notes, setNotes] = useState<MomentNote[]>([]);
  const [body, setBody] = useState('');
  const [emoji, setEmoji] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<MomentVisibility>('private');
  const [filter, setFilter] = useState<NoteFilter>('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  async function refresh(): Promise<void> {
    setLoading(true);
    const result = await listMomentNotes(videoId, allowRoomVisibility ? roomCode : null);
    if (result.status === 'ok') {
      setNotes([...result.data].sort((a, b) => a.positionSeconds - b.positionSeconds));
      setHasMore(result.data.length === 50);
      setError(null);
    } else {
      setError(failureMessage(result.status));
    }
    setLoading(false);
  }

  useEffect(() => {
    setBody('');
    setEmoji(null);
    setEditingId(null);
    void refresh();
    // refresh is intentionally scoped to the active video and room visibility.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, roomCode, allowRoomVisibility]);

  const visibleNotes = useMemo(() => {
    if (filter === 'all') return notes;
    if (filter === 'mine') return notes.filter((note) => note.authorId === currentUserId);
    return notes.filter((note) => note.visibility === filter);
  }, [filter, notes, currentUserId]);

  const markerGroups = useMemo(() => {
    if (durationSeconds <= 0) return [];
    const groups = new Map<number, MomentNote[]>();
    for (const note of visibleNotes) {
      const bucket = Math.round((note.positionSeconds / durationSeconds) * 50);
      groups.set(bucket, [...(groups.get(bucket) ?? []), note]);
    }
    return [...groups.entries()].map(([bucket, grouped]) => ({ bucket, notes: grouped }));
  }, [durationSeconds, visibleNotes]);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (body.trim().length === 0 && emoji === null) return;
    setSaving(true);
    const result = editingId === null
      ? await createMomentNote({
          videoId,
          positionSeconds: currentSeconds,
          durationSeconds,
          visibility,
          body: body.trim(),
          emoji,
          roomCode: visibility === 'room' ? roomCode : null,
        })
      : await editMomentNote(editingId, body.trim(), emoji);
    setSaving(false);
    if (result.status !== 'ok') {
      setError(failureMessage(result.status));
      return;
    }
    setBody('');
    setEmoji(null);
    setEditingId(null);
    await refresh();
  }

  function beginEdit(note: MomentNote): void {
    setEditingId(note.id);
    setBody(note.body);
    setEmoji(note.emoji);
    setVisibility(note.visibility);
    setError(null);
  }

  async function remove(noteId: string): Promise<void> {
    const result = await deleteMomentNote(noteId);
    if (result.status !== 'ok') {
      setError(failureMessage(result.status));
      return;
    }
    setNotes((current) => current.filter((note) => note.id !== noteId));
  }

  async function loadOlder(): Promise<void> {
    const oldest = notes.reduce<string | null>((current, note) => current === null || note.createdAt < current ? note.createdAt : current, null);
    if (oldest === null) return;
    const result = await listMomentNotes(videoId, allowRoomVisibility ? roomCode : null, oldest);
    if (result.status !== 'ok') { setError(failureMessage(result.status)); return; }
    setNotes((current) => {
      const known = new Set(current.map((note) => note.id));
      return [...current, ...result.data.filter((note) => !known.has(note.id))].sort((a, b) => a.positionSeconds - b.positionSeconds);
    });
    setHasMore(result.data.length === 50);
  }

  return (
    <section className="moment-notes" aria-labelledby="moment-notes-title">
      <header className="moment-notes-header">
        <div>
          <span className="eyebrow">Shared timeline</span>
          <h3 id="moment-notes-title">Moment notes <span className="moment-note-count">{visibleNotes.length}</span></h3>
          <p>Leave a private thought, a note for friends, or a marker for this party.</p>
        </div>
        <span className="moment-current-time" aria-label={`Current position ${formatTime(currentSeconds)}`}>
          {formatTime(currentSeconds)}
        </span>
      </header>

      <form className="moment-composer" onSubmit={(event) => void handleSubmit(event)}>
        <div className="moment-emoji-row" aria-label="Choose an emoji stamp">
          {REACTION_EMOJIS.map((value) => (
            <button key={value} type="button" className={emoji === value ? 'moment-emoji moment-emoji-active' : 'moment-emoji'} onClick={() => setEmoji(emoji === value ? null : value)} aria-pressed={emoji === value}>{value}</button>
          ))}
        </div>
        <div className="moment-compose-row">
          <input className="input" value={body} maxLength={MAX_MOMENT_BODY} placeholder={editingId === null ? `Add a note at ${formatTime(currentSeconds)}…` : 'Update your note…'} onChange={(event) => setBody(event.target.value)} aria-label="Moment note" />
          <select className="input moment-visibility" value={visibility} disabled={editingId !== null} onChange={(event) => setVisibility(event.target.value as MomentVisibility)} aria-label="Note visibility">
            <option value="private">Only me</option>
            <option value="friends">Friends</option>
            {allowRoomVisibility && <option value="room">This party</option>}
          </select>
          <button type="submit" className="button button-primary" disabled={saving || (body.trim().length === 0 && emoji === null)}>{saving ? 'Saving…' : editingId === null ? 'Pin note' : 'Save'}</button>
          {editingId !== null && <button type="button" className="button" onClick={() => { setEditingId(null); setBody(''); setEmoji(null); }}>Cancel</button>}
        </div>
      </form>

      <div className="moment-filter-row" aria-label="Filter moment notes">
        {(['all', 'mine', 'friends', ...(allowRoomVisibility ? ['room'] : []), 'private'] as NoteFilter[]).map((value) => (
          <button key={value} type="button" className={filter === value ? 'filter-chip filter-chip-active' : 'filter-chip'} onClick={() => setFilter(value)} aria-pressed={filter === value}>{value === 'all' ? 'All notes' : value === 'mine' ? 'My notes' : value === 'room' ? 'This party' : value}</button>
        ))}
      </div>

      {markerGroups.length > 0 && <div className="moment-note-track" aria-label="Moment note timeline">{markerGroups.map((group) => {
        const first = group.notes[0];
        if (first === undefined) return null;
        return <button key={group.bucket} type="button" disabled={!isHost} style={{ left: `${Math.min(100, Math.max(0, group.bucket * 2))}%` }} title={isHost ? `${group.notes.length} note${group.notes.length === 1 ? '' : 's'} near ${formatTime(first.positionSeconds)}` : 'Only the host can seek the room'} onClick={() => onSeek(first.positionSeconds)}>{group.notes.length > 1 ? group.notes.length : first.emoji ?? '•'}</button>;
      })}</div>}

      {error !== null && <p className="form-error" role="status">{error}</p>}
      {loading ? <div className="moment-loading"><span className="loader-orbit" aria-hidden="true" /> Loading timeline…</div> : (
        <div className="moment-note-list">
          {visibleNotes.map((note) => (
            <article key={note.id} className="moment-note-card">
              <button type="button" className="moment-time-button" disabled={!isHost} title={isHost ? `Seek the room to ${formatTime(note.positionSeconds)}` : 'Only the host can seek the room'} onClick={() => onSeek(note.positionSeconds)}>{formatTime(note.positionSeconds)}</button>
              <div className="moment-note-copy">
                <span><strong>{note.displayName}</strong><span className="moment-privacy">{note.visibility}</span></span>
                <p>{note.emoji !== null && <span aria-hidden="true">{note.emoji} </span>}{note.body || 'Emoji stamp'}</p>
              </div>
              {note.authorId === currentUserId && <div className="moment-note-actions"><button type="button" onClick={() => beginEdit(note)}>Edit</button><button type="button" onClick={() => void remove(note.id)}>Delete</button></div>}
            </article>
          ))}
          {visibleNotes.length === 0 && <div className="moment-empty"><Icon name="clock" size={24} /><strong>No notes at this video yet</strong><small>Pin the first memorable moment without covering the player.</small></div>}
          {hasMore && <button type="button" className="button moment-load-more" onClick={() => void loadOlder()}>Load earlier notes</button>}
        </div>
      )}
    </section>
  );
}
