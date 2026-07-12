import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

interface MessageFilterModule {
  prepareOutgoingMessage(text: string, maxLength: number): string;
}

interface SettingsModule {
  settingsStore: { update(values: { chatFilterEnabled: boolean }): void };
}

let filterModule: MessageFilterModule;
let settingsModule: SettingsModule;

beforeAll(async () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  });
  filterModule = await import('@/lib/chat/messageFilter');
  settingsModule = await import('@/lib/settings');
});

afterAll(() => vi.unstubAllGlobals());

describe('prepareOutgoingMessage', () => {
  it('trims and caps outgoing text before transport', () => {
    settingsModule.settingsStore.update({ chatFilterEnabled: false });
    expect(filterModule.prepareOutgoingMessage('  hello  ', 4)).toBe('hell');
  });

  it('honours the sender profanity preference', () => {
    const text = 'this is shit';
    settingsModule.settingsStore.update({ chatFilterEnabled: false });
    expect(filterModule.prepareOutgoingMessage(text, 2_000)).toBe(text);
    settingsModule.settingsStore.update({ chatFilterEnabled: true });
    expect(filterModule.prepareOutgoingMessage(text, 2_000)).not.toContain('shit');
  });
});
