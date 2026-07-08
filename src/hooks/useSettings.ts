import { useSyncExternalStore } from 'react';
import { settingsStore, type Settings } from '@/lib/settings';

/** Live view of the local settings store. */
export function useSettings(): Settings {
  return useSyncExternalStore(
    (onChange) => settingsStore.subscribe(onChange),
    () => settingsStore.get(),
  );
}
