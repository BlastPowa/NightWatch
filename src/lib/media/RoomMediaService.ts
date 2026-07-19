import {
  commsFail,
  commsFailFromRpc,
  commsOk,
  parseFileWatchReadinessEntry,
  parseRoomMediaSnapshot,
  type CommsOutcome,
  type FileWatchReadiness,
  type FileWatchReadinessEntry,
  type RoomMediaMode,
  type RoomMediaSnapshot,
} from '@shared/roomComms';
import { supabase } from '@/lib/supabase';

type RpcRow = Record<string, unknown>;

function firstRow(data: unknown): RpcRow | null {
  const value = Array.isArray(data) ? data[0] : data;
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as RpcRow)
    : null;
}

function normalizeSnapshot(data: unknown): RoomMediaSnapshot | null {
  const row = firstRow(data);
  if (row === null) {
    return null;
  }
  return parseRoomMediaSnapshot({
    revision: row['revision'],
    controllerId: row['controller_id'],
    mode: row['mode'],
    updatedAt: row['updated_at'],
  });
}

export async function publishRoomMediaDescriptor(
  roomCode: string,
  expectedRevision: number | null,
  mode: RoomMediaMode,
): Promise<CommsOutcome<RoomMediaSnapshot>> {
  const { data, error } = await supabase.rpc('publish_room_media_descriptor', {
    p_room_code: roomCode,
    p_expected_revision: expectedRevision,
    p_mode: mode,
  });
  if (error !== null) {
    if ((error.message ?? '').includes('revision-conflict')) {
      return commsFail('server-error', 'Room media changed on another client. Refresh and retry.');
    }
    return commsFailFromRpc(error);
  }
  const snapshot = normalizeSnapshot(data);
  return snapshot === null
    ? commsFail('server-error', 'The room returned malformed media state.')
    : commsOk(snapshot);
}

export async function getRoomMediaDescriptor(
  roomCode: string,
): Promise<CommsOutcome<RoomMediaSnapshot | null>> {
  const { data, error } = await supabase.rpc('get_room_media_descriptor', {
    p_room_code: roomCode,
  });
  if (error !== null) {
    return commsFailFromRpc(error);
  }
  if (!Array.isArray(data) || data.length === 0) {
    return commsOk(null);
  }
  const snapshot = normalizeSnapshot(data);
  return snapshot === null
    ? commsFail('server-error', 'The room returned malformed media state.')
    : commsOk(snapshot);
}

export async function reportMediaReadiness(
  roomCode: string,
  revision: number,
  readiness: FileWatchReadiness,
): Promise<CommsOutcome<void>> {
  const { error } = await supabase.rpc('report_media_readiness', {
    p_room_code: roomCode,
    p_revision: revision,
    p_readiness: readiness,
  });
  return error === null ? commsOk(undefined) : commsFailFromRpc(error);
}

export async function getMediaReadinessRoster(
  roomCode: string,
  revision: number,
): Promise<CommsOutcome<FileWatchReadinessEntry[]>> {
  const { data, error } = await supabase.rpc('get_media_readiness_roster', {
    p_room_code: roomCode,
    p_revision: revision,
  });
  if (error !== null) {
    return commsFailFromRpc(error);
  }
  if (!Array.isArray(data)) {
    return commsFail('server-error', 'The room returned a malformed readiness roster.');
  }
  const entries = data.map((value) => {
    const row = value as RpcRow;
    return parseFileWatchReadinessEntry({
      userId: row['user_id'],
      displayName: row['display_name'],
      avatarUrl: row['avatar_url'] ?? null,
      border: row['border'] ?? null,
      readiness: row['readiness'],
      updatedAt: row['updated_at'] ?? null,
    });
  });
  return entries.some((entry) => entry === null)
    ? commsFail('server-error', 'The room returned a malformed readiness roster.')
    : commsOk(entries as FileWatchReadinessEntry[]);
}
