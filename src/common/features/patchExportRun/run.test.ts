// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, test } from 'vitest';

import {
  finishPatchExportRun, isPatchExportRunRunning, setPatchExportRunProgress, startPatchExportRun,
} from './run.js';

describe('startPatchExportRun', () => {
  test('starts running with no progress yet', () => {
    const run = startPatchExportRun();

    expect(run).toStrictEqual({ progress: undefined, phase: 'running' });
    expect(isPatchExportRunRunning(run)).toBe(true);
  });
});

describe('isPatchExportRunRunning', () => {
  test('is false for no run and for a finished one', () => {
    expect(isPatchExportRunRunning(undefined)).toBe(false);
    expect(isPatchExportRunRunning(finishPatchExportRun(startPatchExportRun(), 'done'))).toBe(false);
    expect(isPatchExportRunRunning(finishPatchExportRun(startPatchExportRun(), 'failed'))).toBe(false);
  });
});

describe('setPatchExportRunProgress', () => {
  test('clamps the reported progress to 0..1', () => {
    const run = startPatchExportRun();
    expect(setPatchExportRunProgress(run, 0.5).progress).toBe(0.5);
    expect(setPatchExportRunProgress(run, 1.4).progress).toBe(1);
    expect(setPatchExportRunProgress(run, -1).progress).toBe(0);
  });

  test('ignores a report that is not a number and a run that already finished', () => {
    const run = startPatchExportRun();
    expect(setPatchExportRunProgress(run, NaN)).toBe(run);

    const done = { ...finishPatchExportRun(run, 'done'), progress: 1 };
    expect(setPatchExportRunProgress(done, 0.2)).toBe(done);
  });
});

describe('finishPatchExportRun', () => {
  test('records the phase and keeps the progress', () => {
    const run = setPatchExportRunProgress(startPatchExportRun(), 0.7);
    const finished = finishPatchExportRun(run, 'failed');
    expect(finished.phase).toBe('failed');
    expect(finished.progress).toBe(0.7);
  });
});
