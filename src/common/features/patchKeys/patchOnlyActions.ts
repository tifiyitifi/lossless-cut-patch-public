import type { KeyboardAction } from '../../types.js';

/**
Actions that only do something in patch mode (fork-owned).

Base mode runs the untouched upstream app: these flows are guarded to nothing there, so a key bound
to one of them would be a silent dead key. The list exists for two reasons:

- the shortcut settings mark such an action where it is bound;
- pressing one in base mode explains itself instead of doing nothing.

The guard each entry relies on is named next to it. The list is pinned by a test: adding or removing
an action here is a conscious decision, not a side effect of a rename elsewhere.
*/
export const patchModeOnlyActions: ReadonlySet<KeyboardAction> = new Set<KeyboardAction>([
  // `usePatchFinish.openFinish`: `if (!patchMode || playerMode || mergedMode) return`.
  'finish',
  'finishMerge',
  'finishCut',
  'finishKeepSource',
  // `useDiscardSource.open`: `if (!enabled ...) return`, where `enabled` needs `patchMode`.
  'discardSource',
  // `usePatchMergeName.request`: `if (!enabled || isWorking()) return`.
  'mergeCutResults',
  // `usePatchPlayerPlaylist` only hands out the playlist in the results windows.
  'playlistPrev',
  'playlistNext',
  'playlistFirst',
  'playlistLast',
  // `openPatchRenameDialog` returns early without a result to rename (base mode has none).
  'renameResultLabel',
  'renameResultFull',
  // The command console is only mounted in patch mode, so the action is a no-op by design.
  'togglePatchCommandConsole',
  // The app menu bar is hidden in patch mode; this toggles it (see features/patchTransport). Base
  // mode shows the bar and leaves Alt alone.
  'togglePatchMenuBar',
]);

export function isPatchModeOnlyAction(action: KeyboardAction) {
  return patchModeOnlyActions.has(action);
}
