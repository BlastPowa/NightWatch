import { describe, expect, it } from 'vitest';
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  buildInviteLink,
  deriveRoomCode,
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
  parseJoinLink,
} from './room';

describe('room codes', () => {
  it('generates codes that are always valid', () => {
    for (let i = 0; i < 200; i++) {
      expect(isValidRoomCode(generateRoomCode())).toBe(true);
    }
  });

  it('excludes the characters people confuse when reading a code aloud', () => {
    // The whole point of the custom alphabet. If someone "tidies" it back to
    // A-Z0-9, this fails.
    for (const char of '01OIL') {
      expect(ROOM_CODE_ALPHABET).not.toContain(char);
    }
  });

  it('rejects codes of the wrong length or alphabet', () => {
    expect(isValidRoomCode('ABC12')).toBe(false);
    expect(isValidRoomCode('ABC1234')).toBe(false);
    expect(isValidRoomCode('ABC01D')).toBe(false); // 0 is not in the alphabet
    expect(isValidRoomCode('abc23d')).toBe(false); // lowercase must be normalized first
  });

  it('normalizes what a user actually types', () => {
    expect(normalizeRoomCode('  kx3f9q  ')).toBe('KX3F9Q');
    expect(isValidRoomCode(normalizeRoomCode(' kx3f9q '))).toBe(true);
  });
});

describe('deriveRoomCode', () => {
  it('is deterministic — the same Discord channel always lands in the same room', () => {
    // This is load-bearing for the Activity: two members of one voice channel
    // must derive the identical code, or they end up in separate rooms.
    expect(deriveRoomCode('channel-123')).toBe(deriveRoomCode('channel-123'));
  });

  it('produces a valid code for any seed', () => {
    for (const seed of ['', 'a', 'channel-123', '9'.repeat(64), '🎬 unicode seed']) {
      const code = deriveRoomCode(seed);
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      expect(isValidRoomCode(code)).toBe(true);
    }
  });

  it('separates different channels', () => {
    expect(deriveRoomCode('channel-123')).not.toBe(deriveRoomCode('channel-124'));
  });
});

describe('invite links', () => {
  it('round-trips a code through a deep link', () => {
    const code = generateRoomCode();
    expect(parseJoinLink(buildInviteLink(code))).toBe(code);
  });

  it('uppercases a lowercase link', () => {
    expect(parseJoinLink('nightwatch://join/kx3f9q')).toBe('KX3F9Q');
  });

  it('tolerates a trailing slash and surrounding whitespace', () => {
    expect(parseJoinLink('  nightwatch://join/KX3F9Q/  ')).toBe('KX3F9Q');
  });

  it('rejects anything that is not one of our join links', () => {
    // A deep link arrives from the OS and is attacker-influenceable, so this
    // must reject rather than coerce.
    expect(parseJoinLink('nightwatch://join/KX3F9')).toBeNull();
    expect(parseJoinLink('nightwatch://join/KX3F9Q/extra')).toBeNull();
    expect(parseJoinLink('nightwatch://open/KX3F9Q')).toBeNull();
    expect(parseJoinLink('https://example.com/join/KX3F9Q')).toBeNull();
    expect(parseJoinLink('')).toBeNull();
  });

  it('rejects a well-formed link carrying a code outside the alphabet', () => {
    // Six alphanumerics pass the regex but 0 and I are not room-code letters.
    expect(parseJoinLink('nightwatch://join/KX0F9I')).toBeNull();
  });
});
