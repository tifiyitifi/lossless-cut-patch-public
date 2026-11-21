// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { planFinishContinuation, planFinishFailureOutcome } from './continuation.js';

const previousSourcePath = '/videos/a.mp4';

function plan(overrides: Partial<Parameters<typeof planFinishContinuation>[0]> = {}) {
  return planFinishContinuation({
    next: 'next',
    nextPath: '/videos/b.mp4',
    previousSourcePath,
    newSourcePath: undefined,
    playerReleased: false,
    ...overrides,
  });
}

describe('planFinishContinuation', () => {
  it('opens the next existing source when the list has one', () => {
    expect(plan()).toStrictEqual({ kind: 'open-next', path: '/videos/b.mp4' });
  });

  it('keeps the last source open when there is no next source', () => {
    expect(plan({ nextPath: undefined })).toStrictEqual({ kind: 'stay', sourcePath: previousSourcePath, reload: false });
  });

  it('keeps the source open when the user chose "do nothing else" and a next exists', () => {
    expect(plan({ next: 'none' })).toStrictEqual({ kind: 'stay', sourcePath: previousSourcePath, reload: false });
  });

  it('follows the moved source and reloads it', () => {
    expect(plan({ nextPath: undefined, newSourcePath: '/work/detached/a.mp4' }))
      .toStrictEqual({ kind: 'stay', sourcePath: '/work/detached/a.mp4', reload: true });
  });

  it('keeps the last source open and follows it even when the user chose "do nothing else"', () => {
    expect(plan({ next: 'none', newSourcePath: '/work/finished/a.mp4' }))
      .toStrictEqual({ kind: 'stay', sourcePath: '/work/finished/a.mp4', reload: true });
  });

  it('reloads the same path after the player was released for a file operation', () => {
    expect(plan({ nextPath: undefined, playerReleased: true }))
      .toStrictEqual({ kind: 'stay', sourcePath: previousSourcePath, reload: true });
  });

  it('does not reopen the same source as "next"', () => {
    expect(plan({ nextPath: previousSourcePath })).toStrictEqual({ kind: 'stay', sourcePath: previousSourcePath, reload: false });
  });
});

describe('planFinishFailureOutcome', () => {
  const failure = (overrides: Partial<Parameters<typeof planFinishFailureOutcome>[0]> = {}) => planFinishFailureOutcome({
    previousSourcePath,
    newSourcePath: undefined,
    playerReleased: false,
    ...overrides,
  });

  it('keeps the window where it is when the attempt moved nothing', () => {
    expect(failure()).toStrictEqual({ sourcePath: previousSourcePath, batch: undefined, moved: false, reload: false });
  });

  it('repoints the batch entry and the player when the source moved before the job stopped', () => {
    // The retry runs from the manifest record of the source: it has to be found under the new path,
    // and the cutting window has to play the file that is really there.
    expect(failure({ newSourcePath: '/work/detached/a.mp4' })).toStrictEqual({
      sourcePath: '/work/detached/a.mp4',
      batch: { from: previousSourcePath, to: '/work/detached/a.mp4' },
      moved: true,
      reload: true,
    });
  });

  it('reloads the same path when only the player was released', () => {
    expect(failure({ playerReleased: true })).toStrictEqual({
      sourcePath: previousSourcePath,
      batch: undefined,
      moved: false,
      reload: true,
    });
  });

  it('does not treat the source staying at its path as a move', () => {
    expect(failure({ newSourcePath: previousSourcePath, playerReleased: true }).moved).toBe(false);
  });
});
