import {
  commsFail,
  commsFailFromRpc,
  commsOk,
  type CommsOutcome,
} from '@shared/roomComms';
import {
  parseRtcSignal,
  type RtcSignal,
  type RtcSessionPurpose,
  type RtcSignalKind,
} from '@shared/rtc';
import { supabase } from '@/lib/supabase';

/**
 * Phase 32 — signaling transport over the Supabase RPCs (0026).
 *
 * Carries ONLY signaling envelopes. Media never touches this path: the SDP
 * this service moves is what lets two clients open a direct WebRTC link,
 * and that link is where audio/video lives.
 */

export interface IncomingSignal extends RtcSignal {
  rowId: number;
  senderId: string;
}

export class SignalingService {
  private cursor = 0;
  private pollTimer: number | null = null;
  private listener: ((signal: IncomingSignal) => void) | null = null;

  public constructor(private readonly roomCode: string) {}

  public async send(
    recipientId: string,
    purpose: RtcSessionPurpose,
    kind: RtcSignalKind,
    sessionId: string,
    payload: string,
  ): Promise<CommsOutcome<void>> {
    try {
      const { error } = await supabase.rpc('send_rtc_signal', {
        p_room_code: this.roomCode,
        p_recipient: recipientId,
        p_purpose: purpose,
        p_kind: kind,
        p_session_id: sessionId,
        p_payload: payload,
      });
      if (error !== null) {
        return commsFailFromRpc(error);
      }
      return commsOk(undefined);
    } catch {
      return commsFail('offline', 'Could not reach the signaling service.');
    }
  }

  /** Start polling the inbox. One listener; call stop() on teardown. */
  public start(listener: (signal: IncomingSignal) => void, intervalMs = 1000): void {
    this.listener = listener;
    if (this.pollTimer !== null) {
      return;
    }
    this.pollTimer = window.setInterval(() => {
      void this.poll();
    }, intervalMs);
    void this.poll();
  }

  public stop(): void {
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.listener = null;
  }

  private async poll(): Promise<void> {
    try {
      const { data, error } = await supabase.rpc('fetch_rtc_signals', {
        p_room_code: this.roomCode,
        p_after: this.cursor,
      });
      if (error !== null || !Array.isArray(data)) {
        return;
      }
      for (const row of data) {
        const record = row as {
          id?: unknown;
          sender_id?: unknown;
          purpose?: unknown;
          kind?: unknown;
          session_id?: unknown;
          payload?: unknown;
        };
        if (typeof record.id !== 'number' || typeof record.sender_id !== 'string') {
          continue;
        }
        this.cursor = Math.max(this.cursor, record.id);
        const parsed = parseRtcSignal({
          kind: record.kind,
          sessionId: record.session_id,
          purpose: record.purpose,
          payload: record.payload,
        });
        if (parsed !== null && this.listener !== null) {
          this.listener({ ...parsed, rowId: record.id, senderId: record.sender_id });
        }
      }
    } catch {
      // Poll again next tick; transport hiccups are expected.
    }
  }
}
