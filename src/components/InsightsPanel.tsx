import { useEffect, useState } from 'react';
import {
  listSessionEvents,
  listSessions,
  type SessionEvent,
  type SessionSummary,
} from '@/lib/analytics/InsightsService';
import { HighlightReelPanel } from '@/components/HighlightReelPanel';

interface InsightsPanelProps {
  roomCode: string;
  onPlayHighlight(videoId: string, positionSeconds: number): void;
}

function formatSession(session: SessionSummary): string {
  const start = new Date(session.startedAt);
  const label = start.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  if (session.endedAt === null) {
    return `${label} (live/unclosed)`;
  }
  const minutes = Math.max(1, Math.round((Date.parse(session.endedAt) - start.getTime()) / 60000));
  return `${label} · ${minutes} min`;
}

/**
 * TEMPORARY host insights view (Phase 17) — functional placeholder for the
 * frontend lane. Retention = presence samples over the session; reaction
 * density = reactions bucketed along video position.
 */
export function InsightsPanel({ roomCode, onPlayHighlight }: InsightsPanelProps): JSX.Element {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void listSessions(roomCode).then((list) => {
      setSessions(list);
      setLoading(false);
    });
  }, [roomCode]);

  useEffect(() => {
    if (selected === null) {
      setEvents([]);
      return;
    }
    void listSessionEvents(selected).then(setEvents);
  }, [selected]);

  const memberSamples = events.filter((e) => e.kind === 'members');
  const reactions = events.filter((e) => e.kind === 'reaction');
  const peak = Math.max(1, ...memberSamples.map((e) => e.value));

  // Reaction density: 30 buckets across observed positions.
  const maxPosition = Math.max(60, ...reactions.map((e) => e.value));
  const buckets = new Array<number>(30).fill(0);
  for (const reaction of reactions) {
    const index = Math.min(29, Math.floor((reaction.value / maxPosition) * 30));
    buckets[index] = (buckets[index] ?? 0) + 1;
  }
  const maxBucket = Math.max(1, ...buckets);

  return (
    <div className="insights-panel">
      <h3 className="settings-heading">Session insights</h3>
      {loading && <p className="user-sub">Loading sessions…</p>}
      {!loading && sessions.length === 0 && (
        <p className="user-sub">
          No recorded sessions yet — insights record while you host with the setting on.
        </p>
      )}

      {sessions.length > 0 && (
        <div className="insights-sessions">
          {sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              className={`source-tab${selected === session.id ? ' source-tab-active' : ''}`}
              onClick={() => setSelected(session.id)}
            >
              {formatSession(session)}
            </button>
          ))}
        </div>
      )}

      {selected !== null && memberSamples.length > 0 && (
        <div>
          <p className="user-sub">Viewers over the session (peak {peak})</p>
          <svg className="insights-chart" viewBox="0 0 300 60" preserveAspectRatio="none">
            {memberSamples.map((sample, index) => (
              <rect
                key={index}
                x={(index / memberSamples.length) * 300}
                y={60 - (sample.value / peak) * 56}
                width={Math.max(2, 300 / memberSamples.length - 1)}
                height={(sample.value / peak) * 56}
                className="insights-bar"
              />
            ))}
          </svg>
        </div>
      )}

      {selected !== null && reactions.length > 0 && (
        <div>
          <p className="user-sub">Reaction density by video position ({reactions.length} total)</p>
          <svg className="insights-chart" viewBox="0 0 300 40" preserveAspectRatio="none">
            {buckets.map((count, index) => (
              <rect
                key={index}
                x={index * 10}
                y={40 - (count / maxBucket) * 36}
                width={9}
                height={(count / maxBucket) * 36}
                className="insights-bar insights-bar-accent"
              />
            ))}
          </svg>
        </div>
      )}

      {selected !== null && memberSamples.length === 0 && reactions.length === 0 && (
        <p className="user-sub">No events recorded in this session.</p>
      )}

      {selected !== null && (
        <HighlightReelPanel sessionId={selected} onSeek={onPlayHighlight} />
      )}
    </div>
  );
}
