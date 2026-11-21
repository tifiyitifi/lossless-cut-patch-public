import type { SweetAlertOptions } from 'sweetalert2';

import getSwal from '../../swal';
import { isTextEntryTarget } from '../patch/keyMatch';
import isSwalConfirmKey from './confirmKey';
/**
The fork's dialogs that are reached with `E` (fork-owned).

The permanent-delete confirmation and the "job finished" summary both offer a "do not show this
again" box, and both confirm on `E` / `Shift+E` - the key that opened the finish dialog, so the
whole step stays on one key. `Shift+F` confirms the two finish dialogs as well (`includeSkipKey`):
that key opened the skip workflow, so pressing it again on its own summary means "yes". The
export's "nothing to export" prompt uses the same helper without that option, so an unrelated
prompt never answers to the skip key.

Left/Right and Enter keep their normal SweetAlert behaviour: they move between the buttons and
press the focused one.
*/

/** The id of the checkbox the dialogs render, so the dialog can read it back. */
const doNotShowAgainId = 'patch-finish-do-not-show-again';

function escapeHtml(text: string) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/**
Let the key that opened the step press the dialog's confirm button.

The listener is installed in the capture phase and removed when the dialog closes; a key typed
into a field wins over it (there is no field in these dialogs today, but a future one must not be
hijacked). The dialog's own `didOpen` / `willClose` still run.

`includeSkipKey` adds `Shift+F` (see `isSwalConfirmKey`).
*/
export function withConfirmKeys(options: SweetAlertOptions, { includeSkipKey = false }: { includeSkipKey?: boolean } = {}): SweetAlertOptions {
  let removeListener: (() => void) | undefined;
  return {
    ...options,
    didOpen: (popup) => {
      const onKeyDown = (e: KeyboardEvent) => {
        if (!isSwalConfirmKey(e, { includeSkipKey }) || isTextEntryTarget(e.target)) return;
        // Stop the event here: the page-level shortcut must not start a second job behind the dialog.
        e.preventDefault();
        e.stopPropagation();
        getSwal().Swal.clickConfirm();
      };
      document.addEventListener('keydown', onKeyDown, { capture: true });
      removeListener = () => { document.removeEventListener('keydown', onKeyDown, true); };
      options.didOpen?.(popup);
    },
    willClose: (popup) => {
      removeListener?.();
      removeListener = undefined;
      options.willClose?.(popup);
    },
  };
}

/**
The "do not show this again" checkbox, plus the live state the caller reads after the dialog closes.

The state is mirrored from the input on every change, so the value is still there once the popup
has been removed from the DOM - reading the element at that point would race the close animation.
*/
export function doNotShowAgainBox({ label, checked }: { label: string; checked: boolean }) {
  const state = { checked };
  const html = `<div style="margin-top:.8em;text-align:left"><label style="display:flex;gap:.45em;align-items:flex-start;cursor:pointer"><input id="${doNotShowAgainId}" type="checkbox"${checked ? ' checked' : ''} style="margin-top:.25em"/><span style="font-size:.9em;line-height:1.35">${escapeHtml(label)}</span></label></div>`;

  return {
    html,
    /** Call from `didOpen` with the popup root. */
    bind(popup: HTMLElement) {
      const input = popup.querySelector<HTMLInputElement>(`#${doNotShowAgainId}`);
      if (input == null) return;
      state.checked = input.checked;
      input.addEventListener('change', () => { state.checked = input.checked; });
    },
    isChecked: () => state.checked,
  };
}
