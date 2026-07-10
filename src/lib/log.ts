import type { LogLevel } from '@shared/ipc';
import { getPlatformBridge } from '@/platform/PlatformBridge';

/** Logging routed through the platform bridge (file on Electron). */
export function log(level: LogLevel, message: string): void {
  getPlatformBridge().log(level, message);
}
