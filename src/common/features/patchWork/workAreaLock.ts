import type { KeyboardAction } from '../../types.js';
import { patchExportLockedActions } from '../patchExportLock/policy.js';
import { patchPlayerDisabledActions } from '../patchPlayer/playerMode.js';

/**
What a source inside a read-only folder refuses (fork-owned, pure).

A source opened from `.losslesscut_work` or `losslesscut_finished` is almost always a video whose
finish job already ran, so the cutting window turns into a viewer: the cut list can not be edited
and no file is produced. Everything a viewer needs stays available - playback, seeking, keyframes,
zoom, volume, snapshots, segment selection/navigation, closing or opening another file - because
those do not change what an export would write.

The set is deliberately *derived* from the export lock (`patchExportLockedActions`, the actions
that change the export snapshot or start another ffmpeg job) and the player lock
(`patchPlayerDisabledActions`), minus the actions a finished source still needs. A future action
added to either list is therefore refused here too, instead of silently punching a new hole.
*/

/** Actions that keep working on a finished source: playback, navigation, selection, opening files. */
export const patchWorkAreaAllowedActions: ReadonlySet<KeyboardAction> = new Set<KeyboardAction>([
  // Selection and the segment walk: they only decide *what* would be exported, and nothing is.
  'selectSegmentsAtCursor',
  'selectOnlyCurrentSegment',
  'toggleCurrentSegmentSelected',
  'deselectAllSegments',
  'selectAllSegments',
  'invertSelectedSegments',
  'selectAllMarkers',
  'selectSegmentsByLabel',
  'selectSegmentsByExpr',
  // Switching to another source, or opening one: the lock belongs to the source, not the window.
  'reloadFile',
  'closeCurrentFile',
  'openFilesDialog',
  'openDirDialog',
  'batchOpenSelectedFile',
  'batchOpenPreviousFile',
  'batchOpenNextFile',
  'batchOpenPlayPreviousFile',
  'batchOpenPlayNextFile',
  // Read-only helpers (they only read the video or write the waveform cache).
  'readAllKeyframes',
  'generateOverviewWaveform',
]);

/**
Fork-only actions the two lock lists do not know about.

`finish*` end the job (moving/deleting exactly the files the work area holds), `cleanupFilesDialog`
deletes the source, `decimate` writes a new file, and rotation / the forced next in point only
change what an export would produce.
*/
const patchWorkAreaExtraLockedActions = [
  'finish',
  'finishMerge',
  'finishCut',
  'finishKeepSource',
  'discardSource',
  'cleanupFilesDialog',
  'decimate',
  'increaseRotation',
  'toggleNewSegmentMark',
  'convertFormatBatch',
  'convertFormatCurrentFile',
  'concatBatch',
] as const satisfies readonly KeyboardAction[];

function buildPatchWorkAreaLockedActions(): KeyboardAction[] {
  const locked = new Set<KeyboardAction>([
    ...patchExportLockedActions,
    ...patchPlayerDisabledActions,
    ...patchWorkAreaExtraLockedActions,
  ]);
  for (const action of patchWorkAreaAllowedActions) locked.delete(action);
  return [...locked];
}

/** The actions the cutting window refuses while the source sits in a read-only folder. */
export const patchWorkAreaLockedActions: readonly KeyboardAction[] = buildPatchWorkAreaLockedActions();

type Noop = () => void;

/**
Replace the refused actions with `refused` (the folder dialog), leaving every other action - and
every patch-only action name that is not in the list - untouched.
*/
export function replacePatchWorkAreaActions<T extends Record<string, Noop>>(actions: T, refused: Noop): T {
  const patched: Record<string, Noop> = { ...actions };
  for (const action of patchWorkAreaLockedActions) {
    if (action in patched) patched[action] = refused;
  }
  return patched as T;
}
