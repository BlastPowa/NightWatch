import { describe, expect, it } from 'vitest';
import { RTC_MESH_MAX_PEERS } from '@shared/rtc';
import { VoiceSessionCore } from './sessionCore';

describe('VoiceSessionCore', () => {
  it('walks idle → requesting → connecting → connected', () => {
    const core = new VoiceSessionCore();
    core.beginPermissionRequest();
    expect(core.snapshot().phase).toBe('requesting-permission');
    core.permissionGranted();
    expect(core.snapshot().phase).toBe('connecting');
    core.addPeer('a');
    core.peerConnected('a');
    expect(core.snapshot().phase).toBe('connected');
  });

  it('permission denial ends the session with the right reason', () => {
    const core = new VoiceSessionCore();
    core.beginPermissionRequest();
    core.permissionDenied();
    const snap = core.snapshot();
    expect(snap.phase).toBe('ended');
    expect(snap.endReason).toBe('permission-denied');
  });

  it('enforces the mesh ceiling and stays idempotent for known peers', () => {
    const core = new VoiceSessionCore();
    for (let index = 0; index < RTC_MESH_MAX_PEERS - 1; index++) {
      expect(core.addPeer(`peer-${index}`)).toBe(true);
    }
    expect(core.addPeer('one-too-many')).toBe(false);
    // Re-adding an existing peer is allowed (renegotiation), not a new slot.
    expect(core.addPeer('peer-0')).toBe(true);
  });

  it('deafen implies mute and suppresses speaking', () => {
    const core = new VoiceSessionCore();
    core.setSpeaking(true);
    const state = core.setDeafened(true);
    expect(state.muted).toBe(true);
    expect(state.deafened).toBe(true);
    expect(state.speaking).toBe(false);
    // Muted users cannot be marked speaking.
    expect(core.setSpeaking(true).speaking).toBe(false);
  });

  it('transport loss moves connected → reconnecting and drops peer links', () => {
    const core = new VoiceSessionCore();
    core.beginPermissionRequest();
    core.permissionGranted();
    core.addPeer('a');
    core.peerConnected('a');
    core.transportLost();
    const snap = core.snapshot();
    expect(snap.phase).toBe('reconnecting');
    expect(snap.peers[0]?.connected).toBe(false);
    // Reconnect completes back to connected.
    core.peerConnected('a');
    expect(core.snapshot().phase).toBe('connected');
  });

  it('device loss ends with device-lost and clears state', () => {
    const core = new VoiceSessionCore();
    core.addPeer('a');
    core.deviceLost();
    const snap = core.snapshot();
    expect(snap.phase).toBe('ended');
    expect(snap.endReason).toBe('device-lost');
    expect(snap.peers).toHaveLength(0);
    expect(core.canAcceptPeer('b')).toBe(false);
  });

  it('end is terminal and idempotent', () => {
    const core = new VoiceSessionCore();
    core.end('left');
    core.end('error');
    expect(core.snapshot().endReason).toBe('left');
  });
});
