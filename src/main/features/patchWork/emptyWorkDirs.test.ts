// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { PatchWorkDirEntry } from '../../../common/features/patchWork/index.js';
import { clearEmptyWorkDirs } from './emptyWorkDirs.js';

function codeError(code: string) {
  return Object.assign(new Error(code), { code });
}

const entry = (path: string, kind: PatchWorkDirEntry['kind'] = 'directory'): PatchWorkDirEntry => ({ path, kind });

function makeDeps({ scans, failTrash, caseInsensitive = true }: {
  scans: Record<string, PatchWorkDirEntry[] | Error>;
  failTrash?: (dir: string) => Error | undefined;
  caseInsensitive?: boolean;
}) {
  const trashed: string[] = [];
  return {
    trashed,
    deps: {
      roots: ['C:/work', 'C:/empty', 'C:/missing', 'C:/work/'],
      getWorkDir: (root: string) => {
        if (root === 'C:/work') return 'C:/work/.losslesscut_work';
        if (root === 'C:/work/') return String.raw`c:\WORK\.losslesscut_work`;
        if (root === 'C:/empty') return 'C:/empty/.losslesscut_work';
        if (root === 'C:/missing') return 'C:/missing/.losslesscut_work';
        return undefined;
      },
      scanWorkDir: async (dir: string) => {
        const key = Object.keys(scans).find((path) => path.toLowerCase() === dir.toLowerCase());
        if (key == null) throw codeError('ENOENT');
        const scan = scans[key];
        if (scan instanceof Error) throw scan;
        if (scan == null) throw codeError('ENOENT');
        return scan;
      },
      trashDir: async (dir: string) => {
        const failure = failTrash?.(dir);
        if (failure != null) throw failure;
        trashed.push(dir);
      },
      caseInsensitive,
    },
  };
}

describe('clearEmptyWorkDirs', () => {
  it('trashes only the whitelisted work areas and deduplicates roots', async () => {
    const { deps, trashed } = makeDeps({
      scans: {
        'C:/work/.losslesscut_work': [entry('clips'), entry('merged'), entry('export-manifest.json', 'file')],
        'C:/empty/.losslesscut_work': [entry('finished_clips'), entry('detached_clips')],
        // C:/missing/.losslesscut_work is not in the map: the scan throws ENOENT and is skipped.
      },
    });

    const result = await clearEmptyWorkDirs(deps);

    expect(result).toStrictEqual({
      cleared: [
        { workDir: 'C:/work/.losslesscut_work' },
        { workDir: 'C:/empty/.losslesscut_work' },
      ],
      kept: [],
      failed: [],
    });
    expect(trashed).toStrictEqual(['C:/work/.losslesscut_work', 'C:/empty/.losslesscut_work']);
  });

  it('keeps a work area that holds an unknown file or folder', async () => {
    const { deps, trashed } = makeDeps({
      scans: {
        'C:/work/.losslesscut_work': [entry('clips'), entry('notes.txt', 'file')],
        'C:/empty/.losslesscut_work': [],
      },
    });

    const result = await clearEmptyWorkDirs(deps);

    expect(result.kept).toStrictEqual(['C:/work/.losslesscut_work']);
    expect(result.cleared).toStrictEqual([{ workDir: 'C:/empty/.losslesscut_work' }]);
    expect(trashed).toStrictEqual(['C:/empty/.losslesscut_work']);
  });

  it('reports a scan failure without trashing that work area', async () => {
    const { deps, trashed } = makeDeps({
      scans: {
        'C:/work/.losslesscut_work': codeError('EACCES'),
        'C:/empty/.losslesscut_work': [],
      },
    });

    const result = await clearEmptyWorkDirs(deps);

    expect(result.failed).toStrictEqual([{ path: 'C:/work/.losslesscut_work', reason: 'EACCES' }]);
    expect(result.cleared).toStrictEqual([{ workDir: 'C:/empty/.losslesscut_work' }]);
    expect(trashed).toStrictEqual(['C:/empty/.losslesscut_work']);
  });

  it('refuses to delete when the recycle bin is unavailable, and continues with the next root', async () => {
    const trashCalls: string[] = [];
    const { deps } = makeDeps({
      scans: {
        'C:/work/.losslesscut_work': [entry('clips')],
        'C:/empty/.losslesscut_work': [entry('merged')],
      },
      failTrash: (dir) => {
        trashCalls.push(dir);
        return dir === 'C:/work/.losslesscut_work' ? codeError('EBUSY') : undefined;
      },
    });

    const result = await clearEmptyWorkDirs(deps);

    expect(result.failed).toStrictEqual([{ path: 'C:/work/.losslesscut_work', reason: 'EBUSY' }]);
    expect(result.cleared).toStrictEqual([{ workDir: 'C:/empty/.losslesscut_work' }]);
    // One attempt per folder: a failed trash must never fall back to a recursive delete.
    expect(trashCalls).toStrictEqual(['C:/work/.losslesscut_work', 'C:/empty/.losslesscut_work']);
  });

  it('scans again right before the trash and keeps a folder that gained a file', async () => {
    const scans: PatchWorkDirEntry[][] = [[entry('clips')], [entry('clips'), entry('late.txt', 'file')]];
    const trashed: string[] = [];
    let calls = 0;
    const result = await clearEmptyWorkDirs({
      roots: ['C:/work'],
      getWorkDir: () => 'C:/work/.losslesscut_work',
      scanWorkDir: async () => {
        const next = scans[calls] ?? [];
        calls += 1;
        return next;
      },
      trashDir: async (dir) => { trashed.push(dir); },
      caseInsensitive: true,
    });

    expect(calls).toBe(2);
    expect(result.kept).toStrictEqual(['C:/work/.losslesscut_work']);
    expect(result.cleared).toStrictEqual([]);
    expect(trashed).toStrictEqual([]);
  });

  it('treats a folder that disappeared before the trash call as cleared', async () => {
    const { deps } = makeDeps({
      scans: { 'C:/work/.losslesscut_work': [], 'C:/empty/.losslesscut_work': [], 'C:/missing/.losslesscut_work': [] },
      failTrash: (dir) => (dir === 'C:/work/.losslesscut_work' ? codeError('ENOENT') : undefined),
    });

    const result = await clearEmptyWorkDirs(deps);

    expect(result.failed).toStrictEqual([]);
    expect(result.cleared.map((item) => item.workDir)).toContain('C:/work/.losslesscut_work');
  });

  it('skips unusable work directory paths', async () => {
    const { deps, trashed } = makeDeps({ scans: {} });
    const result = await clearEmptyWorkDirs({
      ...deps,
      roots: ['C:/a', 'C:/b'],
      getWorkDir: (root) => (root === 'C:/a' ? 'C:' : 'C:/b/.losslesscut_work'),
    });

    expect(result).toStrictEqual({ cleared: [], kept: [], failed: [] });
    expect(trashed).toStrictEqual([]);
  });
});
