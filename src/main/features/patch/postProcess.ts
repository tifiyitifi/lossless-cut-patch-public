import { mkdir, rename, stat } from 'node:fs/promises';
import { basename, dirname, join, parse } from 'node:path';

import type { PatchSourcePostAction } from '../../../common/features/patchData/settings.js';

/**
Source-file post-processing (main process).

The old workflow moved / deleted the original file once a video was cut and merged. Patch mode
keeps the same four states: keep / move to the destination directory / delete (recycle bin) /
skip (leave the file alone but move on to the next one).

File-system access is injected so the logic can be unit tested without touching disk (and so the
module stays importable outside Electron).
*/

export interface PatchPostProcessParams {
  sourcePath: string;
  action: PatchSourcePostAction;
  /** Destination directory for `move`. */
  destDir?: string | undefined;
}

export interface PatchPostProcessDeps {
  exists: (path: string) => Promise<boolean>;
  move: (from: string, to: string) => Promise<void>;
  trash: (path: string) => Promise<void>;
}

export interface PatchPostProcessResult {
  ok: boolean;
  /** Where the source ended up (only for `move`). */
  movedTo?: string;
}

/** Find a free `<name> (n)<ext>` path in `destDir` so a move never silently overwrites. */
export async function resolveFreeTargetPath(
  destDir: string,
  fileName: string,
  exists: (path: string) => Promise<boolean>,
): Promise<string> {
  const direct = join(destDir, fileName);
  if (!(await exists(direct))) return direct;

  const { name, ext } = parse(fileName);
  for (let index = 1; index < 1000; index += 1) {
    const candidate = join(destDir, `${name} (${index})${ext}`);
    // eslint-disable-next-line no-await-in-loop
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error(`Could not find a free file name in ${destDir}`);
}

export async function postProcessSource(
  params: PatchPostProcessParams,
  deps: PatchPostProcessDeps,
): Promise<PatchPostProcessResult> {
  const { sourcePath, action, destDir } = params;

  if (action === 'keep' || action === 'skip') return { ok: true };

  if (action === 'move') {
    if (destDir == null || destDir.trim() === '') throw new Error('No destination directory configured');
    const target = await resolveFreeTargetPath(destDir, basename(sourcePath), deps.exists);
    await deps.move(sourcePath, target);
    return { ok: true, movedTo: target };
  }

  await deps.trash(sourcePath);
  return { ok: true };
}

/** Real file-system implementation. */
export function createPostProcessDeps(trashItem: (path: string) => Promise<void>): PatchPostProcessDeps {
  return {
    exists: async (path) => {
      try {
        await stat(path);
        return true;
      } catch {
        return false;
      }
    },
    move: async (from, to) => {
      await mkdir(dirname(to), { recursive: true });
      await rename(from, to);
    },
    trash: trashItem,
  };
}

/** Build the RPC handler the main process exposes (the trash implementation comes from Electron). */
export function createPatchPostProcessSource(
  trashItem: (path: string) => Promise<void>,
): (params: PatchPostProcessParams) => Promise<PatchPostProcessResult> {
  const deps = createPostProcessDeps(trashItem);
  return (params) => postProcessSource(params, deps);
}
