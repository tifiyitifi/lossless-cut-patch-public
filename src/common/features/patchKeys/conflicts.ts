import type { KeyBinding, KeyBindingScope } from '../../types.js';
import { keyCombination } from '../patchTransport/transport.js';
import { isKeyBindingEnabled, keyBindingScope, resolveKeyBindings } from './resolve.js';

/**
Shortcut conflicts between the three scopes (fork-owned, pure).

The user picks a scope for every binding they add: `user`, `base` or `patch`.

- A `user` binding may not collide with anything: it runs in both modes, so a collision would make
  one of the two actions unreachable without saying so. The settings dialog blocks the save.
- A `base` / `patch` binding may collide on purpose: a `patch` binding on an upstream key *is* how
  patch mode re-purposes it, and a `base` binding on a patch key pins the upstream behaviour. The
  dialog only warns: the scope already says who loses in which mode.
*/
export interface KeyBindingConflict {
  /** The enabled binding that claims the same key combination. */
  binding: KeyBinding;
  /** Its scope, so the dialog can name the side. */
  scope: KeyBindingScope;
  /** Key combinations that still reach the conflicting binding's action. */
  bindingAlternatives: string[];
  /** Key combinations that still reach the candidate's action. */
  candidateAlternatives: string[];
}

export interface KeyBindingConflictReport {
  conflicts: KeyBindingConflict[];
  /** `blocking` when the candidate is a user binding, `warning` for base / patch. */
  severity: 'blocking' | 'warning';
}

/**
What a candidate collides with.

Only enabled bindings count: disabling a default is the documented way to free its key. Duplicate
*actions* are never a conflict - two keys for one action is a feature of the layout (I and Up both
mark the in point).
*/
export function analyzeKeyBindingConflicts(bindings: readonly KeyBinding[], candidate: KeyBinding): KeyBindingConflictReport {
  const candidateCombination = keyCombination(candidate.keys);
  const enabled = bindings.filter((binding) => isKeyBindingEnabled(binding));

  const keysForAction = (action: KeyBinding['action'], except?: KeyBinding) => enabled
    .filter((binding) => binding.action === action && binding !== except)
    .map((binding) => binding.keys);

  const conflicts = enabled
    .filter((binding) => binding !== candidate && binding.action !== candidate.action && keyCombination(binding.keys) === candidateCombination)
    .map((binding) => ({
      binding,
      scope: keyBindingScope(binding),
      bindingAlternatives: keysForAction(binding.action, binding),
      candidateAlternatives: keysForAction(candidate.action),
    }));

  return {
    conflicts,
    severity: keyBindingScope(candidate) === 'user' ? 'blocking' : 'warning',
  };
}

/**
Which bindings start firing once this one is disabled.

Disabling is not "unbind": the combination falls through to whatever else is on it. Disabling a
patch default therefore gives its key back to the base default in patch mode (the documented
trade-off - the dialog says so before the switch flips). Returns the bindings that become reachable
in the cutting window, so the warning can name them instead of saying "something changes".
*/
export function analyzeDisableImpact(bindings: readonly KeyBinding[], target: KeyBinding): KeyBinding[] {
  const withoutTarget = bindings.map((binding) => (binding === target ? { ...binding, enabled: false } : binding));
  const before = new Map(resolveKeyBindings(bindings, { mode: 'patch' }).map((binding) => [keyCombination(binding.keys), binding.action]));

  return resolveKeyBindings(withoutTarget, { mode: 'patch' })
    .filter((binding) => before.get(keyCombination(binding.keys)) !== binding.action);
}

/**
The user bindings that cannot run because they collide with something else.

Defaults shipped by the app cannot collide (the two tables are disjoint by construction), so this
only reports a hand-edited config or a binding saved under an older model. It drives the one-time
notice at startup.
*/
export function findBlockingConflicts(bindings: readonly KeyBinding[]): KeyBindingConflict[] {
  return bindings
    .filter((binding) => isKeyBindingEnabled(binding) && keyBindingScope(binding) === 'user')
    .flatMap((binding) => analyzeKeyBindingConflicts(bindings, binding).conflicts);
}
