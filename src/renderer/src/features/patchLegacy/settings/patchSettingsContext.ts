import { createContext, useContext } from 'react';

import type { PatchAction, PatchKeyBinding } from '../../../../../common/features/patchData/keymap';
import type { PatchSettings } from '../../../../../common/features/patchData/settings';

/** Same surface as `usePatchSettings`, but shared by the whole patch UI. */
export interface PatchSettingsValue {
  settings: PatchSettings;
  update: (patch: Partial<PatchSettings>) => void;
  /** Effective key bindings (custom over defaults). */
  keyBindings: PatchKeyBinding[];
  setKeyBinding: (action: PatchAction, key: string, shift: boolean | undefined) => void;
  resetKeyBindings: () => void;
}

/**
 * `usePatchSettings` keeps its state per component, so two callers would each hold their own copy:
 * the work-dir panel could write a new directory that the session never saw (the video list would
 * not rescan until a restart). One provider instance keeps every consumer in sync.
 */
export const PatchSettingsContext = createContext<PatchSettingsValue | undefined>(undefined);

export function usePatchSettingsContext(): PatchSettingsValue {
  const value = useContext(PatchSettingsContext);
  if (value == null) throw new Error('usePatchSettingsContext must be used inside PatchSettingsProvider');
  return value;
}
