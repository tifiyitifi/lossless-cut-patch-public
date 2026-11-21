// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { parsePendingUpdate, pendingUpdateOutcome } from './pending.js';

const record = {
  from: '3.70.2-patch.1',
  to: '3.70.2-patch.2',
  packagePath: String.raw`C:\updates\LosslessCut-Patch-win-x64.zip`,
  startedAt: '2026-11-13T10:00:00.000Z',
};

describe('parsePendingUpdate', () => {
  it('reads a record the app wrote', () => {
    expect(parsePendingUpdate(record)).toStrictEqual(record);
  });

  it('rejects a payload that does not name the target version', () => {
    expect(parsePendingUpdate({})).toBeUndefined();
    expect(parsePendingUpdate({ to: '  ' })).toBeUndefined();
    expect(parsePendingUpdate(null)).toBeUndefined();
    expect(parsePendingUpdate('pending')).toBeUndefined();
  });

  it('keeps a record whose optional fields are missing, so a hand-edited file still reports', () => {
    expect(parsePendingUpdate({ to: '3.70.2-patch.2' })).toStrictEqual({
      from: '',
      to: '3.70.2-patch.2',
      packagePath: '',
      startedAt: '',
    });
  });
});

describe('pendingUpdateOutcome', () => {
  const pending = parsePendingUpdate(record)!;

  it('is applied when the running build is the version that was handed over', () => {
    expect(pendingUpdateOutcome({ runningVersion: '3.70.2-patch.2', pending })).toBe('applied');
  });

  it('is applied when the running build is newer, e.g. after a manual install', () => {
    expect(pendingUpdateOutcome({ runningVersion: '3.70.2-patch.3', pending })).toBe('applied');
  });

  it('is not applied when the app came back on the old files', () => {
    expect(pendingUpdateOutcome({ runningVersion: '3.70.2-patch.1', pending })).toBe('notApplied');
  });

  it('is not applied when the version cannot be compared', () => {
    expect(pendingUpdateOutcome({ runningVersion: 'dev', pending })).toBe('notApplied');
  });

  it('compares fork patch numbers, not just the upstream version', () => {
    expect(pendingUpdateOutcome({ runningVersion: '3.70.2-patch.1', pending: { ...pending, to: '3.70.2-patch.1' } })).toBe('applied');
    expect(pendingUpdateOutcome({ runningVersion: '3.70.2-patch.1', pending: { ...pending, to: '3.70.2' } })).toBe('notApplied');
  });
});
