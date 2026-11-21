import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { defaultPatchDirNames, getPatchWorkDirNames, patchDetachedSubdirs, patchFinishedSubdirs } from '../../../common/features/patchWork/workDirs.js';
import type { PatchDirNames, PatchWorkDirs } from '../../../common/features/patchWork/workDirs.js';
import type { PatchFinishDirs } from '../../../common/features/patchFinish/preview.js';

/** Creates one directory (recursively). Injected so the logic can be unit-tested. */
export type Mkdir = (dir: string) => Promise<unknown>;

export interface EnsurePatchWorkDirsDeps {
  mkdir?: Mkdir;
  /** The configured folder names; the defaults match the layout this module documents. */
  dirNames?: PatchDirNames | undefined;
}

const defaultMkdir: Mkdir = async (dir) => mkdir(dir, { recursive: true });

/**
The directories the app maintains for the given working directory.

Returns `undefined` when no working directory is configured, so callers can fall back to the
upstream behaviour (output next to the source file).
*/
export function getPatchWorkDirs(workRoot: string | undefined, dirNames: PatchDirNames = defaultPatchDirNames): PatchWorkDirs | undefined {
  if (workRoot == null || workRoot.trim() === '') return undefined;
  const names = getPatchWorkDirNames(dirNames);
  return {
    workDir: join(workRoot, names.workDir),
    clipsDir: join(workRoot, names.clipsDir),
    mergedDir: join(workRoot, names.mergedDir),
  };
}

/** Every directory that has to exist for the work area to be usable. */
export function getPatchWorkDirList(dirs: PatchWorkDirs): string[] {
  return [dirs.workDir, dirs.clipsDir, dirs.mergedDir];
}

/**
The directories the finish flow writes into (fork-owned).

What the user keeps goes into `losslesscut_finished`, a *sibling* of the work area: the work area
then holds nothing but what the app is still working on, and a finished result no longer keeps the
work area from being cleaned up. The `detached_*` folders stay inside the work area: they are
pending deletions the user still has to look at.

None of them is created with the work area: only a job that moves a file there creates the folder,
so a work area that is still in use has no empty `finished_*` clutter.
*/
export function getPatchFinishDirs(workRoot: string | undefined, dirNames: PatchDirNames = defaultPatchDirNames): PatchFinishDirs | undefined {
  if (workRoot == null || workRoot.trim() === '') return undefined;
  const base = getPatchWorkDirs(workRoot, dirNames);
  if (base == null) return undefined;
  const finishedDir = join(workRoot, dirNames.finishedDir);
  return {
    workDir: base.workDir,
    clipsDir: base.clipsDir,
    mergedDir: base.mergedDir,
    finishedSrcMediaDir: join(finishedDir, patchFinishedSubdirs.finishedSrcMedia),
    finishedSkipSrcMediaDir: join(finishedDir, patchFinishedSubdirs.finishedSkipSrc),
    detachedSrcMediaDir: join(base.workDir, patchDetachedSubdirs.detachedSrcMedia),
    finishedMergedDir: join(finishedDir, patchFinishedSubdirs.finishedMerged),
    finishedClipsDir: join(finishedDir, patchFinishedSubdirs.finishedClips),
    detachedClipsDir: join(base.workDir, patchDetachedSubdirs.detachedClips),
    detachedMergedDir: join(base.workDir, patchDetachedSubdirs.detachedMerged),
    finishLlcDir: join(finishedDir, patchFinishedSubdirs.finishLlc),
  };
}

/**
Make sure the work area for the given working directory exists.

The app keeps the work area of every working directory it is pointed at, so switching the
working directory just means creating the next one. Returns the directories it ensured, or
`undefined` when no working directory is configured.
*/
export async function ensurePatchWorkDirs(workRoot: string | undefined, { mkdir: mkdirFn = defaultMkdir, dirNames = defaultPatchDirNames }: EnsurePatchWorkDirsDeps = {}): Promise<PatchWorkDirs | undefined> {
  const dirs = getPatchWorkDirs(workRoot, dirNames);
  if (dirs == null) return undefined;

  for (const dir of getPatchWorkDirList(dirs)) {
    // eslint-disable-next-line no-await-in-loop
    await mkdirFn(dir);
  }

  return dirs;
}
