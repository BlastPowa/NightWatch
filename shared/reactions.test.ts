import { describe, expect, it } from 'vitest';
import { REACTION_EMOJIS, isReactionEmoji } from './reactions';

describe('isReactionEmoji', () => {
  it('accepts every emoji in the palette', () => {
    for (const emoji of REACTION_EMOJIS) {
      expect(isReactionEmoji(emoji)).toBe(true);
    }
  });

  it('rejects anything not in the palette', () => {
    // This is a WIRE VALIDATOR, not a UI helper: reactions arrive over
    // Broadcast from other clients, so whatever a peer sends lands here. It is
    // the boundary that stops a hostile or buggy client rendering arbitrary
    // content in everyone else's overlay.
    expect(isReactionEmoji('🍕')).toBe(false);
    expect(isReactionEmoji('')).toBe(false);
    expect(isReactionEmoji('not an emoji')).toBe(false);
    expect(isReactionEmoji('<script>alert(1)</script>')).toBe(false);
  });

  it('rejects a payload that merely contains an allowed emoji', () => {
    // Substring-matching here would let a peer smuggle a wall of text into the
    // overlay by appending it to a valid emoji.
    expect(isReactionEmoji('🔥🔥🔥🔥🔥🔥🔥🔥')).toBe(false);
    expect(isReactionEmoji('🔥 plus some text')).toBe(false);
    expect(isReactionEmoji(` ${REACTION_EMOJIS[0]} `)).toBe(false);
  });

  it('has a palette of distinct emojis', () => {
    expect(new Set(REACTION_EMOJIS).size).toBe(REACTION_EMOJIS.length);
  });
});
