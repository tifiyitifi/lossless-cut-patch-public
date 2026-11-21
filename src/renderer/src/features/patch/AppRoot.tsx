import { useCallback, useEffect, useMemo, useState } from 'react';

import type { EntryMode } from '../../../../common/types';
import mainApi from '../../mainApi';
import PatchApp from './PatchApp';
import { EntryModeContext } from './entryModeContext';
import type { EntryModeContextValue } from './entryModeContext';

const remote = window.require('@electron/remote');
const { configStore } = remote.require('./index.js');
const { ipcRenderer } = window.require('electron');

function readInitialEntryMode(): EntryMode {
  try {
    return (configStore.get('entryMode')) ?? 'patch';
  } catch (err) {
    console.error('Failed to read entryMode', err);
    return 'patch';
  }
}

/**
Chooses between the untouched upstream UI (`App`, base mode) and the patch UI (`PatchApp`).
The entry mode is persisted in the shared config and can be switched at runtime.

The shell stays mounted and only receives `patchMode`, so switching modes keeps the session.

`playerMode` marks the separate player window (see `features/patchPlayer`): the same app, without
the cutting. `mergedMode` is its merged-result window (one file, no merge key), and `inspectMode`
is its check player (the file the detached-source check double-clicked).
*/
export default function AppRoot({ playerMode = false, mergedMode = false, inspectMode = false }: { playerMode?: boolean, mergedMode?: boolean, inspectMode?: boolean } = {}) {
  const [entryMode, setEntryModeState] = useState<EntryMode>(readInitialEntryMode);

  const setEntryMode = useCallback((mode: EntryMode) => {
    try {
      configStore.set('entryMode', mode);
    } catch (err) {
      console.error('Failed to save entryMode', err);
    }
    setEntryModeState(mode);
    // patch: the Tools > Repair menu exists in patch mode only, so the menu has to be rebuilt.
    mainApi.patchRefreshMenu().catch((err: unknown) => { console.error('Failed to rebuild the menu', err); });
  }, []);

  // The app-menu "Mode" menu switches between the two UIs from either one (base mode has no
  // in-app switch of its own).
  useEffect(() => {
    const onSetEntryMode = (_event: unknown, mode: unknown) => {
      if (mode === 'patch' || mode === 'base') setEntryMode(mode);
    };
    ipcRenderer.on('setEntryMode', onSetEntryMode);
    return () => { ipcRenderer.off('setEntryMode', onSetEntryMode); };
  }, [setEntryMode]);

  const value = useMemo<EntryModeContextValue>(() => ({ entryMode, setEntryMode }), [entryMode, setEntryMode]);

  return (
    <EntryModeContext.Provider value={value}>
      <PatchApp patchMode={entryMode === 'patch'} playerMode={playerMode} mergedMode={mergedMode} inspectMode={inspectMode} />
    </EntryModeContext.Provider>
  );
}
