import { describe, expect, it } from 'vitest';
import {
  isCaptureSourceId,
  isSignalPayloadAcceptable,
  parseRtcSignal,
  parseTurnCredentials,
  RTC_SIGNAL_MAX_PAYLOAD_CHARS,
  turnCredentialsFresh,
} from './rtc';

describe('parseRtcSignal', () => {
  const base = {
    kind: 'offer',
    sessionId: 'a'.repeat(32),
    purpose: 'voice',
    payload: '{"sdp":"v=0"}',
  };

  it('accepts a well-formed offer', () => {
    expect(parseRtcSignal(base)).not.toBeNull();
  });

  it('requires an empty payload for bye and a non-empty one otherwise', () => {
    expect(parseRtcSignal({ ...base, kind: 'bye', payload: '' })).not.toBeNull();
    expect(parseRtcSignal({ ...base, kind: 'bye', payload: 'x' })).toBeNull();
    expect(parseRtcSignal({ ...base, payload: '' })).toBeNull();
  });

  it('enforces the payload ceiling', () => {
    expect(isSignalPayloadAcceptable('offer', 'x'.repeat(RTC_SIGNAL_MAX_PAYLOAD_CHARS))).toBe(
      true,
    );
    expect(
      isSignalPayloadAcceptable('offer', 'x'.repeat(RTC_SIGNAL_MAX_PAYLOAD_CHARS + 1)),
    ).toBe(false);
  });

  it('rejects malformed session ids, kinds, and purposes', () => {
    expect(parseRtcSignal({ ...base, sessionId: 'short' })).toBeNull();
    expect(parseRtcSignal({ ...base, kind: 'media' })).toBeNull();
    expect(parseRtcSignal({ ...base, purpose: 'file-transfer' })).toBeNull();
  });
});

describe('capture source ids', () => {
  it('accepts desktopCapturer shapes only', () => {
    expect(isCaptureSourceId('screen:0:0')).toBe(true);
    expect(isCaptureSourceId('window:1234:0')).toBe(true);
    expect(isCaptureSourceId('file:///C:/secret')).toBe(false);
    expect(isCaptureSourceId('screen:x:0')).toBe(false);
  });
});

describe('TURN credentials', () => {
  const good = {
    urls: ['turns:turn.example.com:5349?transport=tcp', 'stun:stun.example.com:3478'],
    username: '1700000000:user',
    credential: 'base64mac',
    expiresAt: 1_700_000_000,
  };

  it('parses valid credentials', () => {
    expect(parseTurnCredentials(good)).not.toBeNull();
  });

  it('rejects non-turn/stun URL schemes', () => {
    expect(parseTurnCredentials({ ...good, urls: ['https://evil.example'] })).toBeNull();
  });

  it('freshness requires >30s of remaining life', () => {
    expect(turnCredentialsFresh(good, good.expiresAt - 600)).toBe(true);
    expect(turnCredentialsFresh(good, good.expiresAt - 10)).toBe(false);
  });
});
