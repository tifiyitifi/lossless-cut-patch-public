// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { patchWorkAreaAllowedActions, patchWorkAreaLockedActions, replacePatchWorkAreaActions } from './workAreaLock.js';

describe('patchWorkAreaLockedActions', () => {
  it('refuses the cutting itself', () => {
    expect(patchWorkAreaLockedActions).toStrictEqual(expect.arrayContaining([
      'setCutStart',
      'setCutEnd',
      'removeCurrentCutpoint',
      'splitCurrentSegment',
      'addSegment',
      'duplicateCurrentSegment',
      'clearSegments',
      'toggleNewSegmentMark',
    ]));
  });

  it('refuses every way of producing or moving finished files', () => {
    expect(patchWorkAreaLockedActions).toStrictEqual(expect.arrayContaining([
      'export',
      'exportForce',
      'exportYouTube',
      'mergeCutResults',
      'finish',
      'finishMerge',
      'finishCut',
      'finishKeepSource',
      'discardSource',
      'cleanupFilesDialog',
      'concatBatch',
      'convertFormatBatch',
    ]));
  });

  it('refuses the cut-list edits the player lock never covered', () => {
    expect(patchWorkAreaLockedActions).toStrictEqual(expect.arrayContaining([
      'labelCurrentSegment',
      'labelSelectedSegments',
      'editCurrentSegmentTags',
      'reorderSegsByStartTime',
      'invertAllSegments',
      'fillSegmentsGaps',
      'shiftAllSegmentTimes',
      'removeSelectedSegments',
      'mutateSegmentsByExpr',
      'undo',
      'redo',
    ]));
  });

  it('keeps playback, seeking and the view controls working', () => {
    expect(patchWorkAreaLockedActions).not.toStrictEqual(expect.arrayContaining([
      'togglePlayResetSpeed',
      'togglePlayNoResetSpeed',
      'play',
      'pause',
      'seekBackwards',
      'seekForwards',
      'seekBackwardsKeyframe',
      'seekForwardsKeyframe',
      'seekPreviousFrame',
      'seekNextFrame',
      'jumpTimelineStart',
      'jumpTimelineEnd',
      'jumpCutStart',
      'jumpCutEnd',
      'jumpSeekNextSegment',
      'timelineZoomIn',
      'timelineZoomOut',
      'toggleWaveformMode',
      'toggleShowThumbnails',
      'toggleShowKeyframes',
      'toggleFullscreenVideo',
      'captureSnapshot',
      'increaseVolume',
      'toggleMuted',
      'toggleKeyframeCutMode',
    ]));
  });

  it('keeps segment selection and the segment walk working', () => {
    expect(patchWorkAreaLockedActions).not.toStrictEqual(expect.arrayContaining([...patchWorkAreaAllowedActions]));
  });

  it('keeps the source switching working, with and without playback', () => {
    // A finished source is read-only, not stuck: the lock belongs to the source, not the window, so
    // the user can still walk on to the next one - and the open-and-play keys are switches too.
    expect(patchWorkAreaLockedActions).not.toStrictEqual(expect.arrayContaining([
      'batchOpenPreviousFile',
      'batchOpenNextFile',
      'batchOpenPlayPreviousFile',
      'batchOpenPlayNextFile',
    ]));
  });

  it('lists every action once', () => {
    expect(new Set(patchWorkAreaLockedActions).size).toBe(patchWorkAreaLockedActions.length);
  });
});

describe('replacePatchWorkAreaActions', () => {
  it('routes the refused actions to the dialog', () => {
    const refused = () => 'dialog';
    const actions = { setCutStart: () => 'cut', export: () => 'export' } as Record<string, () => string>;
    const patched = replacePatchWorkAreaActions(actions, refused);
    expect(patched['setCutStart']!()).toBe('dialog');
    expect(patched['export']!()).toBe('dialog');
  });

  it('leaves playback and actions the window does not have alone', () => {
    const refused = () => 'dialog';
    const actions = { togglePlayResetSpeed: () => 'play', seekForwards: () => 'seek' } as Record<string, () => string>;
    const patched = replacePatchWorkAreaActions(actions, refused);
    expect(patched['togglePlayResetSpeed']!()).toBe('play');
    expect(patched['seekForwards']!()).toBe('seek');
    expect('setCutStart' in patched).toBe(false);
  });
});
