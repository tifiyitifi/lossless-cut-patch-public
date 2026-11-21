import Store from 'electron-store';

import { migrateCutNameRule } from '../../../common/features/patchData/cutName.js';
import { defaultPatchSettings } from '../../../common/features/patchData/settings.js';
import type { PatchSettings } from '../../../common/features/patchData/settings.js';

/** Dedicated store for patch-mode settings (separate from the upstream `config.json`). */
let store: Store | undefined;

/**
Move settings that an older build wrote with an old default to the current default.

`electron-store` writes `defaults` into the file on the first start, so an install that never
edited the cut name rule already has the old default stored. Only that exact value is replaced
(see `migrateCutNameRule`); a rule the user typed stays as it is.
*/
function migrateStoredSettings(target: Store) {
  const storedRule = target.get('cutNameRule');
  const migratedRule = migrateCutNameRule(storedRule);
  if (migratedRule !== storedRule) target.set('cutNameRule', migratedRule);
}

function getStore(): Store {
  if (store == null) {
    store = new Store({ name: 'patch-config', defaults: defaultPatchSettings });
    migrateStoredSettings(store);
  }
  return store;
}

export function getPatchSettings(): PatchSettings {
  return { ...defaultPatchSettings, ...(getStore().store as Partial<PatchSettings>) };
}

export function getPatchSetting<K extends keyof PatchSettings>(key: K): PatchSettings[K] {
  return getPatchSettings()[key];
}

export function setPatchSetting<K extends keyof PatchSettings>(key: K, value: PatchSettings[K]): void {
  if (value === undefined) getStore().delete(key);
  else getStore().set(key as string, value);
}
