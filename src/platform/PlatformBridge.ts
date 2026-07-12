import type {
  AppInfo,
  LogLevel,
  NotificationRequest,
  PresenceState,
  WindowState,
} from '@shared/ipc';

/**
 * Platform adapter (§9, ADR-008): the renderer core talks to the host
 * platform (Electron, Discord Activity, plain browser) only through this
 * interface. Each build target installs its own implementation at startup.
 */
export interface PlatformBridge {
  readonly kind: 'electron' | 'discord' | 'web';
  /** App/runtime info, or null when the platform doesn't expose it. */
  getAppInfo(): Promise<AppInfo | null>;
  /** Rich Presence style status update; may be a no-op. */
  updatePresence(state: PresenceState | null): void;
  /** Platform logging sink (file on Electron, console elsewhere). */
  log(level: LogLevel, message: string): void;
  /**
   * Room code imposed by the platform (Discord voice channel → shared
   * room), or null when the user picks/creates rooms freely.
   */
  getFixedRoomCode(): Promise<string | null>;
  /**
   * Identity supplied by the platform (Discord Activity auth), or null
   * when the user goes through the normal name prompt / guest flow.
   */
  getPlatformIdentity(): Promise<{ name: string; avatarUrl: string | null } | null>;
  /**
   * Raise a desktop notification (Phase 19: a scheduled watch party is about
   * to start). Best-effort — platforms without a notification surface no-op.
   */
  notify(request: NotificationRequest): void;
  /**
   * Desktop window chrome (Phase 21). Null on any platform that does not own
   * its window — the Activity lives inside Discord's frame and the web build
   * inside a browser tab, and neither may draw a title bar. The renderer keys
   * off null to render no chrome at all, rather than rendering dead controls.
   */
  getWindowState(): Promise<WindowState | null>;
  /** Subscribe to window state changes. No-op (returns a no-op) off desktop. */
  onWindowState(callback: (state: WindowState) => void): () => void;
}

/** Safe default: plain browser (dev tab) — everything is a no-op. */
export const webBridge: PlatformBridge = {
  kind: 'web',
  getAppInfo: () => Promise.resolve(null),
  updatePresence: () => {},
  log: (level, message) => {
    if (level === 'error') {
      console.error(`[nightwatch] ${message}`);
    }
  },
  getFixedRoomCode: () => Promise.resolve(null),
  getPlatformIdentity: () => Promise.resolve(null),
  // A browser tab does not own its window chrome.
  getWindowState: () => Promise.resolve(null),
  onWindowState: () => () => {},
  notify: (request) => {
    // Never prompt for permission on our own initiative; only use it if the
    // user has already granted it to this origin.
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(request.title, { body: request.body });
    }
  },
};

let currentBridge: PlatformBridge = webBridge;

export function setPlatformBridge(bridge: PlatformBridge): void {
  currentBridge = bridge;
}

export function getPlatformBridge(): PlatformBridge {
  return currentBridge;
}
