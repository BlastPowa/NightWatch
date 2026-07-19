import { commsFail, commsOk, type CommsOutcome } from '@shared/roomComms';
import {
  DEFAULT_VOICE_CONSTRAINTS,
  type VoiceCapabilityReport,
  type VoiceEndReason,
  type VoiceInputConstraints,
  type VoicePeerState,
} from '@shared/rtc';
import { log } from '@/lib/log';
import { SignalingService } from '@/lib/rtc/SignalingService';
import { VoiceSessionCore, type VoiceCoreSnapshot } from '@/lib/rtc/sessionCore';
import { getTurnCredentials } from '@/lib/rtc/TurnService';

/**
 * Phase 32 — room voice chat over a WebRTC mesh (≤ RTC_MESH_MAX_PEERS).
 *
 * Media flows peer-to-peer (TURN-relayed when needed). Supabase carries only
 * the signaling envelopes. No recording exists anywhere in this class; the
 * microphone indicator state is exposed so the shell can render a permanent
 * capture indicator while a track is live (handoff §4).
 */

export interface VoiceSessionEvents {
  onSnapshot(snapshot: VoiceCoreSnapshot): void;
  onCapability(report: VoiceCapabilityReport): void;
  onRemoteTrack(userId: string, stream: MediaStream): void;
  onRemoteTrackEnded(userId: string): void;
  onPeerState(userId: string, state: VoicePeerState): void;
}

const SPEAKING_POLL_MS = 250;
const SPEAKING_THRESHOLD = 0.02;

export class VoiceSession {
  private readonly core = new VoiceSessionCore();
  private readonly peers = new Map<string, RTCPeerConnection>();
  private readonly signaling: SignalingService;
  private readonly sessionId: string;
  private micStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private speakingTimer: number | null = null;
  private iceServers: RTCIceServer[] = [];
  private disposed = false;

  public constructor(
    private readonly roomCode: string,
    private readonly selfId: string,
    private readonly events: VoiceSessionEvents,
  ) {
    this.signaling = new SignalingService(roomCode);
    this.sessionId = [...crypto.getRandomValues(new Uint8Array(16))]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  /** Secure-context + API availability gate (handoff §4). */
  public static supported(): boolean {
    return (
      typeof window !== 'undefined' &&
      window.isSecureContext &&
      typeof RTCPeerConnection === 'function' &&
      typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices?.getUserMedia === 'function'
    );
  }

  public async start(
    constraints: VoiceInputConstraints = DEFAULT_VOICE_CONSTRAINTS,
  ): Promise<CommsOutcome<void>> {
    if (!VoiceSession.supported()) {
      return commsFail('not-supported', 'Voice chat is not supported on this platform.');
    }

    const turn = await getTurnCredentials(this.roomCode);
    if (!turn.ok) {
      // STUN-less mesh still works on friendly networks; only hard failures
      // that indicate misconfiguration abort. Rate/offline degrade to none.
      if (turn.code === 'not-supported' || turn.code === 'forbidden' || turn.code === 'unauthorized') {
        return turn;
      }
      this.iceServers = [];
      log('warn', `Voice starting without TURN: ${turn.code}`);
    } else {
      this.iceServers = [
        {
          urls: turn.value.urls,
          username: turn.value.username,
          credential: turn.value.credential,
        },
      ];
    }

    this.core.beginPermissionRequest();
    this.publish();
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: constraints.echoCancellation,
          noiseSuppression: constraints.noiseSuppression,
          autoGainControl: constraints.autoGainControl,
          ...(constraints.deviceId !== undefined ? { deviceId: constraints.deviceId } : {}),
        },
      });
    } catch {
      this.core.permissionDenied();
      this.publish();
      return commsFail('permission-required', 'Microphone access was denied.');
    }

    const track = this.micStream.getAudioTracks()[0];
    if (track === undefined) {
      this.core.deviceLost();
      this.publish();
      return commsFail('not-supported', 'No microphone track was available.');
    }
    const settings = track.getSettings();
    this.events.onCapability({
      echoCancellation: settings.echoCancellation === true,
      noiseSuppression: settings.noiseSuppression === true,
      autoGainControl: settings.autoGainControl === true,
      deviceLabel: track.label,
    });
    track.addEventListener('ended', () => {
      // Device unplugged / OS revoked mid-session.
      this.core.deviceLost();
      this.teardownConnections();
      this.publish();
    });

    this.startSpeakingDetection(this.micStream);
    this.core.permissionGranted();
    this.publish();

    this.signaling.start((signal) => {
      if (signal.purpose !== 'voice') {
        return;
      }
      void this.handleSignal(signal.senderId, signal.kind, signal.payload);
    });

    return commsOk(undefined);
  }

  /** Dial a specific room member (the roster comes from room presence). */
  public async connectTo(userId: string): Promise<void> {
    if (this.disposed || userId === this.selfId || !this.core.addPeer(userId)) {
      return;
    }
    const connection = this.ensurePeer(userId);
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    await this.signaling.send(
      userId,
      'voice',
      'offer',
      this.sessionId,
      JSON.stringify(offer),
    );
  }

  public setMuted(muted: boolean): VoicePeerState {
    const state = this.core.setMuted(muted);
    this.applyTrackEnabled();
    this.publish();
    return state;
  }

  public setDeafened(deafened: boolean): VoicePeerState {
    const state = this.core.setDeafened(deafened);
    this.applyTrackEnabled();
    this.publish();
    return state;
  }

  public snapshot(): VoiceCoreSnapshot {
    return this.core.snapshot();
  }

  /** Leave/teardown (room exit, sign-out, window close — handoff §4). */
  public end(reason: VoiceEndReason = 'left'): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const userId of this.peers.keys()) {
      void this.signaling.send(userId, 'voice', 'bye', this.sessionId, '');
    }
    this.core.end(reason);
    this.teardownConnections();
    this.signaling.stop();
    this.stopSpeakingDetection();
    this.micStream?.getTracks().forEach((track) => track.stop());
    this.micStream = null;
    this.publish();
  }

  // -- internals ------------------------------------------------------------

  private ensurePeer(userId: string): RTCPeerConnection {
    const existing = this.peers.get(userId);
    if (existing !== undefined) {
      return existing;
    }
    const connection = new RTCPeerConnection({ iceServers: this.iceServers });
    this.peers.set(userId, connection);

    if (this.micStream !== null) {
      for (const track of this.micStream.getAudioTracks()) {
        connection.addTrack(track, this.micStream);
      }
    }

    connection.onicecandidate = (event) => {
      if (event.candidate !== null) {
        void this.signaling.send(
          userId,
          'voice',
          'ice',
          this.sessionId,
          JSON.stringify(event.candidate.toJSON()),
        );
      }
    };
    connection.ontrack = (event) => {
      const stream = event.streams[0];
      if (stream !== undefined) {
        this.events.onRemoteTrack(userId, stream);
      }
    };
    connection.onconnectionstatechange = () => {
      switch (connection.connectionState) {
        case 'connected':
          this.core.peerConnected(userId);
          break;
        case 'disconnected':
          this.core.transportLost();
          break;
        case 'failed':
        case 'closed':
          this.dropPeer(userId);
          break;
      }
      this.publish();
    };
    return connection;
  }

  private async handleSignal(
    senderId: string,
    kind: string,
    payload: string,
  ): Promise<void> {
    try {
      if (kind === 'bye') {
        this.dropPeer(senderId);
        this.publish();
        return;
      }
      if (!this.core.addPeer(senderId)) {
        return; // mesh full — the peer sees no answer and stays out
      }
      const connection = this.ensurePeer(senderId);
      if (kind === 'offer') {
        await connection.setRemoteDescription(
          JSON.parse(payload) as RTCSessionDescriptionInit,
        );
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        await this.signaling.send(
          senderId,
          'voice',
          'answer',
          this.sessionId,
          JSON.stringify(answer),
        );
      } else if (kind === 'answer') {
        await connection.setRemoteDescription(
          JSON.parse(payload) as RTCSessionDescriptionInit,
        );
      } else if (kind === 'ice') {
        await connection.addIceCandidate(JSON.parse(payload) as RTCIceCandidateInit);
      }
    } catch (error) {
      log('warn', `Voice signal handling failed: ${String(error)}`);
    }
  }

  private dropPeer(userId: string): void {
    const connection = this.peers.get(userId);
    if (connection !== undefined) {
      connection.close();
      this.peers.delete(userId);
    }
    this.core.peerLeft(userId);
    this.events.onRemoteTrackEnded(userId);
  }

  private teardownConnections(): void {
    for (const [userId, connection] of this.peers) {
      connection.close();
      this.events.onRemoteTrackEnded(userId);
    }
    this.peers.clear();
  }

  private applyTrackEnabled(): void {
    const { muted } = this.core.snapshot().self;
    this.micStream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }

  private startSpeakingDetection(stream: MediaStream): void {
    try {
      this.audioContext = new AudioContext();
      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);
      const buffer = new Uint8Array(this.analyser.frequencyBinCount);
      this.speakingTimer = window.setInterval(() => {
        if (this.analyser === null) {
          return;
        }
        this.analyser.getByteTimeDomainData(buffer);
        let sum = 0;
        for (const value of buffer) {
          const centered = (value - 128) / 128;
          sum += centered * centered;
        }
        const rms = Math.sqrt(sum / buffer.length);
        const before = this.core.snapshot().self.speaking;
        const after = this.core.setSpeaking(rms > SPEAKING_THRESHOLD).speaking;
        if (before !== after) {
          this.publish();
        }
      }, SPEAKING_POLL_MS);
    } catch {
      // Speaking detection is a nicety; voice works without it.
    }
  }

  private stopSpeakingDetection(): void {
    if (this.speakingTimer !== null) {
      window.clearInterval(this.speakingTimer);
      this.speakingTimer = null;
    }
    this.analyser = null;
    void this.audioContext?.close().catch(() => {});
    this.audioContext = null;
  }

  private publish(): void {
    this.events.onSnapshot(this.core.snapshot());
  }
}
