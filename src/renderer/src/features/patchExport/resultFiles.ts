import { isFileLockError } from '../../../../common/features/patchPlayer';
import { findOrphanProjectFileNames } from '../../../../common/features/patchFinish/paths';

const { existsSync } = window.require('node:fs');
const { rename, unlink, readdir } = window.require('node:fs/promises');
const { join } = window.require('node:path');

/** The player window may still be releasing a file when an export starts; retry briefly. */
const retryDelaysMs = [100, 200, 400, 800];

function delay(ms: number) {
  return new Promise<void>((resolve) => { setTimeout(resolve, ms); });
}

async function withLockRetry<T>(operation: () => Promise<T>) {
  let attempt = 0;
  for (;;) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await operation();
    } catch (err) {
      const retryDelay = retryDelaysMs[attempt];
      if (!isFileLockError(err) || retryDelay == null) throw err;
      attempt += 1;
      // eslint-disable-next-line no-await-in-loop
      await delay(retryDelay);
    }
  }
}

export function renameResultFile(from: string, to: string) {
  return withLockRetry(() => rename(from, to));
}

/**
Does the file exist? (synchronous)

The export plan asks whether a path is free before it decides to write there. The paths it asks
about are known in advance, so they are checked in one batch (see `App.tsx`); the temporary names
of a name swap are not, so they are checked one by one.
*/
export function pathExistsSync(path: string) {
  return existsSync(path);
}

/**
Rename the results whose name changed, before anything is cut.

Only names that are free are renamed (the planner guarantees it). If a rename fails, the ones
already done are rolled back, so the caller can abort without leaving a half-renamed playlist.
*/
export async function applyResultRenames(renames: readonly { from: string, to: string }[]) {
  const done: { from: string, to: string }[] = [];

  try {
    for (const entry of renames) {
      // eslint-disable-next-line no-await-in-loop
      await renameResultFile(entry.from, entry.to);
      done.push(entry);
    }
  } catch (err) {
    for (const entry of done.reverse()) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await renameResultFile(entry.to, entry.from);
      } catch (rollbackError) {
        // The file may be left under the name it was renamed to. It is not deleted: it may be the
        // only copy of the result. The next export cuts the result again (the old name is gone).
        console.error('Failed to roll back a result rename', entry, rollbackError);
      }
    }
    throw err;
  }
}

/** Delete files that were replaced by this export (best effort: a leftover file is harmless). */
export async function deleteResultFiles(paths: readonly string[]) {
  for (const path of paths) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await withLockRetry(() => unlink(path));
    } catch (err) {
      if ((err as { code?: string }).code !== 'ENOENT') {
        console.error('Failed to delete an obsolete result', path, err);
      }
    }
  }
}

/**
Delete the project files (`a-proj.llc`) in a result directory whose video is gone.

The merged-result window used to auto-save a project next to the merged file; those files are
derived from the export manifest, so a sidecar that lost its video is leftovers. Only the
sidecars are touched, and only when no video with the same stem is next to them.
*/
export async function deleteOrphanProjectFiles(dir: string, caseInsensitive: boolean) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    // Cleanup is best effort: it must never block a merge. A missing work area is the normal case.
    if ((err as { code?: string }).code !== 'ENOENT') console.error('Failed to scan for orphan project files', dir, err);
    return;
  }

  const orphanNames = findOrphanProjectFileNames(entries.map((entry) => ({
    name: entry.name,
    kind: entry.isFile() ? 'file' : (entry.isDirectory() ? 'directory' : 'other'),
  })), { caseInsensitive });

  if (orphanNames.length > 0) await deleteResultFiles(orphanNames.map((name) => join(dir, name)));
}
