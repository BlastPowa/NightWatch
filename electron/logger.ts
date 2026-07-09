import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { LogLevel } from '@shared/ipc';

const MAX_LOG_BYTES = 512 * 1024;

/**
 * Minimal local file logger: userData/logs/nightwatch.log, rotated once to
 * .old when it exceeds MAX_LOG_BYTES. No telemetry — the file never leaves
 * the user's machine.
 */
class Logger {
  private logPath: string | null = null;

  public init(): void {
    try {
      const dir = path.join(app.getPath('userData'), 'logs');
      fs.mkdirSync(dir, { recursive: true });
      this.logPath = path.join(dir, 'nightwatch.log');
    } catch {
      this.logPath = null;
    }
  }

  public write(level: LogLevel, source: 'main' | 'renderer', message: string): void {
    const line = `${new Date().toISOString()} [${level.toUpperCase()}] [${source}] ${message}\n`;
    if (level === 'error') {
      console.error(line.trimEnd());
    }
    if (this.logPath === null) {
      return;
    }
    try {
      this.rotateIfNeeded();
      fs.appendFileSync(this.logPath, line);
    } catch {
      // Logging must never crash the app.
    }
  }

  private rotateIfNeeded(): void {
    if (this.logPath === null) {
      return;
    }
    try {
      const stats = fs.statSync(this.logPath);
      if (stats.size > MAX_LOG_BYTES) {
        fs.renameSync(this.logPath, `${this.logPath}.old`);
      }
    } catch {
      // File may not exist yet — fine.
    }
  }
}

export const logger = new Logger();
