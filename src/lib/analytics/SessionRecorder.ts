import { supabase } from '@/lib/supabase';
import { log } from '@/lib/log';

/**
 * Host-side, opt-in session analytics (Phase 17, ADR-014).
 *
 * Only records when ALL of: the room has insights enabled (owner setting),
 * this client is the current host, and a session was accepted server-side.
 * Events are anonymized numbers — never identities or message content.
 * Fire-and-forget throughout: analytics must never disturb playback.
 */

type EventKind = 'members' | 'play' | 'pause' | 'seek' | 'reaction';

interface PendingEvent {
  kind: EventKind;
  value: number;
  /** Which video the position refers to — required to attribute a highlight. */
  videoId?: string;
}

const FLUSH_INTERVAL_MS = 30_000;
const MEMBERS_THROTTLE_MS = 60_000;

class SessionRecorder {
  private sessionId: string | null = null;
  private active = false;
  private roomCode = '';
  private buffer: PendingEvent[] = [];
  private flushTimer: number | null = null;
  private lastMembersAt = 0;
  private starting = false;
  /**
   * The video currently loaded. Carried as ambient state rather than threaded
   * through every call site: a position without a video id is unattributable,
   * and a session routinely spans several videos.
   */
  private videoId: string | null = null;

  /** Reconfigure on room/host/setting changes. Safe to call repeatedly. */
  public configure(roomCode: string, insightsEnabled: boolean, isHost: boolean): void {
    const shouldRecord = insightsEnabled && isHost && roomCode.length > 0;

    if (this.active && (this.roomCode !== roomCode || !shouldRecord)) {
      this.end();
    }
    this.roomCode = roomCode;

    if (shouldRecord && !this.active && !this.starting) {
      this.starting = true;
      void supabase.functions
        .invoke('log-session', { body: { action: 'start', roomCode } })
        .then(({ data, error }) => {
          this.starting = false;
          const sessionId = (data as { sessionId?: unknown } | null)?.sessionId;
          if (error === null && typeof sessionId === 'string') {
            this.sessionId = sessionId;
            this.active = true;
            this.flushTimer = window.setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
            log('info', `Session insights recording for room ${roomCode}`);
          }
        })
        .catch(() => {
          this.starting = false;
        });
    }
  }

  /** Presence sample; throttled to one per minute. */
  public members(count: number): void {
    if (!this.active || Date.now() - this.lastMembersAt < MEMBERS_THROTTLE_MS) {
      return;
    }
    this.lastMembersAt = Date.now();
    this.push({ kind: 'members', value: count });
  }

  /** The room loaded a new video; subsequent positions belong to it. */
  public setVideo(videoId: string | null): void {
    this.videoId = videoId;
  }

  public playback(kind: 'play' | 'pause' | 'seek', positionSeconds: number): void {
    this.push({ kind, value: positionSeconds, ...this.videoContext() });
  }

  public reaction(positionSeconds: number): void {
    this.push({ kind: 'reaction', value: positionSeconds, ...this.videoContext() });
  }

  private videoContext(): { videoId?: string } {
    return this.videoId === null ? {} : { videoId: this.videoId };
  }

  public end(): void {
    if (this.flushTimer !== null) {
      window.clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
    if (this.sessionId !== null) {
      void supabase.functions
        .invoke('log-session', { body: { action: 'end', sessionId: this.sessionId } })
        .catch(() => {});
    }
    this.sessionId = null;
    this.active = false;
    this.lastMembersAt = 0;
    this.videoId = null;
  }

  private push(event: PendingEvent): void {
    if (!this.active) {
      return;
    }
    this.buffer.push(event);
    if (this.buffer.length >= 10) {
      this.flush();
    }
  }

  private flush(): void {
    if (this.sessionId === null || this.buffer.length === 0) {
      return;
    }
    const events = this.buffer.splice(0, 50);
    void supabase.functions
      .invoke('log-session', {
        body: { action: 'log', sessionId: this.sessionId, events },
      })
      .catch(() => {});
  }
}

/** App-wide singleton — call sites stay decoupled from lifecycle. */
export const sessionRecorder = new SessionRecorder();
