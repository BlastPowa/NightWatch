import { useEffect, useState } from 'react';
import { getSocialCapabilities, type SocialCapabilities } from '@/lib/social/capabilities';

const NONE: SocialCapabilities = {
  friends: false,
  messaging: false,
  momentNotes: false,
  creatorClubs: false,
  notifications: false,
  clubDiscovery: false,
  highlights: false,
};

export function useSocialCapabilities(enabled: boolean): SocialCapabilities {
  const [capabilities, setCapabilities] = useState<SocialCapabilities>(NONE);
  useEffect(() => {
    let active = true;
    if (!enabled) { setCapabilities(NONE); return () => { active = false; }; }
    void getSocialCapabilities().then((result) => { if (active) setCapabilities(result); });
    return () => { active = false; };
  }, [enabled]);
  return capabilities;
}
