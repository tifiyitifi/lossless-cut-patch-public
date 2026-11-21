// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { PatchWorkRootPathInfo } from './workRoots.js';
import {
  buildPatchWorkRootRows,
  filterPatchWorkRoots,
  firstPatchWorkRootRow,
  lastPatchWorkRootRow,
  movePatchWorkRootRow,
  nearestPatchWorkRootRow,
} from './workRoots.js';

function root(overrides: Partial<PatchWorkRootPathInfo> & Pick<PatchWorkRootPathInfo, 'root'>): PatchWorkRootPathInfo {
  return {
    lastUsed: 0,
    workDir: `${overrides.root}/.losslesscut_work`,
    rootExists: true,
    workDirExists: true,
    ...overrides,
  };
}

describe('buildPatchWorkRootRows', () => {
  it('puts the source folder first and its work area second', () => {
    const rows = buildPatchWorkRootRows([root({ root: '/a' })]);

    expect(rows).toStrictEqual([
      { root: '/a', kind: 'root', path: '/a', exists: true },
      { root: '/a', kind: 'work', path: '/a/.losslesscut_work', exists: true },
    ]);
  });

  it('keeps the existence of each folder separate', () => {
    const rows = buildPatchWorkRootRows([root({ root: '/a', rootExists: true, workDirExists: false })]);

    expect(rows.map((row) => [row.kind, row.exists])).toStrictEqual([['root', true], ['work', false]]);
  });

  it('builds two rows per root, in order', () => {
    const rows = buildPatchWorkRootRows([root({ root: '/a' }), root({ root: '/b' })]);

    expect(rows.map((row) => row.path)).toStrictEqual(['/a', '/a/.losslesscut_work', '/b', '/b/.losslesscut_work']);
  });
});

describe('filterPatchWorkRoots', () => {
  const roots = [root({ root: '/videos/a' }), root({ root: '/other' })];

  it('returns every root for an empty or blank query', () => {
    expect(filterPatchWorkRoots(roots, '')).toStrictEqual(roots);
    expect(filterPatchWorkRoots(roots, ' '.repeat(3))).toStrictEqual(roots);
  });

  it('matches the source folder and its work area, case-insensitively', () => {
    expect(filterPatchWorkRoots(roots, 'VIDEOS').map((entry) => entry.root)).toStrictEqual(['/videos/a']);
    expect(filterPatchWorkRoots(roots, '.losslesscut_work').map((entry) => entry.root)).toStrictEqual(['/videos/a', '/other']);
  });

  it('drops roots that do not match', () => {
    expect(filterPatchWorkRoots(roots, 'nothing-here')).toStrictEqual([]);
  });
});

describe('work root selection', () => {
  // /a: root exists, work missing; /b: both missing; /c: both exist.
  const rows = buildPatchWorkRootRows([
    root({ root: '/a', workDirExists: false }),
    root({ root: '/b', rootExists: false, workDirExists: false }),
    root({ root: '/c' }),
  ]);

  it('snaps the selection to the nearest existing row', () => {
    expect(nearestPatchWorkRootRow(rows, 0)).toBe(0);
    expect(nearestPatchWorkRootRow(rows, 1)).toBe(4);
    expect(nearestPatchWorkRootRow(rows, 3)).toBe(4);
    expect(nearestPatchWorkRootRow(rows, 999)).toBe(5);
  });

  it('keeps the index when nothing exists', () => {
    const missing = buildPatchWorkRootRows([root({ root: '/a', rootExists: false, workDirExists: false })]);

    expect(nearestPatchWorkRootRow(missing, 1)).toBe(1);
    expect(movePatchWorkRootRow(missing, 0, 1)).toBe(0);
    expect(firstPatchWorkRootRow(missing)).toBe(0);
    expect(lastPatchWorkRootRow(missing)).toBe(0);
  });

  it('skips missing rows when moving down and up', () => {
    expect(movePatchWorkRootRow(rows, 0, 1)).toBe(4);
    expect(movePatchWorkRootRow(rows, 4, -1)).toBe(0);
    expect(movePatchWorkRootRow(rows, 4, 1)).toBe(5);
    expect(movePatchWorkRootRow(rows, 0, -1)).toBe(0);
  });

  it('starts from the nearest existing row when the current row is missing', () => {
    expect(movePatchWorkRootRow(rows, 3, 1)).toBe(5);
    expect(movePatchWorkRootRow(rows, 3, -1)).toBe(0);
  });

  it('jumps to the first and last existing rows', () => {
    expect(firstPatchWorkRootRow(rows)).toBe(0);
    expect(lastPatchWorkRootRow(rows)).toBe(5);
  });
});
