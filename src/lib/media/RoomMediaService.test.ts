import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));

import {
  getMediaReadinessRoster,
  getRoomMediaDescriptor,
  publishRoomMediaDescriptor,
  reportMediaReadiness,
} from './RoomMediaService';

const mode = {
  modeVersion: 2 as const,
  mode: 'youtube' as const,
  descriptor: { schemaVersion: 1 as const, kind: 'youtube' as const, videoId: 'dQw4w9WgXcQ' },
};

describe('RoomMediaService', () => {
  beforeEach(() => mocks.rpc.mockReset());

  it('normalizes a published snapshot', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{
        revision: 2,
        controller_id: 'user-1',
        mode,
        updated_at: '2026-07-19T12:00:00.000Z',
      }],
      error: null,
    });
    const result = await publishRoomMediaDescriptor('ABC123', 1, mode);
    expect(result.ok && result.value.revision).toBe(2);
    expect(mocks.rpc).toHaveBeenCalledWith('publish_room_media_descriptor', {
      p_room_code: 'ABC123', p_expected_revision: 1, p_mode: mode,
    });
  });

  it('returns null when a room has no persisted media state', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    expect(await getRoomMediaDescriptor('ABC123')).toEqual({ ok: true, value: null });
  });

  it('rejects malformed server state', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ revision: 0 }], error: null });
    const result = await getRoomMediaDescriptor('ABC123');
    expect(!result.ok && result.code).toBe('server-error');
  });

  it('reports readiness and normalizes a roster', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: [{
          user_id: 'user-1', display_name: 'Viewer', avatar_url: null,
          border: null, readiness: 'ready', updated_at: '2026-07-19T12:00:00.000Z',
        }],
        error: null,
      });
    expect((await reportMediaReadiness('ABC123', 2, 'ready')).ok).toBe(true);
    const roster = await getMediaReadinessRoster('ABC123', 2);
    expect(roster.ok && roster.value[0]?.displayName).toBe('Viewer');
  });
});
