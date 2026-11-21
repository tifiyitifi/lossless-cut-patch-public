import type { KeyboardAction } from '../../types.js';

/**
What an export in this window locks (pure, fork-owned).

The in-flight export is a snapshot of the cut list. Two kinds of changes break the promise the
user sees on screen ("these are the results"):

- edits of the cut list (times, labels, order, selection) - the export would still cut the old
  list, and the next export would find a different one;
- anything that replaces the open file or starts another ffmpeg job - the export's source would
  change under it, and the app already refuses to run two jobs at once.

Seeking, playing, zooming, screenshots and the read-only helpers stay available: they do not
change what is being cut. The list is a **denylist** on purpose: a new read-only action should
not need an entry here.
*/
export const patchExportLockedActions: ReadonlySet<KeyboardAction> = new Set<KeyboardAction>([
  // The cut list itself.
  'setCutStart',
  'setCutEnd',
  'addSegment',
  'removeCurrentSegment',
  'removeCurrentCutpoint',
  'splitCurrentSegment',
  'duplicateCurrentSegment',
  'labelCurrentSegment',
  'labelSelectedSegments',
  'editCurrentSegmentTags',
  'reorderSegsByStartTime',
  'invertAllSegments',
  'fillSegmentsGaps',
  'combineOverlappingSegments',
  'combineSelectedSegments',
  'createFixedDurationSegments',
  'createNumSegments',
  'createFixedByteSizedSegments',
  'createRandomSegments',
  'shuffleSegments',
  'clearSegments',
  'shiftAllSegmentTimes',
  'fixInvalidDuration',
  'alignSegmentTimesToKeyframes',
  'undo',
  'redo',
  // Which segments are exported is part of the snapshot too.
  'selectSegmentsAtCursor',
  'selectOnlyCurrentSegment',
  'toggleCurrentSegmentSelected',
  'deselectAllSegments',
  'selectAllSegments',
  'invertSelectedSegments',
  'removeSelectedSegments',
  'selectAllMarkers',
  'selectSegmentsByLabel',
  'selectSegmentsByExpr',
  'mutateSegmentsByExpr',
  // Anything that starts another ffmpeg job or replaces the open file.
  'export',
  'html5ify',
  'reloadFile',
  'closeCurrentFile',
  'openFilesDialog',
  'openDirDialog',
  // The overlay no longer covers the bottom bar and the title bar, so the mouse reaches these too:
  // the cleanup dialog moves/deletes the very files the export writes, and the streams selector is
  // part of the export's snapshot.
  'cleanupFilesDialog',
  'toggleStreamsSelector',
  'batchOpenSelectedFile',
  'batchOpenPreviousFile',
  'batchOpenNextFile',
  'batchOpenPlayPreviousFile',
  'batchOpenPlayNextFile',
  'detectBlackScenes',
  'detectSilentScenes',
  'detectSceneChanges',
  'createSegmentsFromKeyframes',
  'extractAllStreams',
  'extractCurrentSegmentFramesAsImages',
  'extractSelectedSegmentsFramesAsImages',
  'readAllKeyframes',
  'generateOverviewWaveform',
  'mergeCutResults',
  // Discarding moves the source and its results: the export writes into the same work area.
  'discardSource',
  // Finishing moves the same files the export writes, whatever the source choice - and all four
  // keys end in `openFinish`. The guard in `openInCuttingWindow` only covers the cutting window's
  // own `isWorking()`; this list is the gate the export lock owns, so the refusal (and its toast)
  // comes from one place and the keyboard, the menu/IPC router and the console all agree.
  'finish',
  'finishMerge',
  'finishCut',
  'finishKeepSource',
]);

/** Should this action be refused while an export runs? */
export function shouldBlockPatchExportAction({ action, exporting }: {
  action: KeyboardAction;
  exporting: boolean;
}): boolean {
  return exporting && patchExportLockedActions.has(action);
}

/** One exported segment, as the comparison sees it. */
export interface PatchExportListEntry {
  segId: string;
  start: number;
  end: number | undefined;
  label: string | undefined;
}

/**
Project the exported segments into the comparable form.

Only what changes the produced file is compared: the identity (so a segment can be followed), its
times, its label (it is part of the file name) and the order (it is the merge order and the
`{n}` numbering).
*/
export function planPatchExportListSnapshot(segments: readonly {
  segId: string;
  start: number;
  end?: number | undefined;
  name?: string | undefined;
}[]): PatchExportListEntry[] {
  return segments.map(({ segId, start, end, name }) => ({ segId, start, end, label: name }));
}

/**
How the cut list differs from the snapshot an export was planned from.

`added`/`removed` follow the identity, `edited` the times and labels of a segment that stayed,
`reordered` a change of the sequence (an unchanged set in another order). Any of them means the
results match the list from before the export, not the one on screen now.
*/
export function detectPatchExportListChange({ before, after }: {
  before: readonly PatchExportListEntry[];
  after: readonly PatchExportListEntry[];
}): { changed: boolean, added: string[], removed: string[], edited: string[], reordered: boolean } {
  const beforeById = new Map(before.map((entry) => [entry.segId, entry]));
  const afterById = new Map(after.map((entry) => [entry.segId, entry]));

  const added = after.filter((entry) => !beforeById.has(entry.segId)).map((entry) => entry.segId);
  const removed = before.filter((entry) => !afterById.has(entry.segId)).map((entry) => entry.segId);
  const edited = before
    .filter((entry) => {
      const now = afterById.get(entry.segId);
      return now != null && (now.start !== entry.start || now.end !== entry.end || (now.label ?? '') !== (entry.label ?? ''));
    })
    .map((entry) => entry.segId);

  const commonBefore = before.filter((entry) => afterById.has(entry.segId)).map((entry) => entry.segId);
  const commonAfter = after.filter((entry) => beforeById.has(entry.segId)).map((entry) => entry.segId);
  const reordered = commonBefore.length === commonAfter.length && commonBefore.some((segId, index) => segId !== commonAfter[index]);

  return {
    changed: added.length > 0 || removed.length > 0 || edited.length > 0 || reordered,
    added,
    removed,
    edited,
    reordered,
  };
}
