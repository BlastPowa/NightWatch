import {
  commsFail,
  commsFailFromRpc,
  commsOk,
  type CommsOutcome,
} from '@shared/roomComms';
import {
  buildInviteTokenLink,
  isInviteToken,
  parseInviteTokenLink,
} from '@shared/inviteToken';
import { isValidRoomCode, normalizeRoomCode } from '@shared/room';
import { reportOperation } from '@/lib/platform/RuntimeCapabilityService';
import { supabase } from '@/lib/supabase';

/**
 * Phase 35 — opaque, single-use room invites (migration 0029).
 *
 * The rule this preserves: a room code never travels through presence, a
 * Discord payload, or any third-party surface. A token does instead, and a
 * token is worthless once used, once expired, or once revoked.
 */

// Re-exported so renderer callers have one import site, while the Electron
// main process imports the pure helpers directly (it cannot pull in Supabase).
export { buildInviteTokenLink, isInviteToken, parseInviteTokenLink };

export interface RoomInviteToken {
  token: string;
  /** ISO timestamp. */
  expiresAt: string;
}

/**
 * Mint an invite for a room the caller is currently in. TTL is clamped
 * server-side to 60–3600 seconds.
 */
export async function mintRoomInvite(
  roomCode: string,
  ttlSeconds = 900,
): Promise<CommsOutcome<RoomInviteToken>> {
  const code = normalizeRoomCode(roomCode);
  if (!isValidRoomCode(code)) {
    reportOperation('room.invite-mint', 'failed');
    return commsFail('forbidden', 'That is not a valid room.');
  }

  const { data, error } = await supabase.rpc('mint_room_invite_token', {
    p_room_code: code,
    p_ttl_seconds: ttlSeconds,
  });
  if (error !== null) {
    reportOperation('room.invite-mint', 'failed');
    return commsFailFromRpc(error);
  }

  // The RPC returns a single-row table.
  const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  const token = row?.['token'];
  const expiresAt = row?.['expires_at'];
  if (!isInviteToken(token) || typeof expiresAt !== 'string') {
    reportOperation('room.invite-mint', 'failed');
    return commsFail('server-error', 'The invite could not be created.');
  }

  reportOperation('room.invite-mint', 'success');
  return commsOk({ token, expiresAt });
}

/**
 * Redeem an invite and receive the room code. Single-use: a second attempt,
 * an expired token, a revoked token, and an unknown token are deliberately
 * indistinguishable, so a redeemer cannot probe which tokens exist.
 */
export async function redeemRoomInvite(token: string): Promise<CommsOutcome<string>> {
  if (!isInviteToken(token)) {
    reportOperation('room.invite-redeem', 'failed');
    return commsFail('forbidden', 'That invite link is not valid.');
  }

  const { data, error } = await supabase.rpc('redeem_room_invite_token', {
    p_token: token,
  });
  if (error !== null) {
    const failure = commsFailFromRpc(error);
    const code = failure.ok ? 'failed' : failure.code;
    reportOperation('room.invite-redeem', code === 'blocked' ? 'blocked' : 'forbidden');
    // The server answers "forbidden" identically for spent/expired/revoked/
    // unknown so tokens cannot be probed. Say that in one honest sentence
    // rather than guessing which of the four it was.
    if (!failure.ok && failure.code === 'forbidden') {
      return commsFail(
        'forbidden',
        'This invite has already been used or has expired. Ask for a new one.',
      );
    }
    return failure;
  }

  if (typeof data !== 'string' || !isValidRoomCode(data)) {
    reportOperation('room.invite-redeem', 'failed');
    return commsFail('server-error', 'The invite could not be opened.');
  }

  reportOperation('room.invite-redeem', 'success');
  return commsOk(data);
}

/** Kill an outstanding invite the caller issued. Silent when it does not apply. */
export async function revokeRoomInvite(token: string): Promise<CommsOutcome<void>> {
  if (!isInviteToken(token)) {
    return commsOk(undefined);
  }
  const { error } = await supabase.rpc('revoke_room_invite_token', { p_token: token });
  if (error !== null) {
    return commsFailFromRpc(error);
  }
  reportOperation('room.invite-revoke', 'success');
  return commsOk(undefined);
}
