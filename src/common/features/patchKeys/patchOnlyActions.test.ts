// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { isPatchModeOnlyAction, patchModeOnlyActions } from './patchOnlyActions.js';

describe('patchModeOnlyActions', () => {
  it('is the pinned list of actions that do nothing outside patch mode', () => {
    // Pinned on purpose: an action joins or leaves this list only when the guard behind it changes,
    // which is a decision someone has to make here.
    expect([...patchModeOnlyActions].sort()).toStrictEqual([
      'discardSource',
      'finish',
      'finishCut',
      'finishKeepSource',
      'finishMerge',
      'mergeCutResults',
      'playlistFirst',
      'playlistLast',
      'playlistNext',
      'playlistPrev',
      'renameResultFull',
      'renameResultLabel',
      'togglePatchCommandConsole',
      'togglePatchMenuBar',
    ]);
  });

  it('leaves the actions that also work in base mode alone', () => {
    for (const action of ['export', 'exportForce', 'jumpSegmentEndPreview', 'batchOpenPlayNextFile', 'resetPlaybackRate', 'toggleNewSegmentMark'] as const) {
      expect(isPatchModeOnlyAction(action)).toBe(false);
    }
  });

  it('answers for the patch-only actions', () => {
    expect(isPatchModeOnlyAction('finish')).toBe(true);
    expect(isPatchModeOnlyAction('togglePatchCommandConsole')).toBe(true);
  });
});
