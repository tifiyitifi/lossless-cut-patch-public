// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import {
  describePatchCheckHeader,
  getPatchCheckPercent,
  summarizePatchCheckOutcomes,
} from './checkProgress.js';

describe('getPatchCheckPercent', () => {
  it('rounds the decoded share to a whole percentage', () => {
    expect(getPatchCheckPercent(0)).toBe(0);
    expect(getPatchCheckPercent(0.456)).toBe(46);
    expect(getPatchCheckPercent(1)).toBe(100);
  });

  it('stays inside 0..100, because FFmpeg can report a little past the duration', () => {
    expect(getPatchCheckPercent(1.02)).toBe(100);
    expect(getPatchCheckPercent(-0.01)).toBe(0);
  });

  it('has no percentage while the duration is unknown', () => {
    expect(getPatchCheckPercent(undefined)).toBeUndefined();
    expect(getPatchCheckPercent(NaN)).toBeUndefined();
    expect(getPatchCheckPercent(Infinity)).toBeUndefined();
  });
});

describe('describePatchCheckHeader', () => {
  it('leaves both columns alone when no batch runs', () => {
    expect(describePatchCheckHeader({ ownerKind: undefined, kind: 'source', running: false })).toStrictEqual({ state: 'idle' });
    expect(describePatchCheckHeader({ ownerKind: 'result', kind: 'source', running: false })).toStrictEqual({ state: 'idle' });
  });

  it('shows the running file in the column that started the batch', () => {
    expect(describePatchCheckHeader({ ownerKind: 'source', kind: 'source', running: true, ratio: 0.5 })).toStrictEqual({ state: 'running', percent: 50 });
    expect(describePatchCheckHeader({ ownerKind: 'source', kind: 'source', running: true })).toStrictEqual({ state: 'running', percent: undefined });
  });

  it('blocks the other column instead of claiming a check of its files', () => {
    expect(describePatchCheckHeader({ ownerKind: 'source', kind: 'result', running: true, ratio: 0.5 })).toStrictEqual({ state: 'blocked' });
    expect(describePatchCheckHeader({ ownerKind: 'result', kind: 'source', running: true })).toStrictEqual({ state: 'blocked' });
  });
});

describe('summarizePatchCheckOutcomes', () => {
  it('counts every outcome separately', () => {
    expect(summarizePatchCheckOutcomes(['ok', 'ok', 'failed', 'canceled', 'unavailable'])).toStrictEqual({
      total: 5,
      passed: 2,
      failed: 1,
      stopped: 1,
      unavailable: 1,
    });
  });

  it('has nothing to say about a batch that never got a phase', () => {
    expect(summarizePatchCheckOutcomes([])).toStrictEqual({ total: 0, passed: 0, failed: 0, stopped: 0, unavailable: 0 });
  });

  it('ignores phases that are not an outcome', () => {
    // A card that is still idle or running was not decoded by this batch, so the summary must not
    // count it as passed or failed.
    expect(summarizePatchCheckOutcomes(['idle', 'running', 'ok'])).toStrictEqual({ total: 1, passed: 1, failed: 0, stopped: 0, unavailable: 0 });
  });
});
