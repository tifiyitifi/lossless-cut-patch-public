import type { KeyBinding, KeyBindingScope } from '../../types.js';
import type { PatchTransportContext } from '../patchTransport/transport.js';
import { applyWindowBindings, keyCombination } from '../patchTransport/transport.js';

/**
Which mode the bindings are resolved for (fork-owned).

Base mode runs the upstream layout untouched. Patch mode runs its own defaults on top of the base
ones: a patch binding wins on the keys it claims, and every base binding it does not claim keeps
working. That is the whole rule - no key is duplicated by accident, and a key that only one side
uses works in both modes.
*/
export type KeyBindingMode = 'base' | 'patch';

/** A binding without a scope is a user binding: scopes arrived after the first stored configs. */
export function keyBindingScope(binding: KeyBinding): KeyBindingScope {
  return binding.scope ?? 'user';
}

/** A binding without the flag is enabled (same backwards-compatibility reason). */
export function isKeyBindingEnabled(binding: KeyBinding) {
  return binding.enabled !== false;
}

/** Patch wins over base, and a user binding wins over both (validation keeps them apart anyway). */
const scopePriority: Record<KeyBindingScope, number> = { base: 0, patch: 1, user: 2 };

/**
The bindings as one mode runs them.

At most one binding survives per key combination: the keyboard hook matches a pressed key against
one binding, so a second one on the same combination would be dead code that still shows up in the
settings. The winner is the higher scope (user, then the mode's own default, then the other mode's
default), which is why patch mode shadowing a base key needs no special case.

Disabled bindings are dropped first: disabling a patch default hands its key back to the base
default, which is exactly what the disable warning promises.
*/
export function resolveKeyBindings(
  bindings: readonly KeyBinding[],
  { mode, context = 'editor' }: { mode: KeyBindingMode, context?: PatchTransportContext },
): KeyBinding[] {
  const winnerByCombination = new Map<string, KeyBinding>();

  for (const binding of bindings) {
    if (!isKeyBindingEnabled(binding)) continue;
    const scope = keyBindingScope(binding);
    // Base mode never runs a patch-only binding; patch mode runs both and lets the scope decide.
    if (mode === 'base' && scope === 'patch') continue;

    const combination = keyCombination(binding.keys);
    const existing = winnerByCombination.get(combination);
    if (existing == null || scopePriority[scope] > scopePriority[keyBindingScope(existing)]) {
      winnerByCombination.set(combination, binding);
    }
  }

  const resolved = [...winnerByCombination.values()];
  if (mode === 'base') return resolved;

  // The results windows re-purpose a few keys on top of the cutting layout (see patchTransport).
  return applyWindowBindings(resolved, context);
}
