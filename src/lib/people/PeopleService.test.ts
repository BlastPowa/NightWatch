import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));

import { getRoomPeople } from './PeopleService';

describe('PeopleService room validation', () => {
  beforeEach(() => mocks.rpc.mockReset());

  it('normalizes a valid room code before the RPC call', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await expect(getRoomPeople(' abcd34 ')).resolves.toEqual({ ok: true, value: [] });
    expect(mocks.rpc).toHaveBeenCalledWith('get_room_people', { p_room_code: 'ABCD34' });
  });

  it('rejects malformed room codes without contacting Supabase', async () => {
    await expect(getRoomPeople('bad')).resolves.toEqual({
      ok: false,
      code: 'forbidden',
      message: 'That room code is not valid.',
      retryable: false,
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
