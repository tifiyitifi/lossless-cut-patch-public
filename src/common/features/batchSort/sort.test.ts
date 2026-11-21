// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { BatchFileSortMeta, BatchSortSpec } from './sort.js';
import { getSortDirection, getSortExtension, isKnownSortValue, isManualSortSpec, metaFieldsForSortKey, nextSortSpec, pruneBatchSortMeta, sortBatchFiles } from './sort.js';

/** One row per file name, with the Windows-shaped path the list really holds. */
const pathByName: Record<string, string> = {
  'a.mkv': String.raw`C:\work\inbox\a.mkv`,
  'a.mp4': String.raw`C:\work\inbox\a.mp4`,
  'b.mkv': String.raw`C:\work\inbox\b.mkv`,
  'b.mp4': String.raw`C:\work\inbox\b.mp4`,
  'b2.mp4': String.raw`C:\work\inbox\b2.mp4`,
  'b10.mp4': String.raw`C:\work\inbox\b10.mp4`,
  'c.MP4': String.raw`C:\work\inbox\c.MP4`,
  'c.mp4': String.raw`C:\work\inbox\c.mp4`,
};

const file = (name: string) => ({ name, path: pathByName[name]! });

const files = [file('b10.mp4'), file('b2.mp4'), file('a.mkv'), file('c.MP4')];

const meta: Record<string, BatchFileSortMeta> = {
  [pathByName['b10.mp4']!]: { size: 30, mtime: 3000, duration: 3 },
  [pathByName['b2.mp4']!]: { size: 10, mtime: 1000, duration: 10 },
  [pathByName['a.mkv']!]: { size: 20, mtime: 2000, duration: 7 },
  // c.MP4 is deliberately unreadable: no meta at all.
};

const metaFor = (path: string) => meta[path];

const names = (list: { name: string }[]) => list.map((item) => item.name);

describe('sortBatchFiles', () => {
  it('sorts names naturally (2 before 10), like the upstream toggle', () => {
    expect(names(sortBatchFiles(files, { key: 'name', direction: 'asc' }, metaFor))).toStrictEqual(['a.mkv', 'b2.mp4', 'b10.mp4', 'c.MP4']);
  });

  it('reverses the name order for desc', () => {
    expect(names(sortBatchFiles(files, { key: 'name', direction: 'desc' }, metaFor))).toStrictEqual(['c.MP4', 'b10.mp4', 'b2.mp4', 'a.mkv']);
  });

  it('groups by extension, ascending and descending, with the name inside a group', () => {
    const list = [file('b.mkv'), file('a.mp4'), file('c.mp4'), file('a.mkv')];
    expect(names(sortBatchFiles(list, { key: 'ext', direction: 'asc' }, metaFor))).toStrictEqual(['a.mkv', 'b.mkv', 'a.mp4', 'c.mp4']);
    expect(names(sortBatchFiles(list, { key: 'ext', direction: 'desc' }, metaFor))).toStrictEqual(['c.mp4', 'a.mp4', 'b.mkv', 'a.mkv']);
  });

  it('sorts by size in both directions and keeps the unreadable file last', () => {
    expect(names(sortBatchFiles(files, { key: 'size', direction: 'asc' }, metaFor))).toStrictEqual(['b2.mp4', 'a.mkv', 'b10.mp4', 'c.MP4']);
    expect(names(sortBatchFiles(files, { key: 'size', direction: 'desc' }, metaFor))).toStrictEqual(['b10.mp4', 'a.mkv', 'b2.mp4', 'c.MP4']);
  });

  it('sorts by modification time and duration the same way', () => {
    expect(names(sortBatchFiles(files, { key: 'mtime', direction: 'desc' }, metaFor))).toStrictEqual(['b10.mp4', 'a.mkv', 'b2.mp4', 'c.MP4']);
    expect(names(sortBatchFiles(files, { key: 'duration', direction: 'asc' }, metaFor))).toStrictEqual(['b10.mp4', 'a.mkv', 'b2.mp4', 'c.MP4']);
    expect(names(sortBatchFiles(files, { key: 'duration', direction: 'desc' }, metaFor))).toStrictEqual(['b2.mp4', 'a.mkv', 'b10.mp4', 'c.MP4']);
  });

  it('treats a zero value as unknown, so it sorts last in both directions', () => {
    const list = [file('a.mp4'), file('b.mp4')];
    const zeros: Record<string, BatchFileSortMeta> = { [pathByName['a.mp4']!]: { duration: 0 }, [pathByName['b.mp4']!]: { duration: 5 } };
    const zeroMetaFor = (path: string) => zeros[path];
    expect(names(sortBatchFiles(list, { key: 'duration', direction: 'asc' }, zeroMetaFor))).toStrictEqual(['b.mp4', 'a.mp4']);
    expect(names(sortBatchFiles(list, { key: 'duration', direction: 'desc' }, zeroMetaFor))).toStrictEqual(['b.mp4', 'a.mp4']);
  });

  it('keeps equal values in name order in both directions', () => {
    const list = [file('c.mp4'), file('a.mp4'), file('b.mp4')];
    const sameMetaFor = () => ({ size: 42 });
    expect(names(sortBatchFiles(list, { key: 'size', direction: 'asc' }, sameMetaFor))).toStrictEqual(['a.mp4', 'b.mp4', 'c.mp4']);
    expect(names(sortBatchFiles(list, { key: 'size', direction: 'desc' }, sameMetaFor))).toStrictEqual(['a.mp4', 'b.mp4', 'c.mp4']);
  });

  it('keeps the manual order untouched', () => {
    const sorted = sortBatchFiles(files, { key: 'manual' }, metaFor);
    expect(names(sorted)).toStrictEqual(names(files));
  });

  it('never mutates the input array', () => {
    const input = [...files];
    sortBatchFiles(input, { key: 'name', direction: 'desc' }, metaFor);
    expect(names(input)).toStrictEqual(names(files));
  });

  it('does not ask for meta when the key reads only the name', () => {
    const calls: string[] = [];
    sortBatchFiles(files, { key: 'name', direction: 'asc' }, (path: string) => {
      calls.push(path);
      return undefined;
    });
    expect(calls).toStrictEqual([]);
  });
});

describe('nextSortSpec', () => {
  it('starts ascending on a new key and flips on the same key', () => {
    expect(nextSortSpec({ key: 'manual' }, 'size')).toStrictEqual({ key: 'size', direction: 'asc' });
    expect(nextSortSpec({ key: 'size', direction: 'asc' }, 'size')).toStrictEqual({ key: 'size', direction: 'desc' });
    expect(nextSortSpec({ key: 'size', direction: 'desc' }, 'size')).toStrictEqual({ key: 'size', direction: 'asc' });
    expect(nextSortSpec({ key: 'size', direction: 'desc' }, 'name')).toStrictEqual({ key: 'name', direction: 'asc' });
  });
});

describe('helpers', () => {
  it('reads the extension from the name, not from the folder', () => {
    expect(getSortExtension('movie.MKV')).toBe('mkv');
    expect(getSortExtension('movie')).toBe('');
    expect(getSortExtension('.hidden')).toBe('');
    expect(getSortExtension('trailing.')).toBe('');
    expect(getSortExtension('archive.tar.gz')).toBe('gz');
  });

  it('maps a key to the meta it needs', () => {
    expect(metaFieldsForSortKey('name')).toStrictEqual([]);
    expect(metaFieldsForSortKey('ext')).toStrictEqual([]);
    expect(metaFieldsForSortKey('size')).toStrictEqual(['size']);
    expect(metaFieldsForSortKey('mtime')).toStrictEqual(['mtime']);
    expect(metaFieldsForSortKey('duration')).toStrictEqual(['duration']);
  });

  it('treats missing, non-finite and zero values as unknown', () => {
    expect(isKnownSortValue(undefined)).toBe(false);
    expect(isKnownSortValue(NaN)).toBe(false);
    expect(isKnownSortValue(Infinity)).toBe(false);
    expect(isKnownSortValue(0)).toBe(false);
    expect(isKnownSortValue(-1)).toBe(false);
    expect(isKnownSortValue(0.5)).toBe(true);
  });

  it('reports the manual spec and its missing direction', () => {
    const spec: BatchSortSpec = { key: 'manual' };
    expect(isManualSortSpec(spec)).toBe(true);
    expect(getSortDirection(spec)).toBeUndefined();
    expect(getSortDirection({ key: 'name', direction: 'desc' })).toBe('desc');
  });
});

describe('pruneBatchSortMeta', () => {
  const cache = new Map<string, BatchFileSortMeta>([
    [pathByName['a.mp4']!, { size: 1, mtime: 1000, duration: 2 }],
    [pathByName['b.mp4']!, { size: 2 }],
    [pathByName['b.mkv']!, { duration: 3 }],
  ]);

  it('keeps the details of the rows still in the list', () => {
    const pruned = pruneBatchSortMeta(cache, [file('b.mp4'), file('a.mp4')]);
    expect([...pruned.keys()]).toStrictEqual([pathByName['a.mp4'], pathByName['b.mp4']]);
    expect(pruned.get(pathByName['a.mp4']!)).toStrictEqual({ size: 1, mtime: 1000, duration: 2 });
  });

  it('drops the detail of a file the list no longer holds', () => {
    const pruned = pruneBatchSortMeta(cache, [file('a.mp4')]);
    expect(pruned.has(pathByName['b.mkv']!)).toBe(false);
    expect(pruned.size).toBe(1);
  });

  it('empties the cache with the list, never mutating the map it was given', () => {
    expect(pruneBatchSortMeta(cache, []).size).toBe(0);
    expect(cache.size).toBe(3);
  });

  it('keeps an empty cache as it is, without walking the list', () => {
    const empty = new Map<string, BatchFileSortMeta>();
    expect(pruneBatchSortMeta(empty, files).size).toBe(0);
  });
});
