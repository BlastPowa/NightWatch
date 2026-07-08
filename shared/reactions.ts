/**
 * Reaction domain: the fixed emoji palette, stamp shape, and wire
 * validation. Reactions are ephemeral (session memory only, ADR-004).
 */

export const REACTION_EMOJIS = ['😂', '❤️', '🔥', '😮', '👏', '💀'] as const;

export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export function isReactionEmoji(value: string): value is ReactionEmoji {
  return (REACTION_EMOJIS as readonly string[]).includes(value);
}

/** A reaction pinned to a moment in a video. */
export interface ReactionStamp {
  id: string;
  emoji: ReactionEmoji;
  videoId: string;
  positionSeconds: number;
  senderId: string;
  at: number;
}
