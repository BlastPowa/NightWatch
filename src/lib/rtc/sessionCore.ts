import {
  RTC_MESH_MAX_PEERS,
  type VoiceEndReason,
  type VoicePeerState,
  type VoiceSessionPhase,
} from '@shared/rtc';

/**
 * Phase 32 — pure voice-session state machine.
 *
 * All the decision logic (who may join the mesh, what mute/deafen do, how
 * device loss and reconnects change phase) lives here with zero DOM/WebRTC
 * dependencies so it is unit-testable. VoiceSession.ts owns the actual
 * RTCPeerConnections and delegates every decision to this core.
 */

export interface VoicePeer {
  userId: string;
  state: VoicePeerState;
  connected: boolean;
}

export interface VoiceCoreSnapshot {
  phase: VoiceSessionPhase;
  self: VoicePeerState;
  peers: readonly VoicePeer[];
  endReason: VoiceEndReason | null;
}

export class VoiceSessionCore {
  private phase: VoiceSessionPhase = 'idle';
  private self: VoicePeerState = { muted: false, deafened: false, speaking: false };
  private readonly peers = new Map<string, VoicePeer>();
  private endReason: VoiceEndReason | null = null;

  public snapshot(): VoiceCoreSnapshot {
    return {
      phase: this.phase,
      self: { ...this.self },
      peers: [...this.peers.values()].map((peer) => ({ ...peer, state: { ...peer.state } })),
      endReason: this.endReason,
    };
  }

  public beginPermissionRequest(): void {
    if (this.phase === 'idle') {
      this.phase = 'requesting-permission';
    }
  }

  public permissionGranted(): void {
    if (this.phase === 'requesting-permission') {
      this.phase = 'connecting';
    }
  }

  public permissionDenied(): void {
    this.end('permission-denied');
  }

  /** May another peer join the mesh? Enforces the P2P ceiling. */
  public canAcceptPeer(userId: string): boolean {
    if (this.phase === 'ended') {
      return false;
    }
    return this.peers.has(userId) || this.peers.size < RTC_MESH_MAX_PEERS - 1;
  }

  public addPeer(userId: string): boolean {
    if (!this.canAcceptPeer(userId)) {
      return false;
    }
    if (!this.peers.has(userId)) {
      this.peers.set(userId, {
        userId,
        connected: false,
        state: { muted: false, deafened: false, speaking: false },
      });
    }
    return true;
  }

  public peerConnected(userId: string): void {
    const peer = this.peers.get(userId);
    if (peer !== undefined) {
      peer.connected = true;
    }
    if (this.phase === 'connecting' || this.phase === 'reconnecting') {
      this.phase = 'connected';
    }
  }

  public peerLeft(userId: string): void {
    this.peers.delete(userId);
  }

  public peerStateChanged(userId: string, state: VoicePeerState): void {
    const peer = this.peers.get(userId);
    if (peer !== undefined) {
      peer.state = { ...state };
    }
  }

  /** Transport dropped but the session is still wanted. */
  public transportLost(): void {
    if (this.phase === 'connected' || this.phase === 'connecting') {
      this.phase = 'reconnecting';
      for (const peer of this.peers.values()) {
        peer.connected = false;
      }
    }
  }

  public setMuted(muted: boolean): VoicePeerState {
    this.self = { ...this.self, muted, speaking: muted ? false : this.self.speaking };
    return { ...this.self };
  }

  /** Deafen implies mute (industry-standard semantics). */
  public setDeafened(deafened: boolean): VoicePeerState {
    this.self = {
      muted: deafened ? true : this.self.muted,
      deafened,
      speaking: deafened ? false : this.self.speaking,
    };
    return { ...this.self };
  }

  /** Speaking is a derived, rate-limited flag; muted users never "speak". */
  public setSpeaking(speaking: boolean): VoicePeerState {
    if (this.self.muted || this.self.deafened) {
      return { ...this.self };
    }
    this.self = { ...this.self, speaking };
    return { ...this.self };
  }

  public deviceLost(): void {
    this.end('device-lost');
  }

  public end(reason: VoiceEndReason): void {
    if (this.phase === 'ended') {
      return;
    }
    this.phase = 'ended';
    this.endReason = reason;
    this.peers.clear();
    this.self = { muted: false, deafened: false, speaking: false };
  }

  public isEnded(): boolean {
    return this.phase === 'ended';
  }
}
