import { describe, expect, it } from 'vitest';
import { socialCapabilitiesFromManifest } from '@/lib/social/capabilities';

describe('socialCapabilitiesFromManifest', () => {
  it('fails closed when the manifest is not authenticated', () => {
    expect(socialCapabilitiesFromManifest({ schemaGeneration: 34, authenticated: false, functions: {
      get_social_graph: true,
      send_friend_request: true,
    }, realtimeTables: [] }).friends).toBe(false);
  });

  it('enables only social surfaces backed by their complete function set', () => {
    const capabilities = socialCapabilitiesFromManifest({
      schemaGeneration: 34,
      authenticated: true,
      functions: {
        get_social_graph: true,
        send_friend_request: true,
        list_conversations: true,
        get_messages: true,
        send_message: true,
        get_friend_presence_v2: true,
      },
      realtimeTables: ['messages'],
    });

    expect(capabilities.friends).toBe(true);
    expect(capabilities.messaging).toBe(true);
    expect(capabilities.friendMediaPresence).toBe(true);
    expect(capabilities.creatorClubs).toBe(false);
  });
});
