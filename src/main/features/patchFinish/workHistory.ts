import Store from 'electron-store';

import { addWorkRoot, emptyPatchWorkHistory, parsePatchWorkHistory } from '../../../common/features/patchFinish/index.js';
import type { PatchWorkHistory } from '../../../common/features/patchFinish/index.js';

/**
The work roots the user has worked in (fork-owned).

A separate store (`patch-work-history.json`) so the list can grow to 1000 entries without
bloating the settings the renderer reads on every start. Entries are written whenever a work area
is ensured (see `patchEnsureWorkDirs`), which is exactly "this directory has a `.losslesscut_work`
folder".
*/

let store: Store | undefined;

function getStore(): Store {
  store ??= new Store({ name: 'patch-work-history', defaults: emptyPatchWorkHistory() });
  return store;
}

const caseInsensitivePaths = process.platform === 'win32' || process.platform === 'darwin';

export function getPatchWorkHistory(): PatchWorkHistory {
  return parsePatchWorkHistory(getStore().store);
}

export function recordPatchWorkRoot(root: string | undefined) {
  if (root == null) return;
  const history = addWorkRoot(getPatchWorkHistory(), root, Date.now(), { caseInsensitive: caseInsensitivePaths });
  getStore().store = history;
}
