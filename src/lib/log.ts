import type { LogLevel } from '@shared/ipc';

/** Renderer-side logging to the local file; no-op outside Electron. */
export function log(level: LogLevel, message: string): void {
  if (level === 'error') {
    console.error(`[nightwatch] ${message}`);
  }
  if (typeof window.nightwatch === 'undefined') {
    return;
  }
  window.nightwatch.log(level, message).catch(() => {});
}
