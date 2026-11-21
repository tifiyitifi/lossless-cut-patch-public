// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { KeyboardAction } from '../../types.js';
import { disablePatchPlayerActions, patchPlayerDisabledActions } from './playerMode.js';

function makeActions(actions: readonly KeyboardAction[]) {
  const calls: string[] = [];
  const built = Object.fromEntries(actions.map((action) => [action, () => { calls.push(action); }]));
  return { actions: built as Record<string, () => void>, calls };
}

describe('patchPlayerDisabledActions', () => {
  it('disables the cut-point marking and the export', () => {
    expect(patchPlayerDisabledActions).toStrictEqual(expect.arrayContaining([
      'setCutStart',
      'setCutEnd',
      'removeCurrentCutpoint',
      'splitCurrentSegment',
      'addSegment',
      'removeCurrentSegment',
      'export',
    ]));
  });

  it('keeps the analysis (detection) actions available', () => {
    expect(patchPlayerDisabledActions).not.toContain('detectBlackScenes');
    expect(patchPlayerDisabledActions).not.toContain('detectSilentScenes');
    expect(patchPlayerDisabledActions).not.toContain('detectSceneChanges');
    expect(patchPlayerDisabledActions).not.toContain('readAllKeyframes');
    expect(patchPlayerDisabledActions).not.toContain('createSegmentsFromKeyframes');
  });

  it('has no duplicates', () => {
    expect(new Set(patchPlayerDisabledActions).size).toBe(patchPlayerDisabledActions.length);
  });
});

describe('disablePatchPlayerActions', () => {
  it('turns the disabled actions into no-ops and keeps the others', () => {
    const { actions, calls } = makeActions(['setCutStart', 'setCutEnd', 'export', 'togglePlayNoResetSpeed']);

    const patched = disablePatchPlayerActions(actions);
    expect(Object.keys(patched)).toStrictEqual(Object.keys(actions));
    Object.values(patched).forEach((fn) => { fn(); });

    expect(calls).toStrictEqual(['togglePlayNoResetSpeed']);
  });

  it('does not touch actions that are not part of the map', () => {
    const { actions } = makeActions(['togglePlayNoResetSpeed']);
    const patched = disablePatchPlayerActions(actions);
    expect(patched).toStrictEqual(actions);
  });

  it('does not mutate the input', () => {
    const { actions, calls } = makeActions(['setCutStart']);
    disablePatchPlayerActions(actions);
    actions['setCutStart']!();
    expect(calls).toStrictEqual(['setCutStart']);
  });
});
