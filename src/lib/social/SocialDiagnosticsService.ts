import { getRuntimeCapabilityManifest } from '@/lib/runtime/RuntimeCapabilityService';
import { supabase } from '@/lib/supabase';

export type SocialDiagnosis =
  | { status: 'ready' }
  | { status: 'account-required' }
  | { status: 'deployment-missing'; missing: string[] }
  | { status: 'offline' }
  | { status: 'error' };

const REQUIRED_SOCIAL_FUNCTIONS = [
  'get_social_graph',
  'send_friend_request',
  'search_people',
  'get_room_people',
  'list_conversations',
  'get_messages',
  'send_message',
  'create_direct_conversation',
  'create_group_conversation',
] as const;

/**
 * Explains packaged social failures without mutating user data. The Phase 34
 * manifest supersedes the legacy per-feature probes; v0.1.27 servers remain
 * supported through RuntimeCapabilityService's read-only fallback.
 */
export async function diagnoseSocial(): Promise<SocialDiagnosis> {
  const { data: auth } = await supabase.auth.getSession();
  if (auth.session === null) return { status: 'account-required' };

  const result = await getRuntimeCapabilityManifest();
  if (result.status === 'offline') return { status: 'offline' };
  if (result.status === 'deployment-missing') {
    return { status: 'deployment-missing', missing: ['runtime_capabilities_v2'] };
  }
  if (result.status !== 'ok') return { status: 'error' };
  if (!result.data.authenticated) return { status: 'account-required' };

  const missing = REQUIRED_SOCIAL_FUNCTIONS
    .filter((name) => result.data.functions[name] !== true)
    .sort();
  return missing.length === 0
    ? { status: 'ready' }
    : { status: 'deployment-missing', missing };
}
