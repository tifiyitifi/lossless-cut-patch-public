// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it, vi } from 'vitest';

import { listPatchWorkFolderOthers } from './resumeWindows.js';

// The logger pulls in Electron (and writes a log file); a no-op is enough for this test.
vi.mock('../../logger.js', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

describe('listPatchWorkFolderOthers', () => {
  const deps = (dir: string | undefined) => ({
    clipsDir: dir,
    mergedDir: undefined,
    listFiles: vi.fn(async () => [{ path: `${dir}/b.mp4` }, { path: `${dir}/a.mp4` }]),
    caseInsensitive: true,
  });

  it('excludes the playlist', async () => {
    await expect(listPatchWorkFolderOthers(
      { kind: 'clips', excludePaths: ['D:/w/clips/A.mp4'] },
      deps('D:/w/clips'),
    )).resolves.toStrictEqual(['D:/w/clips/b.mp4']);
  });

  it('is empty without a folder or when listing fails', async () => {
    await expect(listPatchWorkFolderOthers({ kind: 'clips', excludePaths: [] }, deps(undefined))).resolves.toStrictEqual([]);
    await expect(listPatchWorkFolderOthers(
      { kind: 'clips', excludePaths: [] },
      { clipsDir: 'D:/w/clips', mergedDir: undefined, listFiles: async () => { throw new Error('gone'); }, caseInsensitive: true },
    )).resolves.toStrictEqual([]);
  });
});
