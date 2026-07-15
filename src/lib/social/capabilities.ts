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
  /** Notification bell (0013). */
  notifications: boolean;
  /** Public club directory (0015). Separate from creatorClubs on purpose: a
   *  deployment can have clubs without the directory, and the directory is the
   *  surface that carries moderation risk. */
  clubDiscovery: boolean;
  /** Highlight reels (0016). Room owners only, and only where insights are on. */
  highlights: boolean;
  /** Playable friend media presence (0021). Gates the Browse "watch with a
   *  friend" shelf: false until the migration is deployed. */
  friendMediaPresence: boolean;
}

const NONE: SocialCapabilities = {
  friends: false,
  messaging: false,
  momentNotes: false,
  creatorClubs: false,
  notifications: false,
  clubDiscovery: false,
  highlights: false,
  friendMediaPresence: false,
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

  const [
    friends,
    messaging,
    momentNotes,
    creatorClubs,
    notifications,
    clubDiscovery,
    highlights,
    friendMediaPresence,
  ] = await Promise.all([
    probe('get_social_graph', {}),
    probe('list_conversations', {}),
    probe('list_moment_notes', { p_video_id: 'AAAAAAAAAAA' }),
    probe('list_my_clubs', {}),
    probe('count_unread_notifications', {}),
    probe('search_clubs', { p_query: '', p_limit: 1 }),
    // Probed with a nil session: the function rejects it, but a 'forbidden'
    // proves it is deployed. Only 42883/42P01 mean not-ready.
    probe('get_session_highlights', {
      p_session: '00000000-0000-0000-0000-000000000000',
      p_limit: 1,
    }),
    probe('get_friend_presence_v2', {}),
  ]);

  return {
    friends,
    messaging,
    momentNotes,
    creatorClubs,
    notifications,
    clubDiscovery,
    highlights,
    friendMediaPresence,
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
