// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, test } from 'vitest';

import {
  detectPatchExportListChange, patchExportLockedActions, planPatchExportListSnapshot, shouldBlockPatchExportAction,
} from './policy.js';

describe('shouldBlockPatchExportAction', () => {
  test('refuses cut-list edits and selection changes while an export runs', () => {
    for (const action of ['setCutStart', 'setCutEnd', 'addSegment', 'removeCurrentSegment', 'undo', 'redo', 'clearSegments', 'selectAllSegments', 'toggleCurrentSegmentSelected', 'mutateSegmentsByExpr'] as const) {
      expect(shouldBlockPatchExportAction({ action, exporting: true })).toBe(true);
    }
  });

  test('refuses file switches, a second export and other ffmpeg work while an export runs', () => {
    for (const action of ['export', 'reloadFile', 'closeCurrentFile', 'openFilesDialog', 'batchOpenNextFile', 'batchOpenPlayNextFile', 'detectSceneChanges', 'extractAllStreams', 'html5ify', 'cleanupFilesDialog', 'toggleStreamsSelector'] as const) {
      expect(shouldBlockPatchExportAction({ action, exporting: true })).toBe(true);
    }
  });

  test('refuses every finish key while an export runs (they move the files the export writes)', () => {
    for (const action of ['finish', 'finishMerge', 'finishCut', 'finishKeepSource'] as const) {
      expect(shouldBlockPatchExportAction({ action, exporting: true })).toBe(true);
    }
  });

  test('leaves seeking, playback and read-only helpers alone', () => {
    for (const action of ['seekForwards', 'seekBackwards', 'jumpCutStart', 'jumpCutEnd', 'togglePlayNoResetSpeed', 'timelineZoomIn', 'captureSnapshot', 'copySegmentsToClipboard', 'goToTimecode', 'toggleKeyboardShortcuts', 'seekNextFrame', 'seekPreviousFrame', 'togglePlaybackRate', 'jumpSeekNextSegment', 'jumpSeekPrevSegment'] as const) {
      expect(shouldBlockPatchExportAction({ action, exporting: true })).toBe(false);
    }
  });

  test('blocks nothing while no export runs', () => {
    for (const action of patchExportLockedActions) {
      expect(shouldBlockPatchExportAction({ action, exporting: false })).toBe(false);
    }
  });
});

describe('planPatchExportListSnapshot', () => {
  test('keeps the identity, the times, the label and the order', () => {
    expect(planPatchExportListSnapshot([
      { segId: 'a', start: 1, end: 2, name: 'first' },
      { segId: 'b', start: 3, name: undefined },
    ])).toStrictEqual([
      { segId: 'a', start: 1, end: 2, label: 'first' },
      { segId: 'b', start: 3, end: undefined, label: undefined },
    ]);
  });
});

describe('detectPatchExportListChange', () => {
  const entry = (segId: string, start: number, end: number, label?: string) => ({ segId, start, end, label });

  test('an unchanged list is no change', () => {
    const list = [entry('a', 0, 5, 'x'), entry('b', 5, 9)];
    expect(detectPatchExportListChange({ before: list, after: list.map((item) => ({ ...item })) })).toStrictEqual({
      changed: false, added: [], removed: [], edited: [], reordered: false,
    });
  });

  test('a moved cut point or a new label is an edit', () => {
    const before = [entry('a', 0, 5, 'x')];
    expect(detectPatchExportListChange({ before, after: [entry('a', 0, 6, 'x')] })).toMatchObject({ changed: true, edited: ['a'] });
    expect(detectPatchExportListChange({ before, after: [entry('a', 0, 5, 'y')] })).toMatchObject({ changed: true, edited: ['a'] });
    expect(detectPatchExportListChange({ before: [entry('a', 0, 5)], after: [entry('a', 0, 5, 'y')] })).toMatchObject({ changed: true, edited: ['a'] });
  });

  test('added and removed segments follow the identity', () => {
    const before = [entry('a', 0, 5), entry('b', 5, 9)];
    expect(detectPatchExportListChange({ before, after: [before[0]!] })).toMatchObject({ changed: true, removed: ['b'], added: [] });
    expect(detectPatchExportListChange({ before: [before[0]!], after: before })).toMatchObject({ changed: true, added: ['b'], removed: [] });
  });

  test('a new selection changes the exported list (the unselected segment leaves it)', () => {
    const before = [entry('a', 0, 5), entry('b', 5, 9)];
    expect(detectPatchExportListChange({ before, after: [before[0]!] })).toMatchObject({ changed: true, removed: ['b'] });
  });

  test('an unchanged set in another order is a reorder', () => {
    const before = [entry('a', 0, 5), entry('b', 5, 9)];
    expect(detectPatchExportListChange({ before, after: [before[1]!, before[0]!] })).toMatchObject({
      changed: true, reordered: true, added: [], removed: [], edited: [],
    });
  });
});
