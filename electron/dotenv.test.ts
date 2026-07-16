import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadDotEnv } from './dotenv';

let workDir: string;
const TEST_KEYS = ['NW_TEST_A', 'NW_TEST_B', 'NW_TEST_QUOTED', 'NW_TEST_EXISTING'];

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 'nw-env-'));
  for (const key of TEST_KEYS) {
    delete process.env[key];
  }
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
  for (const key of TEST_KEYS) {
    delete process.env[key];
  }
});

async function load(content: string): Promise<void> {
  const file = path.join(workDir, '.env');
  await writeFile(file, content);
  loadDotEnv(file);
}

describe('loadDotEnv', () => {
  it('loads KEY=VALUE pairs, skipping comments and blanks', async () => {
    await load('# comment\n\nNW_TEST_A=hello\nNW_TEST_B=with=equals\n');
    expect(process.env['NW_TEST_A']).toBe('hello');
    expect(process.env['NW_TEST_B']).toBe('with=equals');
  });

  it('strips matching quotes', async () => {
    await load('NW_TEST_QUOTED="quoted value"\n');
    expect(process.env['NW_TEST_QUOTED']).toBe('quoted value');
  });

  it('never overrides a real environment variable', async () => {
    // CI and packaged builds set real env vars; a stale file must lose.
    process.env['NW_TEST_EXISTING'] = 'from-shell';
    await load('NW_TEST_EXISTING=from-file\n');
    expect(process.env['NW_TEST_EXISTING']).toBe('from-shell');
  });

  it('ignores malformed lines and empty values', async () => {
    await load('=nokey\nNW_TEST_A=\n123BAD=x\nNW_TEST_B=ok\n');
    expect(process.env['NW_TEST_A']).toBeUndefined();
    expect(process.env['NW_TEST_B']).toBe('ok');
  });

  it('is a silent no-op when the file does not exist', () => {
    expect(() => loadDotEnv(path.join(workDir, 'missing.env'))).not.toThrow();
  });
});
