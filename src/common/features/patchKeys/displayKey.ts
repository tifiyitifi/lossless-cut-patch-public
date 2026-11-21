import type { KeyBinding, KeyBindingScope } from '../../types.js';
import { keyBindingScope } from './resolve.js';

/**
Which key a help text shows for an action (fork-owned, pure).

An action can carry several bindings: patch mode adds its own key next to the upstream one
(`X` next to `J`), and the upstream table itself binds some actions twice, once with `Ctrl` and
once with `Meta` for macOS (`Ctrl+Z` / `Meta+Z`). Showing "the" key therefore needs a rule, and
`Object.fromEntries` over the binding list is the wrong one: it silently keeps the *last* row.

The rules, in order:

- the platform's own spelling first: on Windows and Linux the `Meta` alias is the secondary one
  (`Ctrl+Z`, not `⊞ Win+Z`), while macOS means `Cmd+Z` when it has that spelling;
- the mode's own layout next: a patch binding says what patch mode means with that action, and a
  user binding is the user's own choice;
- the first row wins if two candidates look alike, so the result is stable for a given table.
*/
export function usesMetaKey(keys: string) {
  return keys.split('+').some((part) => part === 'MetaLeft' || part === 'MetaRight');
}

const scopePriority: Record<KeyBindingScope, number> = { base: 0, patch: 1, user: 2 };

/**
The binding a help text should show for `action`, or `undefined` when the action has no key.

`preferMetaKey` is true on macOS, where `Cmd` is the primary modifier, and false on Windows and
Linux, where `Meta` only repeats an action that already has another key.
*/
export function pickDisplayKeyBinding(
  bindings: readonly KeyBinding[],
  action: string,
  { preferMetaKey }: { preferMetaKey: boolean },
): KeyBinding | undefined {
  const candidates = bindings.filter((binding) => binding.action === action);
  if (candidates.length === 0) return undefined;

  // Only drop the platform's secondary spelling when the other one is left: an action that only
  // exists on `Meta+...` still has to show its key.
  const matching = candidates.filter((binding) => usesMetaKey(binding.keys) === preferMetaKey);
  const pool = matching.length > 0 ? matching : candidates;

  return pool.reduce((best, candidate) => (
    scopePriority[keyBindingScope(candidate)] > scopePriority[keyBindingScope(best)] ? candidate : best
  ));
}
