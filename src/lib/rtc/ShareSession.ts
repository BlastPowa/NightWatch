import { commsFail, commsOk, type CommsOutcome } from '@shared/roomComms';
import type { ShareEndReason, ShareSessionPhase } from '@shared/rtc';
import { log } from '@/lib/log';
import { SignalingService } from '@/lib/rtc/SignalingService';
import { getTurnCredentials } from '@/lib/rtc/TurnService';

/**
 * Phase 32 — screen/window live-share over WebRTC (sharer side + viewer side).
 *
 * The sharer captures via getDisplayMedia — on Electron desktop that is
 * routed through the main process' display-media handler and the renderer's
 * explicit source pick (see electron/comms/captureSources.ts). Media flows
 * only over RTCPeerConnections; Supabase carries signaling envelopes.
 *
 * There is no recording path in this class, and the share indicator state is
 * exposed so the shell can render an always-visible "sharing" chip with a
 * stop control while a capture track is live (handoff §4).
 */

export interface ShareSessionEvents {
  onPhase(phase: ShareSessionPhase, endReason: ShareEndReason | null): void;
  /** Viewer side: the sharer's stream arrived / ended. */
  onRemoteStream(stream: MediaStream | null): void;
  onViewerCount(count: number): void;
}

const MAX_SHARE_VIEWERS = 7; // sharer + 7 = RTC_MESH_MAX_PEERS

export class ShareSession {
  private readonly signaling: SignalingService;
  private readonly peers = new Map<string, RTCPeerConnection>();
  private readonly sessionId: string;
  private activeSessionId: string;
  private captureStream: MediaStream | null = null;
  private iceServers: RTCIceServer[] = [];
  private phase: ShareSessionPhase = 'idle';
  private disposed = false;

  public constructor(
    private readonly roomCode: string,
    private readonly selfId: string,
    private readonly events: ShareSessionEvents,
  ) {
    this.signaling = new SignalingService(roomCode);
    this.sessionId = [...crypto.getRandomValues(new Uint8Array(16))]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    this.activeSessionId = this.sessionId;
  }

  public static supported(): boolean {
    return (
      typeof window !== 'undefined' &&
      window.isSecureContext &&
      typeof RTCPeerConnection === 'function' &&
      typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices?.getDisplayMedia === 'function'
    );
  }

  public getSessionId(): string {
    return this.sessionId;
  }

  /**
   * SHARER: capture and start answering viewers. On Electron the platform's
   * display-media handler resolves the source the user picked; in a plain
   * browser the native picker appears.
   */
  public async startSharing(): Promise<CommsOutcome<void>> {
    if (!ShareSession.supported()) {
      return commsFail('not-supported', 'Screen sharing is not supported on this platform.');
    }
    await this.prepareIce();
    this.setPhase('picking-source');
    try {
      this.captureStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 30 } },
        audio: false,
      });
    } catch {
      this.setPhase('ended', 'permission-denied');
      return commsFail('permission-required', 'Screen capture was declined.');
    }

    const track = this.captureStream.getVideoTracks()[0];
    if (track === undefined) {
      this.setPhase('ended', 'error');
      return commsFail('server-error', 'No capture track was produced.');
    }
    // OS-level "stop sharing" or closing the captured window ends the share.
    track.addEventListener('ended', () => this.end('source-closed'));

    this.signaling.start((signal) => {
      if (signal.purpose !== 'screen-share' || signal.sessionId !== this.sessionId) {
        return;
      }
      void this.handleSharerSignal(signal.senderId, signal.kind, signal.payload);
    });

    this.setPhase('sharing');
    return commsOk(undefined);
  }

  /** VIEWER: request the sharer's stream (consent = an explicit click). */
  public async startViewing(
    sharerId: string,
    sessionId: string,
  ): Promise<CommsOutcome<void>> {
    if (sharerId === this.selfId) {
      return commsFail('forbidden', 'You cannot view your own share as a remote viewer.');
    }
    if (
      typeof window === 'undefined' ||
      !window.isSecureContext ||
      typeof RTCPeerConnection !== 'function'
    ) {
      return commsFail('not-supported', 'Live share viewing is not supported here.');
    }
    await this.prepareIce();
    this.activeSessionId = sessionId;
    this.setPhase('connecting');

    this.signaling.start((signal) => {
      if (signal.purpose !== 'screen-share' || signal.sessionId !== sessionId) {
        return;
      }
      void this.handleViewerSignal(sharerId, signal.senderId, signal.kind, signal.payload);
    });

    const connection = this.ensurePeer(sharerId, sessionId, 'viewer');
    const offer = await connection.createOffer({ offerToReceiveVideo: true });
    await connection.setLocalDescription(offer);
    const sent = await this.signaling.send(
      sharerId,
      'screen-share',
      'offer',
      sessionId,
      JSON.stringify(offer),
    );
    if (!sent.ok) {
      this.end('error');
      return sent;
    }
    return commsOk(undefined);
  }

  public end(reason: ShareEndReason = 'stopped'): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const userId of this.peers.keys()) {
      void this.signaling.send(userId, 'screen-share', 'bye', this.activeSessionId, '');
    }
    for (const connection of this.peers.values()) {
      connection.close();
    }
    this.peers.clear();
    this.signaling.stop();
    this.captureStream?.getTracks().forEach((track) => track.stop());
    this.captureStream = null;
    this.events.onRemoteStream(null);
    this.events.onViewerCount(0);
    this.setPhase('ended', reason);
  }

  // -- internals ------------------------------------------------------------

  private async prepareIce(): Promise<void> {
    const turn = await getTurnCredentials(this.roomCode);
    this.iceServers = turn.ok
      ? [
          {
            urls: turn.value.urls,
            username: turn.value.username,
            credential: turn.value.credential,
          },
        ]
      : [];
    if (!turn.ok) {
      log('warn', `Share starting without TURN: ${turn.code}`);
    }
  }

  private ensurePeer(
    userId: string,
    sessionId: string,
    role: 'sharer' | 'viewer',
  ): RTCPeerConnection {
    const existing = this.peers.get(userId);
    if (existing !== undefined) {
      return existing;
    }
    const connection = new RTCPeerConnection({ iceServers: this.iceServers });
    this.peers.set(userId, connection);

    if (role === 'sharer' && this.captureStream !== null) {
      for (const track of this.captureStream.getVideoTracks()) {
        connection.addTrack(track, this.captureStream);
      }
    }
    if (role === 'viewer') {
      connection.ontrack = (event) => {
        const stream = event.streams[0];
        if (stream !== undefined) {
          this.events.onRemoteStream(stream);
          this.setPhase('sharing');
        }
      };
    }
    connection.onicecandidate = (event) => {
      if (event.candidate !== null) {
        void this.signaling.send(
          userId,
          'screen-share',
          'ice',
          sessionId,
          JSON.stringify(event.candidate.toJSON()),
        );
      }
    };
    connection.onconnectionstatechange = () => {
      if (
        connection.connectionState === 'failed' ||
        connection.connectionState === 'closed'
      ) {
        this.peers.delete(userId);
        connection.close();
        this.events.onViewerCount(this.peers.size);
        if (role === 'viewer') {
          this.events.onRemoteStream(null);
          this.end('error');
        }
      }
    };
    return connection;
  }

  private async handleSharerSignal(
    viewerId: string,
    kind: string,
    payload: string,
  ): Promise<void> {
    try {
      if (kind === 'bye') {
        this.peers.get(viewerId)?.close();
        this.peers.delete(viewerId);
        this.events.onViewerCount(this.peers.size);
        return;
      }
      if (kind === 'offer') {
        if (this.peers.size >= MAX_SHARE_VIEWERS && !this.peers.has(viewerId)) {
          return; // viewer-limit: no answer, viewer stays out
        }
        const connection = this.ensurePeer(viewerId, this.sessionId, 'sharer');
        await connection.setRemoteDescription(
          JSON.parse(payload) as RTCSessionDescriptionInit,
        );
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        await this.signaling.send(
          viewerId,
          'screen-share',
          'answer',
          this.sessionId,
          JSON.stringify(answer),
        );
        this.events.onViewerCount(this.peers.size);
      } else if (kind === 'ice') {
        await this.peers
          .get(viewerId)
          ?.addIceCandidate(JSON.parse(payload) as RTCIceCandidateInit);
      }
    } catch (error) {
      log('warn', `Share (sharer) signal failed: ${String(error)}`);
    }
  }

  private async handleViewerSignal(
    sharerId: string,
    senderId: string,
    kind: string,
    payload: string,
  ): Promise<void> {
    if (senderId !== sharerId) {
      return; // only the sharer may signal this viewer's session
    }
    try {
      const connection = this.peers.get(sharerId);
      if (connection === undefined) {
        return;
      }
      if (kind === 'bye') {
        this.end('stopped');
      } else if (kind === 'answer') {
        await connection.setRemoteDescription(
          JSON.parse(payload) as RTCSessionDescriptionInit,
        );
      } else if (kind === 'ice') {
        await connection.addIceCandidate(JSON.parse(payload) as RTCIceCandidateInit);
      }
    } catch (error) {
      log('warn', `Share (viewer) signal failed: ${String(error)}`);
    }
  }

  private setPhase(phase: ShareSessionPhase, endReason: ShareEndReason | null = null): void {
    this.phase = phase;
    this.events.onPhase(phase, endReason);
  }

  public getPhase(): ShareSessionPhase {
    return this.phase;
  }
}
