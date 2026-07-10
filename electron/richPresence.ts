import { Client } from '@xhayper/discord-rpc';
import type { PresenceState } from '@shared/ipc';

const RETRY_INTERVAL_MS = 60_000;

/**
 * Discord Rich Presence, main-process side (§7.5). Uses the same Discord
 * Application as OAuth (ADR-011). Degrades silently: if Discord isn't
 * running or no client id is configured, the app works normally and this
 * manager just retries in the background.
 */
export class RichPresenceManager {
  private client: Client | null = null;
  private connected = false;
  private retryTimer: NodeJS.Timeout | null = null;
  private lastState: PresenceState | null = null;
  private sessionStartMs = Date.now();
  private stopped = false;

  public constructor(private readonly clientId: string | undefined) {}

  public start(): void {
    if (this.clientId === undefined || this.clientId.length === 0) {
      console.info('[presence] VITE_DISCORD_CLIENT_ID not set — Rich Presence disabled.');
      return;
    }
    void this.connect();
  }

  public update(state: PresenceState | null): void {
    if (state !== null && state.roomCode !== this.lastState?.roomCode) {
      this.sessionStartMs = Date.now();
    }
    this.lastState = state;
    void this.applyState();
  }

  public stop(): void {
    this.stopped = true;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    void this.client?.destroy().catch(() => {});
    this.client = null;
    this.connected = false;
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.clientId === undefined) {
      return;
    }
    try {
      const client = new Client({ clientId: this.clientId });
      client.on('disconnected', () => {
        this.connected = false;
        this.scheduleRetry();
      });
      await client.login();
      this.client = client;
      this.connected = true;
      await this.applyState();
    } catch {
      this.connected = false;
      this.scheduleRetry();
    }
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer !== null) {
      return;
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, RETRY_INTERVAL_MS);
  }

  private async applyState(): Promise<void> {
    if (!this.connected || this.client === null) {
      return;
    }
    try {
      if (this.lastState === null) {
        await this.client.user?.clearActivity();
        return;
      }
      await this.client.user?.setActivity({
        details:
          this.lastState.videoTitle !== null && this.lastState.videoTitle.length > 0
            ? `Watching: ${this.lastState.videoTitle.slice(0, 100)}`
            : 'Picking something to watch',
        // Never expose the room code — it's the room's access credential.
        state: 'In a watch party',
        startTimestamp: this.sessionStartMs,
      });
    } catch {
      // Presence is cosmetic — never let it disturb the app.
    }
  }
}
