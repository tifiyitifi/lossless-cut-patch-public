/**
Patch-mode keyboard map (pure logic).

Patch mode has its own keyboard system, independent from the upstream key bindings. The default
layout follows a PotPlayer-style transport skeleton plus LosslessCut-style cut marking.

Keys are matched against `KeyboardEvent.key` (letters are lower-cased), never against `keyCode`.
*/

export type PatchAction = | 'play-pause'
  | 'fullscreen'
  | 'mute'
  | 'seek-back'
  | 'seek-forward'
  | 'volume-up'
  | 'volume-down'
  | 'frame-next'
  | 'frame-prev'
  | 'rate-down'
  | 'rate-up'
  | 'rate-reset'
  | 'set-cut-start'
  | 'set-cut-end'
  | 'split-segment'
  | 'add-segment'
  | 'remove-segment'
  | 'prev-segment'
  | 'next-segment'
  | 'prev-file'
  | 'next-file'
  | 'view-candidates'
  | 'view-previous'
  | 'snapshot'
  | 'snapshot-clipboard'
  | 'toggle-select'
  | 'select-all-segments'
  | 'clear-selection'
  | 'invert-selection'
  | 'play-selected'
  | 'cut';

export interface PatchKeyBinding {
  action: PatchAction;
  /** `KeyboardEvent.key` value (letters lower-cased). */
  key: string;
  /** When set, the binding only matches if the shift state matches. Omit to ignore shift. */
  shift?: boolean | undefined;
}

/** A key press normalized for matching. */
export interface NormalizedPatchKey {
  key: string;
  shift: boolean;
}

/**
Normalize a keyboard event for keymap matching.
Returns `undefined` for events with Ctrl/Meta/Alt held (reserved for future shortcuts, e.g. the
command palette / console) or other combinations patch mode does not handle yet.
*/
export function normalizePatchKeyEvent(event: {
  key: string,
  ctrlKey: boolean,
  metaKey: boolean,
  altKey: boolean,
  shiftKey: boolean,
}): NormalizedPatchKey | undefined {
  if (event.ctrlKey || event.metaKey || event.altKey) return undefined;
  const isLetter = event.key.length === 1 && /[a-z]/i.test(event.key);
  return {
    key: isLetter ? event.key.toLowerCase() : event.key,
    shift: event.shiftKey,
  };
}

/** Find the action bound to a normalized key, or `undefined`. First match wins. */
export function getPatchActionForKey(bindings: readonly PatchKeyBinding[], key: NormalizedPatchKey): PatchAction | undefined {
  const binding = bindings.find((candidate) => (
    candidate.key === key.key && (candidate.shift == null || candidate.shift === key.shift)
  ));
  return binding?.action;
}

/**
Every `PatchAction`, keyed by id. Declared as a `Record` so TypeScript fails when a new action is
added to the union but not listed here (the console / palette look actions up at runtime).
*/
const patchActionTable: Record<PatchAction, true> = {
  'play-pause': true,
  fullscreen: true,
  mute: true,
  'seek-back': true,
  'seek-forward': true,
  'volume-up': true,
  'volume-down': true,
  'frame-next': true,
  'frame-prev': true,
  'rate-down': true,
  'rate-up': true,
  'rate-reset': true,
  'set-cut-start': true,
  'set-cut-end': true,
  'split-segment': true,
  'add-segment': true,
  'remove-segment': true,
  'prev-segment': true,
  'next-segment': true,
  'prev-file': true,
  'next-file': true,
  'view-candidates': true,
  'view-previous': true,
  snapshot: true,
  'snapshot-clipboard': true,
  'toggle-select': true,
  'select-all-segments': true,
  'clear-selection': true,
  'invert-selection': true,
  'play-selected': true,
  cut: true,
};

/** All `PatchAction` ids, in declaration order (runtime lookup). */
export const allPatchActions = Object.keys(patchActionTable) as PatchAction[];

/** Default patch-mode key bindings (PotPlayer transport + LosslessCut marking). */
export const defaultPatchKeyBindings: readonly PatchKeyBinding[] = [
  // Transport
  { action: 'play-pause', key: ' ' },
  { action: 'fullscreen', key: 'Enter' },
  { action: 'mute', key: 'm' },
  { action: 'seek-back', key: 'ArrowLeft' },
  { action: 'seek-forward', key: 'ArrowRight' },
  { action: 'volume-up', key: 'ArrowUp' },
  { action: 'volume-down', key: 'ArrowDown' },
  { action: 'frame-next', key: 'f' },
  { action: 'frame-prev', key: 'd' },
  { action: 'rate-down', key: 'x' },
  { action: 'rate-up', key: 'c' },
  { action: 'rate-reset', key: 'z' },
  { action: 'prev-file', key: 'PageUp' },
  { action: 'next-file', key: 'PageDown' },
  // View switching
  { action: 'view-candidates', key: 'v', shift: false },
  { action: 'view-previous', key: 'v', shift: true },
  // Snapshot (Shift+K goes to the clipboard instead of a file)
  { action: 'snapshot', key: 'k', shift: false },
  { action: 'snapshot-clipboard', key: 'k', shift: true },
  // Segment selection
  { action: 'toggle-select', key: 's' },
  { action: 'play-selected', key: 'p' },
  // Cut marking
  { action: 'set-cut-start', key: 'i' },
  { action: 'set-cut-end', key: 'o' },
  { action: 'split-segment', key: 'b' },
  { action: 'add-segment', key: 'a' },
  { action: 'remove-segment', key: 'Delete' },
  { action: 'prev-segment', key: ',' },
  { action: 'next-segment', key: '.' },
  { action: 'cut', key: 'e' },
];

/** Actions whose default browser behavior should be suppressed (scrolling / activation). */
export const patchPreventDefaultActions: ReadonlySet<PatchAction> = new Set<PatchAction>([
  'play-pause', 'fullscreen', 'seek-back', 'seek-forward', 'volume-up', 'volume-down', 'prev-file', 'next-file',
]);

const keyLabels: Record<string, string> = {
  ' ': 'Space',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Escape: 'Esc',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  Delete: 'Del',
};

/** Human-readable label for a `KeyboardEvent.key` value (for the shortcut guide). */
export function formatPatchKeyLabel(key: string): string {
  const mapped = keyLabels[key];
  if (mapped != null) return mapped;
  if (key.length === 1 && /[a-z]/i.test(key)) return key.toUpperCase();
  return key;
}

/** Human-readable label for the first key bound to an action, or `undefined`. */
export function getPatchKeyLabelForAction(bindings: readonly PatchKeyBinding[], action: PatchAction): string | undefined {
  const binding = bindings.find((candidate) => candidate.action === action);
  if (binding == null) return undefined;
  const label = formatPatchKeyLabel(binding.key);
  return binding.shift === true ? `Shift+${label}` : label;
}

/** True when two bindings could both match the same key press. */
function shiftCompatible(binding: PatchKeyBinding, shift: boolean | undefined): boolean {
  return binding.shift == null || shift == null || binding.shift === shift;
}

/**
Merge custom bindings over the defaults. A custom binding wins for its action; every other action
keeps its default binding. Default order is preserved (stable palette / guide order).
*/
export function mergePatchKeyBindings(
  custom: readonly PatchKeyBinding[] = [],
  defaults: readonly PatchKeyBinding[] = defaultPatchKeyBindings,
): PatchKeyBinding[] {
  const customByAction = new Map<PatchAction, PatchKeyBinding>();
  for (const binding of custom) customByAction.set(binding.action, binding);

  const merged = defaults.map((binding) => customByAction.get(binding.action) ?? binding);

  // Keep bindings for actions that have no default (forward compatibility).
  for (const binding of custom) {
    if (defaults.every((candidate) => !(candidate.action === binding.action))) merged.push(binding);
  }

  return merged;
}

/** Replace (or add) the binding for `action`, keeping the array order stable. */
export function setPatchKeyBinding(
  bindings: readonly PatchKeyBinding[],
  action: PatchAction,
  key: string,
  shift?: boolean,
): PatchKeyBinding[] {
  const binding: PatchKeyBinding = { action, key, shift };
  const index = bindings.findIndex((candidate) => candidate.action === action);
  if (index === -1) return [...bindings, binding];

  const next = [...bindings];
  next[index] = binding;
  return next;
}

/**
The action already bound to `key` (+ shift), ignoring `exceptAction`, or `undefined`.
Mirrors the matching rules of `getPatchActionForKey`.
*/
export function findPatchKeyConflict(
  bindings: readonly PatchKeyBinding[],
  key: string,
  shift: boolean | undefined,
  exceptAction?: PatchAction,
): PatchAction | undefined {
  const conflict = bindings.find((candidate) => (
    candidate.action !== exceptAction && candidate.key === key && shiftCompatible(candidate, shift)
  ));
  return conflict?.action;
}
