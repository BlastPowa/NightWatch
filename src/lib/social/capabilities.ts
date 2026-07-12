import { supabase } from '@/lib/supabase';

/**
 * Phase 20B delivery gate. The frontend HIDES navigation whose capability is
 * false — it never shows a disabled shell — so every flag defaults false and
 * only flips true once the backing migration is actually deployed and the
 * caller is signed in.
 *
 * Probing is what makes this honest: we ask Postgres whether the RPC exists
 * rather than hard-coding a flag that lies when a migration has not been run.
 */
export interface SocialCapabilities {
  friends: boolean;
  messaging: boolean;
  momentNotes: boolean;
  creatorClubs: boolean;
}

const NONE: SocialCapabilities = {
  friends: false,
  messaging: false,
  momentNotes: false,
  creatorClubs: false,
};

let cached: SocialCapabilities = NONE;
let inFlight: Promise<SocialCapabilities> | null = null;

/** Does this RPC exist and accept us? 42883/42P01 = not deployed. */
async function probe(fn: string, args: Record<string, unknown>): Promise<boolean> {
  const { error } = await supabase.rpc(fn, args);
  if (error === null) {
    return true;
  }
  // 'unauthenticated' means the function exists — it ran and rejected us.
  return error.code !== '42883' && error.code !== '42P01';
}

async function detect(): Promise<SocialCapabilities> {
  const { data } = await supabase.auth.getSession();
  if (data.session === null) {
    // Every social surface requires an account. Nothing to show a guest.
    return NONE;
  }

  const [friends, messaging, momentNotes] = await Promise.all([
    probe('get_social_graph', {}),
    probe('list_conversations', {}),
    probe('list_moment_notes', { p_video_id: 'AAAAAAAAAAA' }),
  ]);

  return {
    friends,
    messaging,
    momentNotes,
    // Phase 20C is not built. It stays false until its migrations, RLS, RPCs,
    // moderation, and tests ship.
    creatorClubs: false,
  };
}

/** Cached after the first successful probe; safe to call from render paths. */
export async function getSocialCapabilities(): Promise<SocialCapabilities> {
  if (cached !== NONE) {
    return cached;
  }
  inFlight ??= detect()
    .then((capabilities) => {
      cached = capabilities;
      return capabilities;
    })
    .catch(() => NONE)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Re-probe after sign-in/sign-out changes what the user can reach. */
export function resetSocialCapabilities(): void {
  cached = NONE;
  inFlight = null;
}

export function getCachedCapabilities(): SocialCapabilities {
  return cached;
}
