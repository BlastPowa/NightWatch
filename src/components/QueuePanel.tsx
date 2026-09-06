import { useState, type FormEvent } from 'react';
import { extractVideoId } from '@shared/youtube';
import type { QueueBinding } from '@/hooks/useQueue';
import { Icon } from '@/components/Icon';

interface QueuePanelProps {
  queue: QueueBinding;
  selfId: string;
  selfName: string;
  members?: readonly { id: string; displayName: string }[];
  isHost: boolean;
  /** Host: skip to the top-voted entry now (livestreams never "end"). */
  onPlayNext(): void;
}

/**
 * Shared video queue (Phase 15, ADR-013): anyone adds and votes; playback
 * auto-advances to the top entry when the current video ends.
 */
export function QueuePanel({
  queue,
  selfId,
  selfName,
  members = [],
  isHost,
  onPlayNext,
}: QueuePanelProps): JSX.Element {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleAdd(event: FormEvent): void {
    event.preventDefault();
    const videoId = extractVideoId(url);
    if (videoId === null) {
      setError('That does not look like a YouTube link or video id.');
      return;
    }
    if (!queue.add(videoId, '', selfName)) {
      setError('Could not add right now (wait a few seconds and retry).');
      return;
    }
    setError(null);
    setUrl('');
  }

  const memberNames = new Map(members.map((member) => [member.id, member.displayName]));

  return (
    <section className="queue-panel" aria-label="Up next queue">
      <div className="queue-header">
        <div className="queue-heading">
          <span className="eyebrow">Watch party queue</span>
          <h3>Up next</h3>
          <p className="queue-guidance">Vote together and let the room decide what plays next.</p>
        </div>
        <div className="queue-header-tools">
          <span className="queue-count" aria-label={`${queue.entries.length} queued video${queue.entries.length === 1 ? '' : 's'}`}>
            {queue.entries.length} queued
          </span>
          {isHost && queue.entries.length > 0 && (
          <button
            type="button"
            className="button queue-play-next"
            title="Skip to the top-voted video now"
            onClick={onPlayNext}
          >
            <Icon name="play" size={16} /> Play next
          </button>
          )}
        </div>
      </div>

      <form className="queue-form" onSubmit={handleAdd}>
        <label className="sr-only" htmlFor="room-queue-url">Add a YouTube link to Up next</label>
        <input
          id="room-queue-url"
          className="input"
          value={url}
          placeholder="Add a YouTube link to the queue…"
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
        />
        <button type="submit" className="button button-glow">
          <Icon name="plus" size={15} /> Add
        </button>
      </form>

      {error !== null && <p className="form-error">{error}</p>}

      {queue.entries.length === 0 && (
        <div className="queue-empty">
          <span className="queue-empty-icon"><Icon name="play" size={18} /></span>
          <strong>Nothing queued yet</strong>
          <small>Add a YouTube link and let everyone vote on the next watch.</small>
        </div>
      )}

      {queue.entries.length > 0 && (
        <ol className="queue-list">
          {queue.entries.map((entry, index) => {
            const hasVoted = entry.votes.includes(selfId);
            const canRemove = isHost || entry.addedById === selfId;
            const voterNames = entry.votes.map((voterId) => voterId === selfId ? selfName : memberNames.get(voterId) ?? 'Room viewer');
            return (
              <li key={entry.id} className="queue-entry">
                <span className="queue-pos" aria-label={`Queue position ${index + 1}`}>{index + 1}</span>
                <div className="queue-thumbnail">
                  <img src={`https://i.ytimg.com/vi/${entry.videoId}/hqdefault.jpg`} alt="" loading="lazy" onError={(event) => { event.currentTarget.hidden = true; event.currentTarget.parentElement?.classList.add('queue-thumbnail-missing'); }} />
                  <Icon name="play" size={14} />
                </div>
                <span className="queue-entry-copy" title={entry.title}>
                  <strong className="queue-title">{entry.title}</strong>
                  <small className="queue-by">Added by {entry.addedByName}</small>
                </span>
                <span className="queue-vote-wrap">
                  <button
                    type="button"
                    className={`queue-vote${hasVoted ? ' queue-vote-active' : ''}`}
                    title={hasVoted ? 'Remove vote' : 'Vote up'}
                    aria-label={`${hasVoted ? 'Remove vote' : 'Vote for'} ${entry.title}; ${entry.votes.length} vote${entry.votes.length === 1 ? '' : 's'}`}
                    aria-describedby={`queue-voters-${entry.id}`}
                    onClick={() => queue.vote(entry.id)}
                  >
                    <Icon name="chevron-up" size={14} /> <span>{entry.votes.length}</span>
                  </button>
                  <span id={`queue-voters-${entry.id}`} className="queue-voter-popover" role="tooltip">
                    <strong>Voted by</strong>
                    <span>{voterNames.join(', ')}</span>
                  </span>
                </span>
                {canRemove && (
                  <button
                    type="button"
                    className="queue-remove"
                    title="Remove from queue"
                    onClick={() => queue.remove(entry.id)}
                  >
                    ✕
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
