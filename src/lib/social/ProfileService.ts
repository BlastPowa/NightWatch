import { ok, toFailure, type SocialResult } from '@/lib/social/types';
import { supabase } from '@/lib/supabase';

/**
 * Phase 20B: profile borders.
 *
 * The catalog is an allowlist (0006) and the server re-checks that a selected
 * border is actually unlocked — the client is never trusted with that, even
 * though the borders themselves are cosmetic.
 */

export interface ProfileBorder {
  id: string;
  label: string;
  unlocked: boolean;
  selected: boolean;
}

export async function listBorders(): Promise<SocialResult<ProfileBorder[]>> {
  const { data, error } = await supabase.rpc('list_borders');
  if (error !== null) {
    return toFailure(error);
  }
  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  return ok(
    rows
      .filter((row) => typeof row['id'] === 'string')
      .map((row) => ({
        id: String(row['id']),
        label: typeof row['label'] === 'string' ? row['label'] : String(row['id']),
        unlocked: row['unlocked'] === true,
        selected: row['selected'] === true,
      })),
  );
}

/**
 * Mirror a locally-earned achievement's border into the cloud. Safe to call
 * repeatedly; the server rejects borders whose achievement is not recorded.
 */
export async function unlockBorder(borderId: string): Promise<SocialResult<void>> {
  const { error } = await supabase.rpc('unlock_border', { p_border: borderId });
  return error === null ? ok(undefined) : toFailure(error);
}

export async function selectBorder(borderId: string): Promise<SocialResult<void>> {
  const { error } = await supabase.rpc('select_border', { p_border: borderId });
  return error === null ? ok(undefined) : toFailure(error);
}
