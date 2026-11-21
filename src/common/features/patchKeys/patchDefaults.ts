import type { KeyBinding } from '../../types.js';
import { patchCommandConsoleBinding } from '../patchCommand/consoleKeyBinding.js';
import { keyCombination, remapPatchEditorBindings } from '../patchTransport/transport.js';
import { baseDefaultKeyBindings } from './baseDefaults.js';

/**
Patch mode's own default key table (fork-owned).

It is *derived*, never hand-written: the table is the difference between the legacy editor remap of
the base defaults and the base defaults themselves. Every entry the remap re-purposes, and every key
it adds, becomes a patch-scope default. That way the two representations of the patch key layout -
this table (used by the scope resolver) and `patchTransport.ts` (used by the results windows and
kept for the remap tests) - cannot drift apart. A test pins the equality.
*/
function derivePatchDefaultKeyBindings(): KeyBinding[] {
  const baseActionByCombination = new Map(baseDefaultKeyBindings.map((binding) => [keyCombination(binding.keys), binding.action]));
  return remapPatchEditorBindings(baseDefaultKeyBindings)
    .filter((binding) => baseActionByCombination.get(keyCombination(binding.keys)) !== binding.action);
}

export const patchDefaultKeyBindings: readonly KeyBinding[] = derivePatchDefaultKeyBindings();

/**
Every default the app ships with, base and patch.

The command console is patch-only (its action is a no-op in base mode), so it is a patch default
even though it has no upstream counterpart.
*/
export const defaultKeyBindings: readonly KeyBinding[] = [
  ...baseDefaultKeyBindings.map((binding) => ({ ...binding, scope: 'base' as const, enabled: true })),
  ...patchDefaultKeyBindings.map((binding) => ({ ...binding, scope: 'patch' as const, enabled: true })),
  { ...patchCommandConsoleBinding, scope: 'patch' as const, enabled: true },
];
