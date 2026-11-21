import { patchExportLockedActions, shouldBlockPatchExportAction } from '../../../../common/features/patchExportLock';
import type { KeyboardAction } from '../../../../common/types';

/**
Wrap the app's action map so the export locks are enforced in one place (fork-owned).

`mainActions` is dispatched from three directions - the keyboard hook, the IPC/menu router and
the patch command console - so a guard on one of them would be bypassed by the other two. Only
the locked entries are replaced; everything else keeps its identity (the console builds its
command list from the keys, and the keyboard hook stores the map in a ref).

The check runs when the action is invoked, not when the map is built: an export may start long
after this wrapper was created.
*/
export default function guardPatchExportActions({ actions, isBlocked, onBlocked }: {
  actions: Record<string, () => void>;
  /** True while the cut list must not change (an export runs and was not force-unlocked). */
  isBlocked: () => boolean;
  onBlocked: (action: KeyboardAction) => void;
}): Record<string, () => void> {
  const locked = new Set<string>(patchExportLockedActions);

  return Object.fromEntries(Object.entries(actions).map(([name, run]) => {
    if (!locked.has(name)) return [name, run] as const;
    return [name, () => {
      if (shouldBlockPatchExportAction({ action: name as KeyboardAction, exporting: isBlocked() })) {
        onBlocked(name as KeyboardAction);
        return;
      }
      run();
    }] as const;
  }));
}
