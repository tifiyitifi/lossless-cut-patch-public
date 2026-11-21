import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';

import type { PracticePanelState } from './PracticePanel';

/**
Keyboard practice mode state (fork-owned).

Session-only on purpose: a practice mode that survived a restart would leave the next session
with keys that appear to do nothing, which is worse than having to switch it on again. The popup
frequency and the panel position *are* remembered, because they are preferences (see `Config`).

The session also holds which guide the user is currently "inside" and whether the notes panel is
open. Both are cleared when practice mode is switched off, so the next session starts with notes
again (and the reset needs no effect).
*/
export interface PatchPracticeContextType {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  toggle: () => void;
  /** The guide the user is inside; survives closing the panel, so notes are not repeated. */
  currentGuideId: string | undefined;
  setCurrentGuideId: Dispatch<SetStateAction<string | undefined>>;
  /** The notes panel, while it is open. */
  panel: PracticePanelState | undefined;
  setPanel: Dispatch<SetStateAction<PracticePanelState | undefined>>;
}

const PatchPracticeContext = createContext<PatchPracticeContextType | undefined>(undefined);

export function PatchPracticeProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(false);
  const [currentGuideId, setCurrentGuideId] = useState<string | undefined>();
  const [panel, setPanel] = useState<PracticePanelState | undefined>();

  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value);
    if (value) return;
    setCurrentGuideId(undefined);
    setPanel(undefined);
  }, []);

  const toggle = useCallback(() => setEnabled(!enabled), [enabled, setEnabled]);

  const value = useMemo<PatchPracticeContextType>(() => ({
    enabled,
    setEnabled,
    toggle,
    currentGuideId,
    setCurrentGuideId,
    panel,
    setPanel,
  }), [currentGuideId, enabled, panel, setEnabled, toggle]);

  return <PatchPracticeContext.Provider value={value}>{children}</PatchPracticeContext.Provider>;
}

/** Practice-mode state. Returns `undefined` outside patch mode (base mode has no provider). */
export function usePatchPractice() {
  return useContext(PatchPracticeContext);
}
