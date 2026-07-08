import type { ReactionStamp } from '@shared/reactions';

interface TimelineMarkersProps {
  markers: readonly ReactionStamp[];
  durationSeconds: number;
}

function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
}

/**
 * NightWatch's own reaction strip. We never draw over YouTube's progress
 * bar (COMPLIANCE) — this renders below the player instead.
 */
export function TimelineMarkers({ markers, durationSeconds }: TimelineMarkersProps): JSX.Element | null {
  if (durationSeconds <= 0 || markers.length === 0) {
    return null;
  }

  return (
    <div className="timeline-strip">
      {markers.map((marker) => (
        <span
          key={marker.id}
          className="timeline-marker"
          style={{
            left: `${Math.min(100, Math.max(0, (marker.positionSeconds / durationSeconds) * 100))}%`,
          }}
          title={`${marker.emoji} at ${formatTimestamp(marker.positionSeconds)}`}
        >
          {marker.emoji}
        </span>
      ))}
    </div>
  );
}
