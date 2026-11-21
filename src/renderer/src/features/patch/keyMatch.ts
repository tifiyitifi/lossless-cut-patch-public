import type { KeyBinding } from '../../../../common/types';

/**
Key matching shared by the patch-mode layers (fork-owned).

The modifier sets are duplicated from `renderer/src/util.ts` on purpose: `util` imports the
Electron bridge, which does not exist in vitest's node environment, and this module is
unit-tested. Keep them in sync with `shiftModifiers` / `controlModifiers` / `altModifiers` /
`metaModifiers`.
*/
const shiftModifiers = new Set(['ShiftLeft', 'ShiftRight']);
const controlModifiers = new Set(['ControlLeft', 'ControlRight']);
const altModifiers = new Set(['AltLeft', 'AltRight']);
const metaModifiers = new Set(['MetaLeft', 'MetaRight']);
const allModifiers = shiftModifiers.union(controlModifiers).union(altModifiers).union(metaModifiers);

/**
A pure modifier keydown (`ShiftLeft`, `ControlRight`, ...).

These must never match a binding like `ShiftLeft+Space`: `e.code` alone would match the modifier
part of the binding, which made the console open on a bare Shift press and stole Shift from every
other shortcut. The upstream keyboard hook guards this the same way.
*/
export function isModifierOnlyEvent(code: string) {
  return allModifiers.has(code);
}

/**
Does a keydown event match a stored key binding such as `ShiftLeft+Space`?

The patch layers listen on `document` in the capture phase (see `PatchCommandLayer` /
`KeyboardPracticeLayer`), because the upstream keyboard hook only dispatches while focus is on
`document.body` - after clicking the landing drop button the focus is on that button and the
shortcut would otherwise be dead.
*/
export function matchesKeyBinding(e: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>, keys: string | undefined) {
  if (keys == null || keys === '' || isModifierOnlyEvent(e.code)) return false;
  const parts = new Set(keys.split('+'));
  if (!parts.has(e.code) || ((controlModifiers.intersection(parts).size > 0) !== e.ctrlKey)) return false;
  if (((shiftModifiers.intersection(parts).size > 0) !== e.shiftKey) || ((altModifiers.intersection(parts).size > 0) !== e.altKey)) return false;
  if ((!metaModifiers.isDisjointFrom(parts)) !== e.metaKey) return false;
  return true;
}

/** The binding an event matches, if any. An action can have more than one binding. */
export function findMatchingKeyBinding(e: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>, keyBindings: readonly KeyBinding[]) {
  return keyBindings.find((binding) => matchesKeyBinding(e, binding.keys));
}


/** Should a patch shortcut be ignored because the user is typing into a field? */
export function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (target instanceof HTMLElement && target.isContentEditable);
}

/**
Is the key event going into a text field, where typing must win over a shortcut?

Finer than `isEditableTarget`: radio / checkbox / button inputs never accept text, so a shortcut
keeps working while such a control has focus (on a plain letter shortcut that is the difference
between "the key is dead" and "the key works").
*/
export function isTextEntryTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === 'TEXTAREA') return true;
  if (target.tagName !== 'INPUT') return false;
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color'].includes((target as HTMLInputElement).type);
}
