// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { appendBatchPaths, dedupeBatchPaths, dedupePaths, updateBatchPath } from './batchPaths.js';

const detached = String.raw`C:\work\inbox\.losslesscut_work\detached_src_media\001.mp4`;
const source = String.raw`C:\work\inbox\001.mp4`;

const entry = (path: string) => ({ path, name: path.slice(path.lastIndexOf('\\') + 1) });

describe('dedupePaths', () => {
  it('keeps one path per file', () => {
    expect(dedupePaths([source, source], { caseInsensitive: true })).toStrictEqual([source]);
  });

  it('treats another spelling of the same file as the same file', () => {
    expect(dedupePaths([String.raw`C:\work\a.mp4`, 'c:/work/a.mp4'], { caseInsensitive: true })).toStrictEqual([String.raw`C:\work\a.mp4`]);
  });

  it('keeps the first spelling', () => {
    expect(dedupePaths(['c:/work/a.mp4', String.raw`C:\work\a.mp4`], { caseInsensitive: true })).toStrictEqual(['c:/work/a.mp4']);
  });

  it('keeps both on a case-sensitive file system', () => {
    expect(dedupePaths([String.raw`C:\work\A.mp4`, String.raw`C:\work\a.mp4`], { caseInsensitive: false }))
      .toStrictEqual([String.raw`C:\work\A.mp4`, String.raw`C:\work\a.mp4`]);
  });

  it('leaves different files alone', () => {
    expect(dedupePaths([source, detached], { caseInsensitive: true })).toStrictEqual([source, detached]);
  });
});

describe('dedupeBatchPaths', () => {
  it('compares whole paths, not names', () => {
    const entries = [entry(source), entry(detached)];
    expect(dedupeBatchPaths(entries, { caseInsensitive: true })).toStrictEqual(entries);
  });

  it('drops the duplicate row', () => {
    const entries = [entry(detached), entry(detached)];
    expect(dedupeBatchPaths(entries, { caseInsensitive: true })).toStrictEqual([entry(detached)]);
  });
});

describe('appendBatchPaths', () => {
  it('appends only files that are not listed yet', () => {
    const existing = [entry(source)];
    expect(appendBatchPaths(existing, [entry(detached)], { caseInsensitive: true })).toStrictEqual([entry(source), entry(detached)]);
  });

  it('does not append the same file twice in one call', () => {
    expect(appendBatchPaths([], [entry(detached), entry(detached)], { caseInsensitive: true })).toStrictEqual([entry(detached)]);
  });

  it('does not append another spelling of a listed file', () => {
    expect(appendBatchPaths([entry(source)], [entry('c:/work/inbox/001.mp4')], { caseInsensitive: true })).toStrictEqual([entry(source)]);
  });

  it('heals a list that already holds the same file twice', () => {
    expect(appendBatchPaths([entry(detached), entry(detached)], [entry(source)], { caseInsensitive: true }))
      .toStrictEqual([entry(detached), entry(source)]);
  });

  it('keeps both files on a case-sensitive file system', () => {
    const upper = String.raw`C:\work\A.mp4`;
    expect(appendBatchPaths([entry(upper)], [entry(String.raw`C:\work\a.mp4`)], { caseInsensitive: false }))
      .toStrictEqual([entry(upper), entry(String.raw`C:\work\a.mp4`)]);
  });
});

describe('updateBatchPath', () => {
  it('moves the entry to the new path', () => {
    expect(updateBatchPath([entry(source)], { from: source, to: detached, caseInsensitive: true })).toStrictEqual([entry(detached)]);
  });

  it('folds the row that already pointed at the new path into one', () => {
    // The finish job moved the source onto a path the list already listed: the two rows used to
    // become identical (`C:\...\detached\...` twice), which is what the user saw.
    expect(updateBatchPath([entry(detached), entry(source)], { from: source, to: detached, caseInsensitive: true }))
      .toStrictEqual([entry(detached)]);
  });

  it('matches the old path in any spelling', () => {
    expect(updateBatchPath([entry('c:/work/inbox/001.mp4')], { from: source, to: detached, caseInsensitive: true }))
      .toStrictEqual([entry(detached)]);
  });

  it('takes the new file name when the move renamed the file', () => {
    const moved = updateBatchPath([entry(source)], { from: source, to: String.raw`C:\work\inbox\001 (1).mp4`, caseInsensitive: true });
    expect(moved).toStrictEqual([{ path: String.raw`C:\work\inbox\001 (1).mp4`, name: '001 (1).mp4' }]);
  });

  it('leaves other files untouched', () => {
    const other = entry(String.raw`C:\work\inbox\002.mp4`);
    expect(updateBatchPath([other, entry(source)], { from: source, to: detached, caseInsensitive: true })[0]).toStrictEqual(other);
  });
});
