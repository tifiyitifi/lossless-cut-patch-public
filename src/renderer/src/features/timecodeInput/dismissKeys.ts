import { matchesKeyBinding } from '../patch/keyMatch';

/**
Does this key event close the patch-mode seek dialog (fork-owned pure logic)?

The dialog is opened by the `goToTimecode` action, and patch mode binds more than one key to it
(`G`, plus the numeric keypad's `/`). While the dialog is open the focus sits in its input, where
the upstream keyboard hook does not run, so the dialog listens for the same keys itself and closes
- that is what makes the keys toggle instead of only open.

The exception is a binding bound to a key that the field itself needs: digits, the timecode
punctuation (`.` `,` `:` `-` `+`) and the editing keys. A user who binds `goToTimecode` to `1` must
still be able to type `..1.2.3`; there the key types and does not close.

The event is read property by property, never spread: a real `KeyboardEvent` keeps `code`,
`ctrlKey`, ... on its prototype, so `{ ...event }` yields an object without any of them and every
key would silently stop matching.

An active IME must not disable this either: Chromium can mark a keydown as `isComposing`, and a
bound key that typed itself into the field instead of closing the dialog is exactly the bug that
check caused.
*/
const textOrEditKeyCodes = new Set([
  'Digit0', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9',
  'Numpad0', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5', 'Numpad6', 'Numpad7', 'Numpad8', 'Numpad9',
  'Period', 'NumpadDecimal',
  'Comma', 'NumpadComma',
  'Minus', 'NumpadSubtract',
  // `+` opens a relative seek, so it has to stay typeable too.
  'Equal', 'NumpadAdd',
  // `:` on most layouts.
  'Semicolon',
  'Backspace', 'Delete',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Tab',
]);

type KeyEventLike = Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey' | 'repeat'>;

export function isTimecodeDialogDismissEvent(e: KeyEventLike, dismissKeys: readonly string[]) {
  // Holding the opening key must not close what it just opened.
  if (e.repeat) return false;
  if (textOrEditKeyCodes.has(e.code)) return false;
  return dismissKeys.some((keys) => matchesKeyBinding(e, keys));
}
