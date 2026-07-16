import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { maxMediaSizeBytes, resolveCapabilities } from './capabilities';

const FLAGS = [
  'NIGHTWATCH_ENABLE_LOCAL_FILES',
  'NIGHTWATCH_ENABLE_DRIVE',
  'NIGHTWATCH_ENABLE_LIBRARY',
  'NIGHTWATCH_GOOGLE_CLIENT_ID',
  'NIGHTWATCH_GOOGLE_PICKER_API_KEY',
  'NIGHTWATCH_GOOGLE_APP_ID',
  'NIGHTWATCH_MAX_MEDIA_BYTES',
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const flag of FLAGS) {
    saved[flag] = process.env[flag];
    delete process.env[flag];
  }
});

afterEach(() => {
  for (const flag of FLAGS) {
    const value = saved[flag];
    if (value === undefined) {
      delete process.env[flag];
    } else {
      process.env[flag] = value;
    }
  }
});

describe('defaults', () => {
  it('ships with every custom capability off', () => {
    // The Phase 29 gate: nothing is on until the owner turns it on.
    const capabilities = resolveCapabilities();
    expect(capabilities.localFiles).toBe(false);
    expect(capabilities.googleDrive).toBe(false);
    expect(capabilities.library).toBe(false);
    expect(capabilities.htmlMedia).toBe(false);
  });

  it('keeps YouTube on', () => {
    expect(resolveCapabilities().youtube).toBe(true);
  });

  it('advertises no protocol version when nothing can play', () => {
    // So a build with everything off is never counted as a ready participant.
    expect(resolveCapabilities().mediaProtocolVersions).toEqual([]);
  });
});

describe('local files', () => {
  it('turns on only for an exact "1"', () => {
    for (const value of ['0', 'true', 'yes', '', 'TRUE']) {
      process.env['NIGHTWATCH_ENABLE_LOCAL_FILES'] = value;
      expect(resolveCapabilities().localFiles).toBe(false);
    }
    process.env['NIGHTWATCH_ENABLE_LOCAL_FILES'] = '1';
    expect(resolveCapabilities().localFiles).toBe(true);
  });

  it('brings html media and a protocol version with it', () => {
    process.env['NIGHTWATCH_ENABLE_LOCAL_FILES'] = '1';
    const capabilities = resolveCapabilities();
    expect(capabilities.htmlMedia).toBe(true);
    expect(capabilities.mediaProtocolVersions).toEqual([1]);
    expect(capabilities.reasons.localFiles).toBe('available');
  });
});

describe('drive gating', () => {
  it('stays off by default and reports disabled-by-owner', () => {
    const capabilities = resolveCapabilities();
    expect(capabilities.googleDrive).toBe(false);
    expect(capabilities.reasons.googleDrive).toBe('disabled-by-owner');
  });

  it('reports not-configured when flagged on without the full OAuth config', () => {
    process.env['NIGHTWATCH_ENABLE_DRIVE'] = '1';
    // Client id alone is not enough: the Picker needs its key and app id too.
    process.env['NIGHTWATCH_GOOGLE_CLIENT_ID'] = 'test-client-id.apps.googleusercontent.com';
    const capabilities = resolveCapabilities();
    expect(capabilities.googleDrive).toBe(false);
    expect(capabilities.reasons.googleDrive).toBe('not-configured');
  });

  it('turns on only with the flag AND client id AND picker key AND app id', () => {
    process.env['NIGHTWATCH_ENABLE_DRIVE'] = '1';
    process.env['NIGHTWATCH_GOOGLE_CLIENT_ID'] = 'test-client-id.apps.googleusercontent.com';
    process.env['NIGHTWATCH_GOOGLE_PICKER_API_KEY'] = 'test-picker-key';
    process.env['NIGHTWATCH_GOOGLE_APP_ID'] = '123456789';
    const capabilities = resolveCapabilities();
    expect(capabilities.googleDrive).toBe(true);
    expect(capabilities.reasons.googleDrive).toBe('available');
    expect(capabilities.htmlMedia).toBe(true);
  });

  it('full config without the owner flag stays off', () => {
    // Configuration is not consent. Only the flag is.
    process.env['NIGHTWATCH_GOOGLE_CLIENT_ID'] = 'test-client-id.apps.googleusercontent.com';
    process.env['NIGHTWATCH_GOOGLE_PICKER_API_KEY'] = 'test-picker-key';
    process.env['NIGHTWATCH_GOOGLE_APP_ID'] = '123456789';
    const capabilities = resolveCapabilities();
    expect(capabilities.googleDrive).toBe(false);
    expect(capabilities.reasons.googleDrive).toBe('disabled-by-owner');
  });
});

describe('library', () => {
  it('reports deployment-required until the migration is deployed and the flag is set', () => {
    expect(resolveCapabilities().reasons.library).toBe('deployment-required');
    process.env['NIGHTWATCH_ENABLE_LIBRARY'] = '1';
    const capabilities = resolveCapabilities();
    expect(capabilities.library).toBe(true);
    expect(capabilities.reasons.library).toBe('available');
  });
});

describe('size ceiling', () => {
  it('defaults to 32 GiB', () => {
    expect(maxMediaSizeBytes()).toBe(32 * 1024 * 1024 * 1024);
  });

  it('accepts a valid owner override', () => {
    process.env['NIGHTWATCH_MAX_MEDIA_BYTES'] = '1048576';
    expect(maxMediaSizeBytes()).toBe(1_048_576);
  });

  it('ignores a nonsense override rather than trusting it', () => {
    for (const value of ['0', '-5', 'lots', '1.5', '']) {
      process.env['NIGHTWATCH_MAX_MEDIA_BYTES'] = value;
      expect(maxMediaSizeBytes()).toBe(32 * 1024 * 1024 * 1024);
    }
  });
});
