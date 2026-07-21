import type { ShareEndReason, VoiceEndReason } from '@shared/rtc';

/**
 * Remaining-features handoff, Priority 2 — one place that guarantees every
 * voice/share session is torn down on every exit path.
 *
 * The failure this prevents is specific and serious: a capture or microphone
 * track that outlives the room. Registering a session here means it is
 * stopped on room leave, sign-out, page hide, window close, and host
 * migration, even when the UI unmounts in an unexpected order.
 */

export interface VoiceTeardownTarget {
  end(reason: VoiceEndReason): void;
}

export interface ShareTeardownTarget {
  end(reason: ShareEndReason): void;
}

export type LifecycleEvent =
  | 'room-leave'
  | 'signed-out'
  | 'page-hide'
  | 'window-closed'
  | 'host-migration';

function voiceReasonFor(event: Exclude<LifecycleEvent, 'host-migration'>): VoiceEndReason {
  switch (event) {
    case 'room-leave':
      return 'left';
    case 'signed-out':
      return 'signed-out';
    case 'window-closed':
    case 'page-hide':
      return 'window-closed';
  }
}

function shareReasonFor(event: LifecycleEvent): ShareEndReason {
  switch (event) {
    case 'room-leave':
    case 'host-migration':
      return 'stopped';
    case 'signed-out':
      return 'signed-out';
    case 'window-closed':
    case 'page-hide':
      return 'window-closed';
  }
}

export class CommsLifecycle {
  private readonly voice = new Set<VoiceTeardownTarget>();
  private readonly share = new Set<ShareTeardownTarget>();
  private detach: (() => void) | null = null;

  /** Register a live session. Returns an unregister function. */
  public registerVoice(session: VoiceTeardownTarget): () => void {
    this.voice.add(session);
    return () => this.voice.delete(session);
  }

  public registerShare(session: ShareTeardownTarget): () => void {
    this.share.add(session);
    return () => this.share.delete(session);
  }

  /**
   * Attach browser/Electron exit hooks once at app start.
   * `pagehide` covers window close and navigation in both runtimes.
   */
  public attachWindowHooks(target: {
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
  }): void {
    if (this.detach !== null) {
      return;
    }
    const onPageHide = (): void => this.endAll('page-hide');
    target.addEventListener('pagehide', onPageHide);
    this.detach = () => target.removeEventListener('pagehide', onPageHide);
  }

  public detachWindowHooks(): void {
    this.detach?.();
    this.detach = null;
  }

  /**
   * End everything for a lifecycle event.
   *
   * Host migration ends SHARE only: the previous host's capture must stop,
   * but voice deliberately survives — losing host status is not a reason to
   * drop a call everyone is still in.
   */
  public endAll(event: LifecycleEvent): void {
    for (const session of this.share) {
      session.end(shareReasonFor(event));
    }
    this.share.clear();

    if (event === 'host-migration') {
      return;
    }
    for (const session of this.voice) {
      session.end(voiceReasonFor(event));
    }
    this.voice.clear();
  }

  public activeCounts(): { voice: number; share: number } {
    return { voice: this.voice.size, share: this.share.size };
  }
}

/** App-wide singleton — sessions register themselves on start. */
export const commsLifecycle = new CommsLifecycle();
