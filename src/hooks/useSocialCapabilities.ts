import { useEffect, useState } from 'react';
import {
  getSocialCapabilities,
  resetSocialCapabilities,
  type SocialCapabilities,
} from '@/lib/social/capabilities';

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

export function useSocialCapabilities(enabled: boolean): SocialCapabilities {
  const [capabilities, setCapabilities] = useState<SocialCapabilities>(NONE);
  useEffect(() => {
    let active = true;
    if (!enabled) { setCapabilities(NONE); return () => { active = false; }; }
    const refresh = (): void => {
      resetSocialCapabilities();
      void getSocialCapabilities().then((result) => { if (active) setCapabilities(result); });
    };
    const resume = (): void => {
      if (document.visibilityState === 'visible') refresh();
    };
    refresh();
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', resume);
    return () => {
      active = false;
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [enabled]);
  return capabilities;
}
