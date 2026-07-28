import { describe, expect, it } from 'vitest';

import { buildInviteTokenLink, isInviteToken, parseInviteTokenLink } from './inviteToken';

const TOKEN = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

describe('isInviteToken', () => {
  it('accepts exactly 32 lowercase hex characters', () => {
    expect(isInviteToken(TOKEN)).toBe(true);
  });

  it('rejects everything else', () => {
    for (const bad of [
      TOKEN.toUpperCase(),
      `${TOKEN}0`,
      TOKEN.slice(1),
      TOKEN.replace('a', 'g'),
      ` ${TOKEN}`,
      '',
      'not-a-token',
      null,
      undefined,
      42,
      { token: TOKEN },
    ]) {
      expect(isInviteToken(bad)).toBe(false);
    }
  });
});

describe('invite deep links', () => {
  it('round-trips', () => {
    expect(parseInviteTokenLink(buildInviteTokenLink(TOKEN))).toBe(TOKEN);
  });

  it('tolerates surrounding whitespace and a trailing slash', () => {
    expect(parseInviteTokenLink(`  nightwatch://invite/${TOKEN}  `)).toBe(TOKEN);
    expect(parseInviteTokenLink(`nightwatch://invite/${TOKEN}/`)).toBe(TOKEN);
  });

  it('rejects links that are not ours', () => {
    for (const bad of [
      `https://example.com/invite/${TOKEN}`,
      `nightwatch://join/${TOKEN}`,
      `nightwatch://auth-callback?token=${TOKEN}`,
      'nightwatch://invite/ABCDEF',
      `nightwatch://invite/${TOKEN}?next=https://evil.example`,
      `nightwatch://invite/${TOKEN}/../join/ABCDEF`,
      `nightwatch://invite/${TOKEN}#ABCDEF`,
      'nightwatch://invite/',
    ]) {
      expect(parseInviteTokenLink(bad)).toBeNull();
    }
  });

  it('never embeds a room code', () => {
    const link = buildInviteTokenLink(TOKEN);
    expect(link).toBe(`nightwatch://invite/${TOKEN}`);
    expect(/[ABCDEFGHJKMNPQRSTUVWXYZ]{6}/.test(link)).toBe(false);
  });
});
