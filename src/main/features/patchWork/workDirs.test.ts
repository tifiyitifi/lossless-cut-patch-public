// eslint-disable-next-line import-js/no-extraneous-dependencies
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it, vi } from 'vitest';

import { ensurePatchWorkDirs, getPatchFinishDirs, getPatchWorkDirList, getPatchWorkDirs } from './workDirs.js';

describe('getPatchWorkDirs', () => {
  it('is undefined without a working directory', () => {
    expect(getPatchWorkDirs(undefined)).toBeUndefined();
    expect(getPatchWorkDirs('')).toBeUndefined();
    expect(getPatchWorkDirs(' '.repeat(3))).toBeUndefined();
  });

  it('keeps the work area inside the working directory', () => {
    const dirs = getPatchWorkDirs(join('/data', 'videos'));
    expect(dirs).toBeDefined();
    expect(dirs!.workDir).toBe(join('/data', 'videos', '.losslesscut_work'));
    expect(dirs!.clipsDir).toBe(join('/data', 'videos', '.losslesscut_work', 'clips'));
    expect(dirs!.mergedDir).toBe(join('/data', 'videos', '.losslesscut_work', 'merged'));
  });

  it('gives every working directory its own work area', () => {
    const a = getPatchWorkDirs('/data/a');
    const b = getPatchWorkDirs('/data/b');
    expect(a!.workDir).not.toBe(b!.workDir);
  });

  it('uses the configured folder name', () => {
    const dirs = getPatchWorkDirs('/data/videos', { workDir: 'work', finishedDir: 'done' });
    expect(dirs!.workDir).toBe(join('/data/videos', 'work'));
    expect(dirs!.clipsDir).toBe(join('/data/videos', 'work', 'clips'));
    expect(dirs!.mergedDir).toBe(join('/data/videos', 'work', 'merged'));
  });
});

describe('getPatchFinishDirs', () => {
  it('is undefined without a working directory', () => {
    expect(getPatchFinishDirs(undefined)).toBeUndefined();
    expect(getPatchFinishDirs('')).toBeUndefined();
  });

  it('puts what the user keeps into losslesscut_finished, next to the work area', () => {
    const dirs = getPatchFinishDirs('/data/videos')!;
    const finishedDir = join('/data/videos', 'losslesscut_finished');
    expect(dirs.finishedSrcMediaDir).toBe(join(finishedDir, 'finished_src_media'));
    expect(dirs.finishedSkipSrcMediaDir).toBe(join(finishedDir, 'finished_skip_src'));
    expect(dirs.finishedMergedDir).toBe(join(finishedDir, 'finished_merged'));
    expect(dirs.finishedClipsDir).toBe(join(finishedDir, 'finished_clips'));
    expect(dirs.finishLlcDir).toBe(join(finishedDir, 'finish_llc'));
  });

  it('keeps the pending deletions inside the work area', () => {
    const dirs = getPatchFinishDirs('/data/videos')!;
    const workDir = join('/data/videos', '.losslesscut_work');
    expect(dirs.detachedSrcMediaDir).toBe(join(workDir, 'detached_src_media'));
    expect(dirs.detachedClipsDir).toBe(join(workDir, 'detached_clips'));
    expect(dirs.detachedMergedDir).toBe(join(workDir, 'detached_merged'));
    // The stage folders the export writes into stay where they were.
    expect(dirs.workDir).toBe(workDir);
    expect(dirs.clipsDir).toBe(join(workDir, 'clips'));
    expect(dirs.mergedDir).toBe(join(workDir, 'merged'));
  });

  it('uses the configured folder names', () => {
    const dirs = getPatchFinishDirs('/data/videos', { workDir: 'work', finishedDir: 'done' })!;
    expect(dirs.workDir).toBe(join('/data/videos', 'work'));
    expect(dirs.finishedSrcMediaDir).toBe(join('/data/videos', 'done', 'finished_src_media'));
    expect(dirs.finishedSkipSrcMediaDir).toBe(join('/data/videos', 'done', 'finished_skip_src'));
    expect(dirs.finishedMergedDir).toBe(join('/data/videos', 'done', 'finished_merged'));
    expect(dirs.finishedClipsDir).toBe(join('/data/videos', 'done', 'finished_clips'));
    expect(dirs.finishLlcDir).toBe(join('/data/videos', 'done', 'finish_llc'));
    expect(dirs.detachedSrcMediaDir).toBe(join('/data/videos', 'work', 'detached_src_media'));
  });
});

describe('ensurePatchWorkDirs', () => {
  it('does nothing without a working directory', async () => {
    const mkdir = vi.fn(async (dir: string) => dir);
    await expect(ensurePatchWorkDirs(undefined, { mkdir })).resolves.toBeUndefined();
    expect(mkdir).not.toHaveBeenCalled();
  });

  it('creates the work area and its stage directories', async () => {
    const created: string[] = [];
    const mkdir = vi.fn(async (dir: string) => { created.push(dir); });
    const dirs = getPatchWorkDirs('/data/videos')!;

    await expect(ensurePatchWorkDirs('/data/videos', { mkdir })).resolves.toStrictEqual(dirs);
    expect(created).toStrictEqual(getPatchWorkDirList(dirs));
  });

  it('creates the directories on disk', async () => {
    const root = await mkdtemp(join(tmpdir(), 'patch-work-'));
    try {
      const dirs = await ensurePatchWorkDirs(root);
      expect(dirs).toBeDefined();
      await expect(stat(dirs!.clipsDir)).resolves.toBeDefined();
      await expect(stat(dirs!.mergedDir)).resolves.toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
