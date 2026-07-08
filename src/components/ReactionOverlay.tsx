import type { ReactionBurst } from '@/hooks/useReactions';

interface ReactionOverlayProps {
  bursts: readonly ReactionBurst[];
  onDone(id: string): void;
}

/**
 * Floating emoji animations over the player. pointer-events: none so the
 * player's own controls are never blocked.
 */
export function ReactionOverlay({ bursts, onDone }: ReactionOverlayProps): JSX.Element {
  return (
    <div className="reaction-overlay" aria-hidden="true">
      {bursts.map((burst) => (
        <span
          key={burst.id}
          className="reaction-float"
          style={{ left: `${burst.leftPercent}%` }}
          onAnimationEnd={() => onDone(burst.id)}
        >
          {burst.emoji}
        </span>
      ))}
    </div>
  );
}
