import type { KeyboardAction, KeyBinding } from '../../types.js';
import { keyCombination } from '../patchTransport/transport.js';
import { defaultKeyBindings } from './patchDefaults.js';

/**
Give a stored binding table its scopes (fork-owned, pure).

Two jobs, both needed once:

- An old config's rows have no scope. Rows that match a shipped default get that default's scope;
  everything else is a user binding (which is also what a missing scope means at runtime, so this
  only makes it visible).
- The patch defaults did not exist when the table was written, and electron-store only fills
  *missing keys* - an existing `keyBindings` array is filled in by nobody. They are appended here,
  enabled, so an upgrade gets the full layout.

A default is not re-added when the table already holds it, or when a key of the user's own claims
the same combination: the user's key wins, and re-adding the default would leave a binding that can
never run (and a conflict notice at every start). The user's own spelling of a key is kept.
*/
export function withKeyBindingScopes(bindings: readonly KeyBinding[]): KeyBinding[] {
  const scoped = bindings.map((binding) => {
    const shippedDefault = defaultKeyBindings.find((candidate) => (
      keyCombination(candidate.keys) === keyCombination(binding.keys) && candidate.action === binding.action
    ));
    return {
      ...binding,
      ...(shippedDefault?.scope != null ? { scope: shippedDefault.scope } : { scope: 'user' as const }),
      enabled: binding.enabled ?? true,
    };
  });

  const userCombinations = new Set(scoped.filter((binding) => binding.scope === 'user').map((binding) => keyCombination(binding.keys)));
  const present = new Set(scoped.map((binding) => `${keyCombination(binding.keys)}::${binding.action}`));

  const missingDefaults = defaultKeyBindings
    .filter((candidate) => !present.has(`${keyCombination(candidate.keys)}::${candidate.action}`))
    .filter((candidate) => !userCombinations.has(keyCombination(candidate.keys)))
    .map((candidate) => ({ ...candidate, enabled: candidate.enabled ?? true }));

  return [...scoped, ...missingDefaults];
}

/**
The patch defaults added after the first scoped table (fork-owned, pure).

`electron-store` only fills missing keys, so a config written before these keys existed never gains
them on its own. The rows are appended only when the table lacks them and no binding of the user's
own claims the combination: their key wins, and re-adding the default would leave a binding that can
never run (and a conflict notice at every start).

This migration is separate from `withKeyBindingScopes` so it does not re-add a default the user
rebound away from its original key. It only adds the keys listed here.
*/
const addedPatchKeys: readonly KeyBinding[] = [
  // The cut marking: `Alt+Up` / `Down` now marks instead of changing the volume. The other two
  // marking pairs (`I` / `O` and the bare `Up` / `Down`) are upstream / earlier patch defaults.
  { keys: 'AltLeft+ArrowUp', action: 'setCutStart' },
  { keys: 'AltLeft+ArrowDown', action: 'setCutEnd' },
  // The preview volume moved off Alt+arrows; M stays the (already bound) mute key.
  { keys: 'Minus', action: 'decreaseVolume' },
  { keys: 'Equal', action: 'increaseVolume' },
  // The app menu bar stays hidden in patch mode; this key shows or hides it.
  { keys: 'AltLeft+KeyQ', action: 'togglePatchMenuBar' },
];

export function withAddedPatchKeys(bindings: readonly KeyBinding[]): KeyBinding[] {
  const userCombinations = new Set(
    bindings
      .filter((binding) => (binding.scope ?? 'user') === 'user')
      .map((binding) => keyCombination(binding.keys)),
  );
  const present = new Set(bindings.map((binding) => `${keyCombination(binding.keys)}::${binding.action}`));

  const missing = addedPatchKeys
    .filter((candidate) => !present.has(`${keyCombination(candidate.keys)}::${candidate.action}`))
    .filter((candidate) => !userCombinations.has(keyCombination(candidate.keys)))
    .map((candidate) => ({ ...candidate, scope: 'patch' as const, enabled: true }));

  return [...bindings, ...missing];
}

/**
Patch rows briefly shipped with the first version of the volume/menu migration (fork-owned, pure).

`Shift+Alt+Left` / `Right` was restored as a fourth cut-marking pair in one build and then removed
again at the user's request. A config written by that build still carries the two rows; drop them
only when they are still exactly those patch defaults, so a binding of the user's own on the same
combination survives.
*/
const removedPatchKeys: readonly KeyBinding[] = [
  { keys: 'ShiftLeft+AltLeft+ArrowLeft', action: 'setCutStart' },
  { keys: 'ShiftLeft+AltLeft+ArrowRight', action: 'setCutEnd' },
];

export function withoutRemovedPatchKeys(bindings: readonly KeyBinding[]): KeyBinding[] {
  return bindings.filter((binding) => (
    (binding.scope ?? 'user') !== 'patch'
    || removedPatchKeys.every((candidate) => (
      keyCombination(candidate.keys) !== keyCombination(binding.keys) || candidate.action !== binding.action
    ))
  ));
}

/**
Old patch defaults that moved to a different action (fork-owned, pure).

`Z` was "reset to 1x" and is now the 1x/last-speed toggle; `D`/`F` stepped frames the
other way round. A stored config still carries the old rows, and `electron-store` only
fills *missing keys*, so without this migration an existing install would keep the old
layout forever.

Only a row that is still exactly the old default (a patch-scope row with the old key and
the old action) is retargeted. A key the user rebound, or a default they switched off,
is theirs and stays as it is - the switched-off flag in particular must survive, so
disabling one of these keys keeps it disabled.
*/
const retargetedPatchKeys: readonly { keys: string, fromAction: KeyboardAction, toAction: KeyboardAction }[] = [
  { keys: 'KeyZ', fromAction: 'resetPlaybackRate', toAction: 'togglePlaybackRate' },
  { keys: 'KeyD', fromAction: 'seekNextFrame', toAction: 'seekPreviousFrame' },
  { keys: 'KeyF', fromAction: 'seekPreviousFrame', toAction: 'seekNextFrame' },
];

export function withRetargetedPatchKeys(bindings: readonly KeyBinding[]): KeyBinding[] {
  return bindings.map((binding) => {
    const retargeted = retargetedPatchKeys.find((candidate) => (
      (binding.scope ?? 'user') === 'patch'
      && keyCombination(candidate.keys) === keyCombination(binding.keys)
      && candidate.fromAction === binding.action
    ));
    return retargeted == null ? binding : { ...binding, action: retargeted.toAction };
  });
}

/**
The finish-and-keep key moved from `Shift+G` to `Shift+F` (fork-owned, pure).

`withRetargetedPatchKeys` can only change an action, not a key, so the move needs its own step. Only
the row that is still exactly the old default (patch scope, `Shift+G`, `finishKeepSource`) is
renamed; a key the user rebound, and a default they switched off (the flag travels with the row),
stays as it is.

If the new combination is already used by an enabled row, the old row keeps its own key: dropping it
would leave the action without any key at all (no hint in the finish summary, `Unbound` in the
keyboard settings) just because the user had put something else on `Shift+F`. The old key is not
wanted by anything else in that case - it was this action's until now - so keeping it costs nothing,
and the user can rebind whenever they want the new one.

A switched-off row does not count as taken: it dispatches nothing (`resolveKeyBindings` skips it) and
raises no conflict, so dropping the old row for it would only lose the action's key.
*/
const renamedPatchKeys: readonly { fromKeys: string, toKeys: string, action: KeyboardAction }[] = [
  { fromKeys: 'ShiftLeft+KeyG', toKeys: 'ShiftLeft+KeyF', action: 'finishKeepSource' },
];

export function withRenamedPatchKeys(bindings: readonly KeyBinding[]): KeyBinding[] {
  const isOldRow = (binding: KeyBinding, candidate: typeof renamedPatchKeys[number]) => (
    (binding.scope ?? 'user') === 'patch'
    && keyCombination(binding.keys) === keyCombination(candidate.fromKeys)
    && binding.action === candidate.action
  );
  const claimed = new Set(
    bindings
      .filter((binding) => binding.enabled !== false)
      .filter((binding) => renamedPatchKeys.every((candidate) => !isOldRow(binding, candidate)))
      .map((binding) => keyCombination(binding.keys)),
  );
  return bindings.map((binding) => {
    const candidate = renamedPatchKeys.find((entry) => isOldRow(binding, entry));
    if (candidate == null) return binding;
    // The user's own binding on the new key wins; this action keeps its old key instead of none.
    if (claimed.has(keyCombination(candidate.toKeys))) return binding;
    return { ...binding, keys: candidate.toKeys };
  });
}
