import type { DamagePlaybackQuality, SourceDamageKind } from './types.js';

/**
What the repair menu is looking at right now (fork-owned).

The renderer is the only place that knows which file is open and what the user chose, so it
reports this to the main process; the native Tools menu is rebuilt from it. `undefined` means
"no window has reported yet" and the menu shows the generic, disabled state.
*/
export interface SourceRepairMenuState {
  /** Did the probe find anything to repair in the open file? */
  hasDamage: boolean;
  /** The damage kinds found, in registry order (empty when healthy). */
  kinds: SourceDamageKind[];
  /** Is playback being repaired for the open file right now? */
  repair: boolean;
  quality: DamagePlaybackQuality;
  /** The global export switch, mirrored so both entry points agree. */
  exportRepair: boolean;
}

/** What a menu item asks the renderer to do. */
export type SourceRepairMenuAction = | { type: 'playback', repair: boolean }
  | { type: 'quality', quality: DamagePlaybackQuality }
  | { type: 'export', repair: boolean };

/**
The playback answer the app offers for a damaged file: play it as stored, or repair it at one of
the two qualities. It is one axis of the repair, not a separate repair per quality.
*/
export type SourceRepairChoice = 'off' | DamagePlaybackQuality;

/**
IPC channel: the native Tools > Repair menu asks the focused window to change the repair.

The menu cannot hold the state itself (it is built once per change), so it only sends intents and
the window that owns the file applies them.
*/
export const sourceRepairMenuChannel = 'patchSourceRepair';
