/**
 * Minimal .env loader for the Electron MAIN process.
 *
 * Vite injects only VITE_-prefixed values, and only into bundled code at build
 * time. The Phase 29 media capabilities (NIGHTWATCH_*) are read from
 * process.env at runtime in main, so in development they need to come from the
 * repo's .env file without requiring the user to export them in every shell.
 *
 * Deliberately tiny and forgiving: KEY=VALUE lines, # comments, optional
 * single/double quotes around the value. Existing process.env values always
 * win, so CI and packaged builds that set real environment variables are
 * never overridden by a stale file.
 */

import fs from 'node:fs';

export function loadDotEnv(filePath: string): void {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return; // No .env is a normal state (fresh clone, packaged app).
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) {
      continue;
    }
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value.length > 0) {
      process.env[key] = value;
    }
  }
}
