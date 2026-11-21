import type { KeyboardAction } from '../../types.js';
import type { PatchIntent } from './commands.js';

/**
Patch intents that map onto an upstream (base) keyboard action.

This is the bridge that lets a patch-style name run a base feature: typing `addSegment`,
`add-segment` or a legacy code such as `xc` all end up at a base action the app already has.
Intents that are missing here are patch *flow* intents (cut-and-merge, post-processing, ...) and
stay unwired until the matching patch step lands.
*/
export const patchIntentToBaseAction: Partial<Record<PatchIntent, KeyboardAction>> = {
  // Transport
  'play-pause': 'togglePlayResetSpeed',
  fullscreen: 'toggleFullscreenVideo',
  mute: 'toggleMuted',
  'seek-back': 'seekBackwards',
  'seek-forward': 'seekForwards',
  'volume-up': 'increaseVolume',
  'volume-down': 'decreaseVolume',
  'frame-next': 'seekNextFrame',
  'frame-prev': 'seekPreviousFrame',
  'rate-down': 'reducePlaybackRate',
  'rate-up': 'increasePlaybackRate',

  // Cutting
  'set-cut-start': 'setCutStart',
  'set-cut-end': 'setCutEnd',
  'split-segment': 'splitCurrentSegment',
  'add-segment': 'addSegment',
  'remove-segment': 'removeCurrentSegment',
  cut: 'export',
  // patch: merge the cut results of the current source (the results window's `e`).
  merge: 'mergeCutResults',
  // patch: end the job (the finish dialogs; `zm` / `zc` in the console).
  'post-process-merge': 'finishMerge',
  'post-process-cut': 'finishCut',

  // Segments
  'prev-segment': 'jumpPrevSegment',
  'next-segment': 'jumpNextSegment',
  'select-all-segments': 'selectAllSegments',
  'clear-selection': 'deselectAllSegments',
  'invert-selection': 'invertSelectedSegments',
  'play-selected': 'togglePlaySelectedSegments',
  'toggle-select': 'toggleCurrentSegmentSelected',
  'detect-black-scenes': 'detectBlackScenes',
  'detect-silent-scenes': 'detectSilentScenes',
  'detect-scene-changes': 'detectSceneChanges',
  'segments-from-keyframes': 'createSegmentsFromKeyframes',
  'invert-segments': 'invertAllSegments',
  'fill-segment-gaps': 'fillSegmentsGaps',
  'combine-overlapping-segments': 'combineOverlappingSegments',
  'reorder-segments': 'reorderSegsByStartTime',

  // Files
  'prev-file': 'batchOpenPreviousFile',
  'next-file': 'batchOpenNextFile',

  // Output / tracks
  snapshot: 'captureSnapshot',
  'snapshot-clipboard': 'captureSnapshotToClipboard',
  'extract-all-streams': 'extractAllStreams',
  html5ify: 'html5ify',
  decimate: 'decimate',
  'fix-invalid-duration': 'fixInvalidDuration',
  'concat-batch': 'concatBatch',
  'convert-batch': 'convertFormatBatch',
};

/** The base action behind a patch intent, or `undefined` when the intent is not wired yet. */
export function getBaseActionForIntent(intent: PatchIntent): KeyboardAction | undefined {
  return patchIntentToBaseAction[intent];
}

/** Patch intents the console recognises but cannot run yet (they wait for their patch step). */
export function isUnwiredIntent(intent: PatchIntent) {
  return getBaseActionForIntent(intent) == null;
}
