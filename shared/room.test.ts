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
  sanitizeAvatarUrl,
  sanitizeSocialUserId,
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

describe('sanitizeAvatarUrl', () => {
  const valid = 'https://cdn.discordapp.com/avatars/123/abc.png';

  it('accepts a canonical Discord CDN avatar URL unchanged', () => {
    expect(sanitizeAvatarUrl(valid)).toBe(valid);
  });

  it('strips query and hash (the usual tracking/cache-bust carriers)', () => {
    expect(sanitizeAvatarUrl(`${valid}?size=64&t=1`)).toBe(valid);
    expect(sanitizeAvatarUrl(`${valid}#frag`)).toBe(valid);
  });

  it('rejects any host other than cdn.discordapp.com', () => {
    expect(sanitizeAvatarUrl('https://evil.com/avatars/123/abc.png')).toBeNull();
    // Subdomain / lookalike hosts must not slip through.
    expect(sanitizeAvatarUrl('https://cdn.discordapp.com.evil.com/a.png')).toBeNull();
    expect(sanitizeAvatarUrl('https://evilcdn.discordapp.com/a.png')).toBeNull();
  });

  it('rejects non-HTTPS schemes', () => {
    expect(sanitizeAvatarUrl('http://cdn.discordapp.com/avatars/123/abc.png')).toBeNull();
    expect(sanitizeAvatarUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeAvatarUrl('data:text/html,x')).toBeNull();
  });

  it('rejects embedded credentials, ports, and malformed input', () => {
    expect(sanitizeAvatarUrl('https://user:pass@cdn.discordapp.com/a.png')).toBeNull();
    expect(sanitizeAvatarUrl('https://cdn.discordapp.com:8443/a.png')).toBeNull();
    expect(sanitizeAvatarUrl('not a url')).toBeNull();
    expect(sanitizeAvatarUrl('')).toBeNull();
  });

  it('rejects non-string and oversized values', () => {
    expect(sanitizeAvatarUrl(undefined)).toBeNull();
    expect(sanitizeAvatarUrl(null)).toBeNull();
    expect(sanitizeAvatarUrl(42)).toBeNull();
    expect(sanitizeAvatarUrl(`https://cdn.discordapp.com/${'a'.repeat(300)}.png`)).toBeNull();
  });
});

describe('sanitizeSocialUserId', () => {
  it('accepts canonical auth UUIDs and normalizes their casing', () => {
    expect(sanitizeSocialUserId('A3E13BB6-5A07-4ECF-9B9A-830DE90B17E1'))
      .toBe('a3e13bb6-5a07-4ecf-9b9a-830de90b17e1');
  });

  it('rejects guest labels, malformed UUIDs, and non-string values', () => {
    expect(sanitizeSocialUserId('Boogie')).toBeNull();
    expect(sanitizeSocialUserId('a3e13bb6-5a07-4ecf-9b9a')).toBeNull();
    expect(sanitizeSocialUserId(null)).toBeNull();
  });
});
