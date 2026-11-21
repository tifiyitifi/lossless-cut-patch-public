// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { BatchSortKey } from './sort.js';
import { pruneUnavailableSortKeys } from './unavailable.js';

const a = String.raw`C:\work\inbox\a.mp4`;
const b = String.raw`C:\work\inbox\b.mp4`;
const c = String.raw`C:\work\inbox\c.mkv`;

const file = (path: string) => ({ name: path.slice(path.lastIndexOf('\\') + 1), path });

describe('pruneUnavailableSortKeys', () => {
  it('keeps a key disabled while a file that failed is still listed', () => {
    const failures = new Map<BatchSortKey, ReadonlySet<string>>([['duration', new Set([a, b])]]);
    const pruned = pruneUnavailableSortKeys(failures, [file(b), file(c)]);
    expect([...pruned.keys()]).toStrictEqual(['duration']);
    expect([...pruned.get('duration')!]).toStrictEqual([b]);
  });

  it('re-enables a key when the whole failing batch is gone', () => {
    const failures = new Map<BatchSortKey, ReadonlySet<string>>([['duration', new Set([a, b])]]);
    expect(pruneUnavailableSortKeys(failures, [file(c)]).size).toBe(0);
  });

  it('follows each key on its own', () => {
    const failures = new Map<BatchSortKey, ReadonlySet<string>>([
      ['duration', new Set([a])],
      ['size', new Set([b])],
      ['mtime', new Set([b])],
    ]);
    const pruned = pruneUnavailableSortKeys(failures, [file(a)]);
    expect([...pruned.keys()]).toStrictEqual(['duration']);
  });

  it('never mutates the map it was given', () => {
    const failed = new Set([a, b]);
    const failures = new Map<BatchSortKey, ReadonlySet<string>>([['duration', failed]]);
    pruneUnavailableSortKeys(failures, [file(b)]);
    expect([...failed]).toStrictEqual([a, b]);
    expect(failures.size).toBe(1);
  });

  it('returns an empty map for an empty list and for no failures', () => {
    expect(pruneUnavailableSortKeys(new Map(), [file(a)]).size).toBe(0);
    expect(pruneUnavailableSortKeys(new Map([['duration', new Set([a])]]), []).size).toBe(0);
  });
});
