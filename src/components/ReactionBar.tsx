import { REACTION_EMOJIS, type ReactionEmoji } from '@shared/reactions';

interface ReactionBarProps {
  disabled: boolean;
  onReact(emoji: ReactionEmoji): void | Promise<unknown>;
}

export function ReactionBar({ disabled, onReact }: ReactionBarProps): JSX.Element {
  return (
    <div className="reaction-bar">
      {REACTION_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          className="reaction-button"
          disabled={disabled}
          title={disabled ? 'Load a video to react' : `React ${emoji}`}
          onClick={() => { void onReact(emoji); }}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
