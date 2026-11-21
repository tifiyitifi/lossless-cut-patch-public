import type { ReactNode } from 'react';
import { useMemo } from 'react';

import usePatchSettings from '../usePatchSettings';
import { PatchSettingsContext } from './patchSettingsContext';
import type { PatchSettingsValue } from './patchSettingsContext';

/** Owns the single patch-settings instance for the whole app (see `patchSettingsContext`). */
export default function PatchSettingsProvider({ children }: { children: ReactNode }) {
  const { settings, update, keyBindings, setKeyBinding, resetKeyBindings } = usePatchSettings();

  const value = useMemo<PatchSettingsValue>(() => ({
    settings, update, keyBindings, setKeyBinding, resetKeyBindings,
  }), [keyBindings, resetKeyBindings, setKeyBinding, settings, update]);

  return <PatchSettingsContext.Provider value={value}>{children}</PatchSettingsContext.Provider>;
}
