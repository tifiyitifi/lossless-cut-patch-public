import type { KeyboardAction, KeyBinding } from '../../types.js';
import { keyCombination } from '../patchTransport/transport.js';
import { defaultKeyBindings } from './patchDefaults.js';
import { isKeyBindingEnabled, resolveKeyBindings } from './resolve.js';

/**
The two shortcut summaries the settings dialog shows above the list (fork-owned, pure).

1. `describeLayoutDifferences` compares the *shipped* layouts: which keys patch mode runs
   differently from base mode. It is static data (it never looks at the user's table), so it reads
   as a cheat sheet: "this key does that there and this here".
2. `describeUserChanges` compares the user's stored table against the shipped defaults: what they
   added, switched off, or (after a hand edit) lost.
*/

export interface KeyLayoutDifference {
  /** The user's spelling of the key combination, modifiers first. */
  keys: string;
  /** The action on that key in base mode (absent when the key is patch-only). */
  baseAction?: KeyboardAction | undefined;
  /** The action on that key in patch mode (absent when patch mode does not run it). */
  patchAction?: KeyboardAction | undefined;
}

interface LayoutRow {
  keys: string;
  action: KeyboardAction;
}

/** One row per key combination. A combination is only ever one action, so this cannot lose data. */
function layoutRows(bindings: readonly KeyBinding[]): Map<string, LayoutRow> {
  const rows = new Map<string, LayoutRow>();
  for (const binding of bindings) {
    const combination = keyCombination(binding.keys);
    if (!rows.has(combination)) rows.set(combination, { keys: binding.keys, action: binding.action });
  }
  return rows;
}

/**
Every key whose action differs between the two shipped layouts.

Keys both modes handle the same way are left out: the point of the list is the difference, not the
layout. Keys patch mode adds show an empty base side, keys it stops running (none today) would show
an empty patch side.
*/
export function describeLayoutDifferences(
  baseBindings: readonly KeyBinding[] = resolveKeyBindings(defaultKeyBindings, { mode: 'base' }),
  patchBindings: readonly KeyBinding[] = resolveKeyBindings(defaultKeyBindings, { mode: 'patch' }),
): KeyLayoutDifference[] {
  const baseRows = layoutRows(baseBindings);
  const patchRows = layoutRows(patchBindings);

  return [...new Set([...baseRows.keys(), ...patchRows.keys()])]
    .filter((combination) => baseRows.get(combination)?.action !== patchRows.get(combination)?.action)
    .map((combination) => {
      const baseRow = baseRows.get(combination);
      const patchRow = patchRows.get(combination);
      return {
        keys: patchRow?.keys ?? baseRow?.keys ?? combination,
        baseAction: baseRow?.action,
        patchAction: patchRow?.action,
      };
    })
    .sort((a, b) => a.keys.localeCompare(b.keys));
}

export interface UserKeyChanges {
  /** Keys the user added (a second key for an action, or a key of their own). */
  added: KeyBinding[];
  /** Shipped defaults the user switched off. */
  disabled: KeyBinding[];
  /** Shipped defaults the stored table no longer holds (hand edits, old migrations). */
  missing: KeyBinding[];
}

const sameBinding = (a: KeyBinding, b: KeyBinding) => (
  keyCombination(a.keys) === keyCombination(b.keys) && a.action === b.action
);

const byKey = (a: KeyBinding, b: KeyBinding) => a.keys.localeCompare(b.keys) || a.action.localeCompare(b.action);

/** How the user's table differs from the defaults. Empty lists mean "unchanged". */
export function describeUserChanges(
  bindings: readonly KeyBinding[],
  defaults: readonly KeyBinding[] = defaultKeyBindings,
): UserKeyChanges {
  return {
    added: bindings.filter((binding) => defaults.every((candidate) => !sameBinding(candidate, binding))).sort(byKey),
    disabled: bindings
      .filter((binding) => !isKeyBindingEnabled(binding) && defaults.some((candidate) => sameBinding(candidate, binding)))
      .sort(byKey),
    missing: defaults.filter((candidate) => bindings.every((binding) => !sameBinding(candidate, binding))).sort(byKey),
  };
}

/** Does the user's table differ from the defaults at all? */
export function hasUserChanges(changes: UserKeyChanges) {
  return changes.added.length > 0 || changes.disabled.length > 0 || changes.missing.length > 0;
}
