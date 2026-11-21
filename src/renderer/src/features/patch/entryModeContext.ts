import { createContext, useContext } from 'react';

import type { EntryMode } from '../../../../common/types';

export interface EntryModeContextValue {
  entryMode: EntryMode;
  setEntryMode: (mode: EntryMode) => void;
}

export const EntryModeContext = createContext<EntryModeContextValue | undefined>(undefined);

export function useEntryMode(): EntryModeContextValue {
  const value = useContext(EntryModeContext);
  if (value == null) throw new Error('useEntryMode must be used inside AppRoot');
  return value;
}
