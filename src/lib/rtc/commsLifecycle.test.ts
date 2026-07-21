import { describe, expect, it, vi } from 'vitest';
import { CommsLifecycle } from './CommsLifecycle';

function fakeSession() {
  return { end: vi.fn() };
}

describe('CommsLifecycle', () => {
  it('ends voice and share on room leave', () => {
    const lifecycle = new CommsLifecycle();
    const voice = fakeSession();
    const share = fakeSession();
    lifecycle.registerVoice(voice);
    lifecycle.registerShare(share);

    lifecycle.endAll('room-leave');

    expect(voice.end).toHaveBeenCalledWith('left');
    expect(share.end).toHaveBeenCalledWith('stopped');
    expect(lifecycle.activeCounts()).toEqual({ voice: 0, share: 0 });
  });

  it('host migration stops sharing but keeps the call alive', () => {
    const lifecycle = new CommsLifecycle();
    const voice = fakeSession();
    const share = fakeSession();
    lifecycle.registerVoice(voice);
    lifecycle.registerShare(share);

    lifecycle.endAll('host-migration');

    expect(share.end).toHaveBeenCalledWith('stopped');
    expect(voice.end).not.toHaveBeenCalled();
    expect(lifecycle.activeCounts()).toEqual({ voice: 1, share: 0 });
  });

  it('sign-out records the signed-out reason on every session', () => {
    const lifecycle = new CommsLifecycle();
    const voice = fakeSession();
    lifecycle.registerVoice(voice);

    lifecycle.endAll('signed-out');

    expect(voice.end).toHaveBeenCalledWith('signed-out');
  });

  it('window close records window-closed', () => {
    const lifecycle = new CommsLifecycle();
    const share = fakeSession();
    lifecycle.registerShare(share);

    lifecycle.endAll('window-closed');

    expect(share.end).toHaveBeenCalledWith('window-closed');
  });

  it('unregistering prevents a stale session from being ended twice', () => {
    const lifecycle = new CommsLifecycle();
    const voice = fakeSession();
    const unregister = lifecycle.registerVoice(voice);

    unregister();
    lifecycle.endAll('room-leave');

    expect(voice.end).not.toHaveBeenCalled();
  });

  it('pagehide tears everything down through the attached hook', () => {
    const listeners = new Map<string, () => void>();
    const target = {
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    };
    const lifecycle = new CommsLifecycle();
    const voice = fakeSession();
    lifecycle.registerVoice(voice);
    lifecycle.attachWindowHooks(target);

    listeners.get('pagehide')?.();

    expect(voice.end).toHaveBeenCalledWith('window-closed');

    lifecycle.detachWindowHooks();
    expect(listeners.has('pagehide')).toBe(false);
  });

  it('attaching twice does not double-register the hook', () => {
    const addEventListener = vi.fn();
    const lifecycle = new CommsLifecycle();
    const target = { addEventListener, removeEventListener: vi.fn() };
    lifecycle.attachWindowHooks(target);
    lifecycle.attachWindowHooks(target);
    expect(addEventListener).toHaveBeenCalledTimes(1);
  });
});
