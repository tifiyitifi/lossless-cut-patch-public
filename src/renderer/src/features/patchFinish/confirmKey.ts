/**
Whether a keydown confirms one of the fork's finish dialogs (pure).

`E` (with or without Shift) is the finish key (`Shift+E`), so pressing it again *on* the dialog
means "yes, go ahead". Shift is therefore not part of the decision - it is in the shape only so a
caller can hand over the whole event and the test can prove both states behave the same. Other
modifiers are left alone: `Ctrl+E` / `Alt+E` belong to the OS or to a field. Arrow keys and Enter
keep their normal SweetAlert behaviour.

`Shift+F` (`finishKeepSource`) confirms as well, but only where the caller asks for it: that key
belongs to the skip workflow, and its dialogs must not make an unrelated prompt (the export's
"Nothing to export") answer to it. Plain `F` is never a confirm key - it is the patch "step one
frame forward" key, and a user pressing it on a dialog means to step a frame.
*/
export default function isSwalConfirmKey({ code, ctrlKey, altKey, metaKey, repeat, shiftKey }: {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  repeat: boolean;
  shiftKey: boolean;
}, { includeSkipKey = false }: { includeSkipKey?: boolean } = {}) {
  if (repeat || ctrlKey || altKey || metaKey) return false;
  if (code === 'KeyE') return true;
  return includeSkipKey && shiftKey && code === 'KeyF';
}
