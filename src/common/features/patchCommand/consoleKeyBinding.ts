import type { KeyBinding } from '../../types.js';

/** Default binding for the patch command console (patch-mode only). */
export const patchCommandConsoleBinding: KeyBinding = { keys: 'ShiftLeft+Space', action: 'togglePatchCommandConsole' };

/**
Give a stored config the patch command console binding.

New installs get it from the config defaults, but electron-store only fills *missing keys*, so
existing configs (which already have a `keyBindings` array) need an explicit migration. Called
once, gated by the config version, so a user who deliberately unbinds it keeps it unbound.
*/
export function withPatchCommandConsoleBinding(bindings: readonly KeyBinding[]): KeyBinding[] {
  if (bindings.some(({ action }) => action === 'togglePatchCommandConsole')) return [...bindings];
  return [...bindings, patchCommandConsoleBinding];
}
