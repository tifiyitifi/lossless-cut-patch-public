import { useCallback, useMemo, useState } from 'react';

import type { PatchAction } from '../../../../common/features/patchData/keymap';
import { mergePatchKeyBindings, setPatchKeyBinding } from '../../../../common/features/patchData/keymap';
import type { PatchSettings } from '../../../../common/features/patchData/settings';

import patchConfig from './patchConfigApi';

/**
 * Read/write patch-mode settings, backed by the dedicated patch config store.
 *
 * Owns the merged key bindings so the keyboard layer and the key-binding editor share one source:
 * `keyBindings` is the effective list (custom over defaults), `setKeyBinding` / `resetKeyBindings`
 * persist only the custom overrides.
 */
export default function usePatchSettings() {
  const [settings, setSettings] = useState<PatchSettings>(() => patchConfig.getPatchSettings());

  const update = useCallback((patch: Partial<PatchSettings>) => {
    for (const [key, value] of Object.entries(patch) as [keyof PatchSettings, PatchSettings[keyof PatchSettings]][]) {
      patchConfig.setPatchSetting(key, value);
    }
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const keyBindings = useMemo(() => mergePatchKeyBindings(settings.patchKeyBindings ?? []), [settings.patchKeyBindings]);

  const setKeyBinding = useCallback((action: PatchAction, key: string, shift: boolean | undefined) => {
    update({ patchKeyBindings: setPatchKeyBinding(settings.patchKeyBindings ?? [], action, key, shift) });
  }, [settings.patchKeyBindings, update]);

  const resetKeyBindings = useCallback(() => update({ patchKeyBindings: undefined }), [update]);

  return { settings, update, keyBindings, setKeyBinding, resetKeyBindings };
}
