import { describe, expect, it } from 'vitest';
import {
  buildSmokeReport,
  formatSmokeReport,
  smokeExitCode,
  summarizeSmoke,
} from './releaseSmoke';

describe('summarizeSmoke', () => {
  it('fails on any failure, warns on any warning, otherwise passes', () => {
    expect(summarizeSmoke([{ id: 'config.supabase-url', status: 'pass' }])).toBe('pass');
    expect(
      summarizeSmoke([
        { id: 'config.supabase-url', status: 'pass' },
        { id: 'relay.turn-configured', status: 'warn' },
      ]),
    ).toBe('warn');
    expect(
      summarizeSmoke([
        { id: 'relay.turn-configured', status: 'warn' },
        { id: 'auth.session-restored', status: 'fail' },
      ]),
    ).toBe('fail');
  });

  it('skipped checks never change the verdict', () => {
    expect(
      summarizeSmoke([
        { id: 'config.supabase-url', status: 'pass' },
        { id: 'platform.media-bridge', status: 'skipped' },
      ]),
    ).toBe('pass');
  });

  it('an empty run passes rather than inventing a failure', () => {
    expect(summarizeSmoke([])).toBe('pass');
  });
});

describe('smokeExitCode', () => {
  it('only a failing verdict is non-zero', () => {
    const base = { reportVersion: 1 as const, appVersion: '0.1.27', packaged: true, checks: [] };
    expect(smokeExitCode({ ...base, verdict: 'pass' })).toBe(0);
    expect(smokeExitCode({ ...base, verdict: 'warn' })).toBe(0);
    expect(smokeExitCode({ ...base, verdict: 'fail' })).toBe(1);
  });
});

describe('buildSmokeReport', () => {
  it('drops unknown check ids to keep the vocabulary closed', () => {
    const report = buildSmokeReport('0.1.27', true, [
      { id: 'config.supabase-url', status: 'pass' },
      { id: 'secret.token=abc123', status: 'pass' },
    ]);
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0]?.id).toBe('config.supabase-url');
  });

  it('bounds the version string', () => {
    expect(buildSmokeReport('x'.repeat(100), false, []).appVersion).toHaveLength(32);
  });

  it('derives the verdict from the retained checks', () => {
    const report = buildSmokeReport('0.1.27', true, [
      { id: 'auth.session-restored', status: 'fail' },
    ]);
    expect(report.verdict).toBe('fail');
  });
});

describe('formatSmokeReport', () => {
  it('emits fixed-vocabulary lines with no free text', () => {
    const report = buildSmokeReport('0.1.27', true, [
      { id: 'config.supabase-url', status: 'pass' },
      { id: 'relay.turn-configured', status: 'warn' },
    ]);
    const text = formatSmokeReport(report);
    expect(text).toContain('nightwatch-smoke version=0.1.27 packaged=true');
    expect(text).toContain('  config.supabase-url=pass');
    expect(text).toContain('  relay.turn-configured=warn');
    expect(text).toContain('verdict=warn');
  });
});
