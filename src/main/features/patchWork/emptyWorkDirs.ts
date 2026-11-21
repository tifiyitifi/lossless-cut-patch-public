import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { PatchDirNames, PatchWorkDirEntry } from '../../../common/features/patchWork/index.js';
import { getWorkDirClearDecision, isClearableWorkDirPath } from '../../../common/features/patchWork/index.js';
import { defaultPatchDirNames } from '../../../common/features/patchWork/workDirs.js';

/**
Clear empty work areas (`cewd`, and the finish dialog's optional cleanup).

The work area is only ever removed with `shell.trashItem` (injected as `trashDir`), never with
`fs.rm`/`rmdir`: a failed trash leaves the folder exactly as it was. Emptiness is a **whitelist**
(`getWorkDirClearDecision`): stage folders and the export manifest may be present, anything else
(even an empty file or folder the user made) keeps the whole work area. This is what makes the
command safe enough to run without a confirmation dialog.

The point is housekeeping, not freeing disk space: an empty folder takes almost no space in the
recycle bin, so the user never has to empty the bin for this. The app therefore never falls back
to a permanent delete when the bin is unavailable.
*/

export interface PatchClearEmptyWorkDirsResult {
  /** Work areas that were handed to the recycler. */
  cleared: { workDir: string }[];
  /** Work areas that hold something outside the whitelist: left alone. */
  kept: string[];
  /** Scan or trash failures. The directory is kept in every failure case. */
  failed: { path: string; reason: string }[];
}

export interface ClearEmptyWorkDirsDeps {
  /** The work roots to inspect (history, plus the configured one). */
  roots: readonly string[];
  /** `<root>/<configured work dir name>`, or `undefined` when the root is unusable. */
  getWorkDir: (root: string) => string | undefined;
  scanWorkDir: (dir: string) => Promise<PatchWorkDirEntry[]>;
  trashDir: (dir: string) => Promise<void>;
  caseInsensitive: boolean;
  /** The configured folder names (the whitelist must recognize the current and default names). */
  dirNames?: PatchDirNames | undefined;
}

function errorCode(error: unknown) {
  const code = (error as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

function errorReason(error: unknown) {
  return errorCode(error) ?? (error instanceof Error ? error.message : String(error));
}

function workDirKey(path: string, caseInsensitive: boolean) {
  const normalized = path.replaceAll('\\', '/').replace(/\/+$/, '');
  return caseInsensitive ? normalized.toLowerCase() : normalized;
}

/**
Scan a work directory into relative entries.

Symlinks and junctions are reported as `other` and never followed: a link inside the work area
must keep the whole area (deleting through it could reach files outside).
*/
export async function scanPatchWorkDirEntries(dir: string): Promise<PatchWorkDirEntry[]> {
  // Never follow a link/junction at the work-area root: trashing it could reach files outside.
  const root = await lstat(dir);
  if (!root.isDirectory()) throw new Error('The work directory is not a plain directory');

  const entries: PatchWorkDirEntry[] = [];

  const walk = async (current: string, prefix: string) => {
    const dirents = await readdir(current, { withFileTypes: true });
    for (const dirent of dirents) {
      const path = prefix === '' ? dirent.name : `${prefix}/${dirent.name}`;
      const kind = dirent.isDirectory() ? 'directory' : (dirent.isFile() ? 'file' : 'other');
      entries.push({ path, kind });
      if (kind === 'directory') {
        // eslint-disable-next-line no-await-in-loop
        await walk(join(current, dirent.name), path);
      }
    }
  };

  await walk(dir, '');
  return entries;
}

/**
Trash every work area that contains nothing but whitelisted entries.

A missing work area is skipped, a scan failure is reported per root, and a trash failure is
**never** retried with a permanent delete: the caller shows the failure and lets the user decide.
*/
export async function clearEmptyWorkDirs({ roots, getWorkDir, scanWorkDir, trashDir, caseInsensitive, dirNames = defaultPatchDirNames }: ClearEmptyWorkDirsDeps): Promise<PatchClearEmptyWorkDirsResult> {
  const result: PatchClearEmptyWorkDirsResult = { cleared: [], kept: [], failed: [] };
  const seen = new Set<string>();

  for (const root of roots) {
    const workDir = getWorkDir(root);
    if (workDir != null && isClearableWorkDirPath(workDir, { dirNames, caseInsensitive })) {
      const key = workDirKey(workDir, caseInsensitive);
      if (!seen.has(key)) {
        seen.add(key);

        let entries: PatchWorkDirEntry[] | undefined;
        try {
          // eslint-disable-next-line no-await-in-loop
          entries = await scanWorkDir(workDir);
        } catch (error) {
          // A work area that no longer exists needs no cleanup.
          if (errorCode(error) !== 'ENOENT') result.failed.push({ path: workDir, reason: errorReason(error) });
        }

        if (entries != null) {
          const decision = getWorkDirClearDecision({ entries, caseInsensitive });
          if (!decision.clearable) {
            result.kept.push(workDir);
          } else {
            // Scan again immediately before the recycle bin: `trashDir` moves the whole tree, so a
            // file created between the first scan and now would go with it. The gap cannot be
            // closed completely, but a second look makes it as small as the trash call itself.
            let confirmed: PatchWorkDirEntry[] | undefined;
            let disappeared = false;
            try {
              // eslint-disable-next-line no-await-in-loop
              confirmed = await scanWorkDir(workDir);
            } catch (error) {
              if (errorCode(error) === 'ENOENT') disappeared = true;
              else result.failed.push({ path: workDir, reason: errorReason(error) });
            }

            if (disappeared) {
              // Another cleanup (or the user) removed it in between: nothing left to do.
              result.cleared.push({ workDir });
            } else if (confirmed != null) {
              if (!getWorkDirClearDecision({ entries: confirmed, caseInsensitive }).clearable) {
                result.kept.push(workDir);
              } else {
                try {
                  // eslint-disable-next-line no-await-in-loop
                  await trashDir(workDir);
                  result.cleared.push({ workDir });
                } catch (error) {
                  if (errorCode(error) === 'ENOENT') {
                    // The folder is already gone (another cleanup won the race): nothing left to do.
                    result.cleared.push({ workDir });
                  } else {
                    // Never fall back to a permanent delete: report it and leave the folder untouched.
                    result.failed.push({ path: workDir, reason: errorReason(error) });
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return result;
}
