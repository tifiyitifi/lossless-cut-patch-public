import { createContext, useContext } from 'react';

import type { PatchFileOperation } from '../../../../../common/features/patchData/fileOperations';

/**
 * Patch UI state owned by the app shell (`PatchApp`): which dockview panel is focused, how to focus
 * one, whether the `V` view-candidates overlay is open, and whether a parameterised file operation
 * is waiting for its parameters.
 */
export interface PatchUiValue {
  focusedPanelId: string | undefined;
  focusPanel: (id: string) => void;
  viewOverlayOpen: boolean;
  openViewOverlay: () => void;
  closeViewOverlay: () => void;
  /** File operation waiting for parameters, if any. */
  fileOperation: PatchFileOperation | undefined;
  openFileOperation: (operation: PatchFileOperation) => void;
  closeFileOperation: () => void;
}

export const PatchUiContext = createContext<PatchUiValue | undefined>(undefined);

export function usePatchUi(): PatchUiValue {
  const value = useContext(PatchUiContext);
  if (value == null) throw new Error('usePatchUi must be used inside PatchApp');
  return value;
}
