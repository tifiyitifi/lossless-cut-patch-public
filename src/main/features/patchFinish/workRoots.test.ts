// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { PatchFinishDirs, PatchWorkHistory } from '../../../common/features/patchFinish/index.js';

import { listPatchWorkRoots } from './workRoots.js';

function dirsFor(root: string): PatchFinishDirs {
  const workDir = `${root}/.losslesscut_work`;
  const finishedDir = `${root}/losslesscut_finished`;
  return {
    workDir,
    clipsDir: `${workDir}/clips`,
    mergedDir: `${workDir}/merged`,
    finishedSrcMediaDir: `${finishedDir}/finished_src_media`,
    finishedSkipSrcMediaDir: `${finishedDir}/finished_skip_src`,
    detachedSrcMediaDir: `${workDir}/detached_src_media`,
    finishedMergedDir: `${finishedDir}/finished_merged`,
    finishedClipsDir: `${finishedDir}/finished_clips`,
    detachedClipsDir: `${workDir}/detached_clips`,
    detachedMergedDir: `${workDir}/detached_merged`,
    finishLlcDir: `${finishedDir}/finish_llc`,
  };
}

function historyOf(roots: { root: string, lastUsed: number }[]): PatchWorkHistory {
  return { version: 1, roots };
}

const existing = new Set([
  '/work',
  '/work/.losslesscut_work',
  '/old/.losslesscut_work',
  '/new',
]);

function list(options: { history: PatchWorkHistory, fallbackRoot?: string, caseInsensitive?: boolean, historyLocked?: boolean }) {
  return listPatchWorkRoots({
    getHistory: () => options.history,
    getDirs: (root) => (root === '/broken' ? undefined : dirsFor(root)),
    exists: async (path) => existing.has(path),
    ...((options.fallbackRoot != null) && { fallbackRoot: options.fallbackRoot }),
    ...((options.caseInsensitive != null) && { caseInsensitive: options.caseInsensitive }),
    ...((options.historyLocked != null) && { historyLocked: options.historyLocked }),
  });
}

describe('listPatchWorkRoots', () => {
  it('lists the history newest first with the two folders and their existence', async () => {
    const listing = await list({ history: historyOf([{ root: '/old', lastUsed: 2 }, { root: '/work', lastUsed: 1 }]) });

    expect(listing.roots.map((entry) => entry.root)).toStrictEqual(['/old', '/work']);
    expect(listing.roots[1]).toMatchObject({
      root: '/work',
      workDir: '/work/.losslesscut_work',
      workDirExists: true,
    });
  });

  it('spells the root and the work area with forward slashes for the dialog', async () => {
    // The root comes from the history as `/`, but the work area is built with `node:path.join`, so
    // on Windows it arrives with `\`. The listing is dialog data, so both are normalized here.
    const listing = await list({ history: historyOf([{ root: String.raw`C:\work`, lastUsed: 2 }]), fallbackRoot: String.raw`C:\old` });

    expect(listing.roots.map((entry) => entry.root)).toStrictEqual(['C:/old', 'C:/work']);
    expect(listing.roots[0]).toMatchObject({ root: 'C:/old', workDir: 'C:/old/.losslesscut_work' });
    expect(listing.roots[1]).toMatchObject({ root: 'C:/work', workDir: 'C:/work/.losslesscut_work' });
  });

  it('marks a root whose folder is gone but whose work area is still there', async () => {
    const listing = await list({ history: historyOf([{ root: '/old', lastUsed: 2 }]) });

    expect(listing.roots[0]).toMatchObject({ root: '/old', rootExists: false, workDirExists: true });
  });

  it('marks a root that exists but has no work area yet', async () => {
    const listing = await list({ history: historyOf([]), fallbackRoot: '/new' });

    expect(listing.roots[0]).toMatchObject({ root: '/new', rootExists: true, workDirExists: false });
  });

  it('shows the current work root first even before it is part of the history', async () => {
    const listing = await list({ history: historyOf([{ root: '/old', lastUsed: 2 }]), fallbackRoot: '/work' });

    expect(listing.roots.map((entry) => entry.root)).toStrictEqual(['/work', '/old']);
    expect(listing.roots[0]).toMatchObject({ root: '/work', lastUsed: 0, workDirExists: true });
  });

  it('does not duplicate a fallback root the history already has', async () => {
    const listing = await list({ history: historyOf([{ root: 'C:/Work', lastUsed: 2 }]), fallbackRoot: 'c:/work/', caseInsensitive: true });

    expect(listing.roots).toHaveLength(1);
    expect(listing.roots[0]).toMatchObject({ root: 'C:/Work', lastUsed: 2 });
  });

  it('ignores a fallback root that has no work area layout', async () => {
    const listing = await list({ history: historyOf([]), fallbackRoot: '/broken' });

    expect(listing.roots).toStrictEqual([]);
  });

  it('shows only the current work root while the history is locked', async () => {
    const listing = await list({ history: historyOf([{ root: '/old', lastUsed: 2 }, { root: '/work', lastUsed: 1 }]), fallbackRoot: '/work', historyLocked: true });

    expect(listing.roots.map((entry) => entry.root)).toStrictEqual(['/work']);
    expect(listing.roots[0]).toMatchObject({ root: '/work', lastUsed: 0, workDirExists: true });
  });

  it('shows nothing while the history is locked and no video is open', async () => {
    const listing = await list({ history: historyOf([{ root: '/old', lastUsed: 2 }]), historyLocked: true });

    expect(listing.roots).toStrictEqual([]);
  });
});
