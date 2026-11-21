import { useEffect } from 'react';

import type { NormalizedPatchKey, PatchAction, PatchKeyBinding } from '../../../../../common/features/patchData';
import { defaultPatchKeyBindings, getPatchActionForKey, normalizePatchKeyEvent, patchPreventDefaultActions } from '../../../../../common/features/patchData';

export type PatchKeyHandlers = Partial<Record<PatchAction, () => void>>;

/**
 * Patch-mode keyboard handling.
 *
 * Only the "global" layer for now (input > global > panel). Key resolution is done by the pure
 * keymap in `common/features/patchData/keymap`. Events are ignored while an input/textarea or
 * contentEditable element is focused, and while Ctrl/Meta/Alt are held.
 */
export default function usePatchKeyboard({ bindings = defaultPatchKeyBindings, handlers }: {
  bindings?: readonly PatchKeyBinding[],
  handlers: PatchKeyHandlers,
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { target } = event;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (target instanceof HTMLElement && target.isContentEditable) return;
      // A focused button owns Space/Enter (so the panel's buttons are keyboard-operable); every other
      // patch shortcut keeps working, so marking/cutting never stops working.
      if (target instanceof HTMLButtonElement && (event.key === ' ' || event.key === 'Enter')) return;

      const normalized: NormalizedPatchKey | undefined = normalizePatchKeyEvent(event);
      if (normalized == null) return;

      const action = getPatchActionForKey(bindings, normalized);
      if (action == null) return;

      const handler = handlers[action];
      if (handler == null) return;

      if (patchPreventDefaultActions.has(action)) event.preventDefault();
      handler();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [bindings, handlers]);
}
