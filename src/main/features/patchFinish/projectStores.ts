import { access, constants } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { PatchFinishProjectStores } from '../../../common/features/patchFinish/index.js';

/**
The `llc` stores outside the work area (main process).

Two stores are offered: one in the app data folder (always writable) and one in the installation
folder (portable builds). The installation folder can be read-only (Program Files), so the
preview checks it best-effort and the dialog disables the choice; the job re-checks by trying to
write anyway.
*/

/** Folder name of both stores (`<userData>/llc`, `<installation folder>/llc`). */
export const patchLlcStoreDirName = 'llc';

/** The installation folder: the portable app directory when there is one, else the exe's folder. */
export function getPatchInstallDir({ portableDir, exePath }: { portableDir: string | undefined; exePath: string }) {
  const trimmed = portableDir?.trim();
  return trimmed != null && trimmed !== '' ? trimmed : dirname(exePath);
}

export interface PatchProjectStoreDirs {
  userDataLlcDir: string;
  installLlcDir: string;
}

/** The two store folders, without checking anything. */
export function getPatchProjectStoreDirs({ userDataDir, installDir }: { userDataDir: string; installDir: string }): PatchProjectStoreDirs {
  return {
    userDataLlcDir: join(userDataDir, patchLlcStoreDirName),
    installLlcDir: join(installDir, patchLlcStoreDirName),
  };
}

/** Can the app write in this directory? (best effort, never throws) */
export async function canWriteDir(dir: string, check: (path: string) => Promise<unknown> = (path) => access(path, constants.W_OK)) {
  try {
    await check(dir);
    return true;
  } catch {
    return false;
  }
}

/** The store folders for the preview, with the installation folder's writability. */
export async function resolvePatchProjectStores({ userDataDir, installDir, canWrite = canWriteDir }: {
  userDataDir: string;
  installDir: string;
  canWrite?: (dir: string) => Promise<boolean>;
}): Promise<PatchFinishProjectStores> {
  const dirs = getPatchProjectStoreDirs({ userDataDir, installDir });
  return {
    ...dirs,
    // The `llc` folder is created on demand, so the check is about the folder that will hold it.
    installLlcWritable: await canWrite(installDir),
  };
}
