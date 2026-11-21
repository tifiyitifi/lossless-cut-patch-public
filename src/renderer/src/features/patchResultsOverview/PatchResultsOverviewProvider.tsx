import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { patchLegacyDialogsEnabled } from '../patchWork/patchLegacyDialogsPolicy';
import { usePatchWork } from '../patchWork/PatchWorkProvider';

import ResultsOverviewDialog from './ResultsOverviewDialog';

const { ipcRenderer } = window.require('electron');

/** How a patch-mode surface opens the overview from the renderer (`undefined` outside patch mode). */
const PatchResultsOverviewContext = createContext<{ open: () => void } | undefined>(undefined);

/** The overview opener of the surrounding patch shell, or `undefined` in base mode. */
export function usePatchResultsOverview() {
  return useContext(PatchResultsOverviewContext);
}

/**
The frozen body of the results overview provider; only reached when the legacy dialogs are enabled
again (see `patchWork/patchLegacyDialogsPolicy`). Everything below is kept verbatim.

Both old entry points (the source window's context menu and the File menu) only send a channel;
the dialog is mounted here, inside `PatchWorkProvider`, so it can resolve the same work root the
rest of patch mode uses (the open file's root, or the configured working directory when no file is
open). The patch landing opened it through this context instead.
*/
function LegacyResultsOverviewProvider({ children }: { children: ReactNode }) {
  const patchWork = usePatchWork();
  const [visible, setVisible] = useState(false);

  const open = useCallback(() => setVisible(true), []);
  const contextValue = useMemo(() => ({ open }), [open]);

  useEffect(() => {
    const onOpen = () => setVisible(true);
    ipcRenderer.on('openPatchResultsOverview', onOpen);
    return () => { ipcRenderer.off('openPatchResultsOverview', onOpen); };
  }, []);

  return (
    <PatchResultsOverviewContext.Provider value={contextValue}>
      {children}
      {visible && <ResultsOverviewDialog workRoot={patchWork?.effectiveRoot} onHide={() => setVisible(false)} />}
    </PatchResultsOverviewContext.Provider>
  );
}

/**
The results overview dialog (fork-owned, frozen).

The standalone dialog was replaced by the combined work-folders dialog (`patchWork`), which shows
the results of every work root under the root itself. It is not mounted while
`patchLegacyDialogsEnabled` is false; `PatchWorkProvider` listens to the same channel and opens the
combined dialog instead. See `patchWork/patchLegacyDialogsPolicy`.
*/
export function PatchResultsOverviewProvider({ children }: { children: ReactNode }) {
  if (!patchLegacyDialogsEnabled) return children;
  return <LegacyResultsOverviewProvider>{children}</LegacyResultsOverviewProvider>;
}
