import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { parseHistoryPasswordRecord, patchHistoryLockFileName } from '../../../common/features/patchPrivacyLock/index.js';
import type { PatchHistoryPasswordRecord } from '../../../common/features/patchPrivacyLock/index.js';
import { pathExists } from '../../util.js';
import { canWriteDir } from '../patchFinish/projectStores.js';

/**
The password file of the work-history lock (fork-owned).

The install directory is preferred (the fork ships as a portable folder), but it can be read-only
or absent in development. Resolution therefore follows one rule:

1. an existing file in the install directory wins;
2. else an existing file in the app data directory;
3. else the install directory if the app is packaged and the directory is writable;
4. else the app data directory.

Checking the two existing files before choosing a new location keeps a single lock file when the
installation folder changes between writable and read-only. The file is written through a temporary
file, like the export manifest, so a half-written password record cannot lock the user out.

A missing file is *not* an error here: the service decides that it means "restore the default
password". Anything unreadable or malformed is `invalid`: an unlock is refused until the user deletes
the file and lets the app restore the default password.
*/

export interface PatchHistoryLockPaths {
  installPath: string;
  userDataPath: string;
}

export interface ResolvePatchHistoryLockPathParams {
  userDataDir: string;
  installDir: string;
  /** False in `yarn dev`: writing next to the Electron binary is not useful. */
  isPackaged: boolean;
  exists?: (path: string) => Promise<boolean>;
  canWrite?: (dir: string) => Promise<boolean>;
}

export function getPatchHistoryLockPaths({ userDataDir, installDir }: { userDataDir: string, installDir: string }): PatchHistoryLockPaths {
  return {
    installPath: join(installDir, patchHistoryLockFileName),
    userDataPath: join(userDataDir, patchHistoryLockFileName),
  };
}

export async function resolvePatchHistoryLockPath({
  userDataDir,
  installDir,
  isPackaged,
  exists = pathExists,
  canWrite = canWriteDir,
}: ResolvePatchHistoryLockPathParams): Promise<string> {
  const paths = getPatchHistoryLockPaths({ userDataDir, installDir });
  if (!isPackaged) return paths.userDataPath;
  if (await exists(paths.installPath)) return paths.installPath;
  if (await exists(paths.userDataPath)) return paths.userDataPath;
  return (await canWrite(installDir)) ? paths.installPath : paths.userDataPath;
}

export type ReadPatchHistoryPasswordResult =
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'ok'; record: PatchHistoryPasswordRecord };

export async function readPatchHistoryPasswordFile(path: string): Promise<ReadPatchHistoryPasswordResult> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
    // A permission error is not a missing file: never overwrite a record we cannot read.
    return { kind: 'invalid' };
  }
  try {
    const record = parseHistoryPasswordRecord(JSON.parse(raw));
    return record == null ? { kind: 'invalid' } : { kind: 'ok', record };
  } catch {
    return { kind: 'invalid' };
  }
}

/** Write the record atomically. A failure is reported to the caller, which keeps its in-memory copy. */
export async function writePatchHistoryPasswordFile(path: string, record: PatchHistoryPasswordRecord): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(tempPath, path);
}
