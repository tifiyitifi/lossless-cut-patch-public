import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

/**
Patch-mode panel state (fork-owned).

`batchFilesListVisible` is only *read* by the upstream `App` (through a `// patch:` seam), so the
provider is mounted in the patch shell, outside `App`. Everything that *writes* it (the console,
the list's own hide button) lives inside `App` and consumes this context.
*/
export interface PatchConsoleContextType {
  /** Is the source file list (the upstream batch file list) shown? */
  batchFilesListVisible: boolean;
  setBatchFilesListVisible: (visible: boolean) => void;
  toggleBatchFilesList: () => void;
  commandConsoleVisible: boolean;
  setCommandConsoleVisible: (visible: boolean) => void;
  toggleCommandConsole: () => void;
  commandCustomSettingsVisible: boolean;
  toggleCommandCustomSettings: () => void;
  setCommandCustomSettingsVisible: (visible: boolean) => void;
  /** The `help` popup listing the console commands and the base commands. */
  commandHelpVisible: boolean;
  setCommandHelpVisible: (visible: boolean) => void;
}

const PatchConsoleContext = createContext<PatchConsoleContextType | undefined>(undefined);

export function PatchConsoleProvider({ children }: { children: ReactNode }) {
  const [batchFilesListVisible, setBatchFilesListVisible] = useState(true);
  const [commandConsoleVisible, setCommandConsoleVisible] = useState(false);
  const [commandCustomSettingsVisible, setCommandCustomSettingsVisible] = useState(false);
  const [commandHelpVisible, setCommandHelpVisible] = useState(false);

  const toggleBatchFilesList = useCallback(() => setBatchFilesListVisible((visible) => !visible), []);
  const toggleCommandConsole = useCallback(() => setCommandConsoleVisible((visible) => !visible), []);
  const toggleCommandCustomSettings = useCallback(() => setCommandCustomSettingsVisible((visible) => !visible), []);

  const value = useMemo<PatchConsoleContextType>(() => ({
    batchFilesListVisible,
    setBatchFilesListVisible,
    toggleBatchFilesList,
    commandConsoleVisible,
    setCommandConsoleVisible,
    toggleCommandConsole,
    commandCustomSettingsVisible,
    toggleCommandCustomSettings,
    setCommandCustomSettingsVisible,
    commandHelpVisible,
    setCommandHelpVisible,
  }), [batchFilesListVisible, commandConsoleVisible, commandCustomSettingsVisible, commandHelpVisible, toggleBatchFilesList, toggleCommandConsole, toggleCommandCustomSettings]);

  return <PatchConsoleContext.Provider value={value}>{children}</PatchConsoleContext.Provider>;
}

/**
Patch panel state. Returns `undefined` outside patch mode (base mode has no provider), which is
what the upstream seams check before touching any patch behavior.
*/
export function usePatchConsole() {
  return useContext(PatchConsoleContext);
}
