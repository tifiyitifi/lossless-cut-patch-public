import type { KeyboardAction } from '../../types.js';
/**
Extra keyboard actions the merged-result window does not run (fork-owned).

The merged window is a player window as well (see `playerMode`), so the player disablements
already apply there. Its chapters are derived from the cut results at merge time and are
strictly read-only: they can never be edited, relabelled, regenerated from detection, or
removed - not even with Backspace/Delete. Only a new merge refreshes them.
*/
export const patchMergedDisabledActions = [
  // Deleting the displayed chapters (Backspace is already `jumpTimelineStart` there).
  'removeSelectedSegments',
  // Relabelling the displayed chapters.
  'labelCurrentSegment',
  'labelSelectedSegments',
  'editCurrentSegmentTags',
  // Rewriting the displayed chapters from history or detection.
  'undo',
  'redo',
  'createSegmentsFromKeyframes',
  'detectBlackScenes',
  'detectSilentScenes',
  'detectSceneChanges',
  'readAllKeyframes',
  // Rewriting the displayed chapters with generated or transformed segments.
  'createFixedDurationSegments',
  'createNumSegments',
  'createFixedByteSizedSegments',
  'createRandomSegments',
  'reorderSegsByStartTime',
  'invertAllSegments',
  'fillSegmentsGaps',
  'combineOverlappingSegments',
  'combineSelectedSegments',
  'alignSegmentTimesToKeyframes',
  'shuffleSegments',
  'shiftAllSegmentTimes',
  'mutateSegmentsByExpr',
] as const satisfies readonly KeyboardAction[];

type Noop = () => void;

/** Replace the merged-only disabled actions with no-ops, leaving every other action untouched. */
export function disablePatchMergedActions<T extends Record<string, Noop>>(actions: T): T {
  const patched: Record<string, Noop> = { ...actions };
  for (const action of patchMergedDisabledActions) {
    if (action in patched) patched[action] = () => undefined;
  }
  return patched as T;
}
