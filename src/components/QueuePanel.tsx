import { useState, type FormEvent } from 'react';
import { extractVideoId } from '@shared/youtube';
import type { QueueBinding } from '@/hooks/useQueue';

interface QueuePanelProps {
  queue: QueueBinding;
  selfId: string;
  selfName: string;
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

  return (
    <div className="queue-panel">
      <div className="queue-header">
        <h2 className="settings-heading">Up next — vote to reorder</h2>
        <span className="queue-count">
          {queue.entries.length > 0 ? queue.entries.length : ''}
        </span>
        {isHost && queue.entries.length > 0 && (
          <button
            type="button"
            className="button queue-play-next"
            title="Skip to the top-voted video now"
            onClick={onPlayNext}
          >
            ▶ Play next
          </button>
        )}
      </div>

      <form className="queue-form" onSubmit={handleAdd}>
        <input
          className="input"
          value={url}
          placeholder="Add a YouTube link to the queue…"
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
        />
        <button type="submit" className="button">
          Add
        </button>
      </form>

      {error !== null && <p className="form-error">{error}</p>}

      {queue.entries.length > 0 && (
        <ul className="queue-list">
          {queue.entries.map((entry, index) => {
            const hasVoted = entry.votes.includes(selfId);
            const canRemove = isHost || entry.addedById === selfId;
            return (
              <li key={entry.id} className="queue-entry">
                <span className="queue-pos">{index + 1}</span>
                <span className="queue-title" title={entry.title}>
                  {entry.title}
                  <span className="queue-by"> · {entry.addedByName}</span>
                </span>
                <button
                  type="button"
                  className={`queue-vote${hasVoted ? ' queue-vote-active' : ''}`}
                  title={hasVoted ? 'Remove vote' : 'Vote up'}
                  onClick={() => queue.vote(entry.id)}
                >
                  ▲ {entry.votes.length}
                </button>
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
        </ul>
      )}
    </div>
  );
}
