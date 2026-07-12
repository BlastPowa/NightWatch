import { isReactionEmoji } from '@shared/reactions';
import { ok, toFailure, type SocialResult } from '@/lib/social/types';
import { supabase } from '@/lib/supabase';

/**
 * Phase 20B: timestamped notes pinned to a moment in a video.
 *
 * Visibility is enforced server-side (0007): private is author-only, friends
 * means accepted friends minus blocks, and room requires an actual
 * relationship with that persistent room. The server clamps the timestamp to a
 * non-negative finite value; only the client knows the video's duration, so it
 * clamps against that too.
 */

export type MomentVisibility = 'private' | 'friends' | 'room';

export interface MomentNote {
  id: string;
  authorId: string;
  displayName: string;
  positionSeconds: number;
  visibility: MomentVisibility;
  body: string;
  emoji: string | null;
  createdAt: string;
  updatedAt: string;
}

export const MAX_MOMENT_BODY = 500;

function toVisibility(value: unknown): MomentVisibility {
  return value === 'friends' || value === 'room' ? value : 'private';
}

/**
 * The server cannot know how long a video is, so it can only clamp the lower
 * bound. Anything past the end is meaningless, so clamp it here.
 */
export function clampPosition(seconds: number, durationSeconds: number | null): number {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return 0;
  }
  const floored = Math.floor(seconds);
  if (durationSeconds !== null && Number.isFinite(durationSeconds) && durationSeconds > 0) {
    return Math.min(floored, Math.floor(durationSeconds));
  }
  return floored;
}

export async function listMomentNotes(
  videoId: string,
  roomCode: string | null = null,
  before: string | null = null,
  limit = 50,
): Promise<SocialResult<MomentNote[]>> {
  const { data, error } = await supabase.rpc('list_moment_notes', {
    p_video_id: videoId,
    p_room_code: roomCode,
    p_before: before,
    p_limit: limit,
  });
  if (error !== null) {
    return toFailure(error);
  }
  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  return ok(
    rows
      .filter((row) => typeof row['id'] === 'string')
      .map((row) => ({
        id: String(row['id']),
        authorId: String(row['author_id'] ?? ''),
        displayName: typeof row['display_name'] === 'string' ? row['display_name'] : 'Someone',
        positionSeconds: Number(row['position_seconds'] ?? 0),
        visibility: toVisibility(row['visibility']),
        body: typeof row['body'] === 'string' ? row['body'] : '',
        emoji: typeof row['emoji'] === 'string' ? row['emoji'] : null,
        createdAt: String(row['created_at'] ?? ''),
        updatedAt: String(row['updated_at'] ?? ''),
      })),
  );
}

export async function createMomentNote(input: {
  videoId: string;
  positionSeconds: number;
  durationSeconds?: number | null;
  visibility: MomentVisibility;
  body?: string;
  emoji?: string | null;
  roomCode?: string | null;
}): Promise<SocialResult<string>> {
  const body = (input.body ?? '').slice(0, MAX_MOMENT_BODY);
  const emoji = input.emoji ?? null;

  // The database has the same allowlist; rejecting here saves a round trip and
  // keeps the palette identical to the one reactions already use.
  if (emoji !== null && !isReactionEmoji(emoji)) {
    return { status: 'forbidden' };
  }
  if (body.length === 0 && emoji === null) {
    return { status: 'forbidden' };
  }
  if (input.visibility === 'room' && (input.roomCode ?? null) === null) {
    return { status: 'forbidden' };
  }

  const { data, error } = await supabase.rpc('create_moment_note', {
    p_video_id: input.videoId,
    p_position_seconds: clampPosition(input.positionSeconds, input.durationSeconds ?? null),
    p_visibility: input.visibility,
    p_body: body,
    p_emoji: emoji,
    p_room_code: input.roomCode ?? null,
  });
  if (error !== null) {
    return toFailure(error);
  }
  return typeof data === 'string' ? ok(data) : { status: 'error' };
}

export async function editMomentNote(
  noteId: string,
  body: string,
  emoji: string | null = null,
): Promise<SocialResult<void>> {
  if (emoji !== null && !isReactionEmoji(emoji)) {
    return { status: 'forbidden' };
  }
  const { error } = await supabase.rpc('edit_moment_note', {
    p_note: noteId,
    p_body: body.slice(0, MAX_MOMENT_BODY),
    p_emoji: emoji,
  });
  return error === null ? ok(undefined) : toFailure(error);
}

export async function deleteMomentNote(noteId: string): Promise<SocialResult<void>> {
  const { error } = await supabase.rpc('delete_moment_note', { p_note: noteId });
  return error === null ? ok(undefined) : toFailure(error);
}
