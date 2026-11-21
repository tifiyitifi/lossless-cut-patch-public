import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  emptyPatchFinishLedger,
  parsePatchFinishLedger,
  patchFinishLedgerFileName,
  renamePatchFinishLedgerPaths,
  upsertPatchFinishLedgerEntry,
} from '../../../common/features/patchResultsOverview/index.js';
import type { PatchFinishLedger, PatchFinishLedgerEntry } from '../../../common/features/patchResultsOverview/index.js';
import type { PatchDirNames } from '../../../common/features/patchWork/workDirs.js';
import logger from '../../logger.js';

/**
The finished-job ledger on disk (fork-owned).

It lives in `losslesscut_finished` (next to the results it describes), not in the work area: the
empty-work-area cleanup moves the whole `.losslesscut_work` to the recycle bin, and a ledger there
would either go with it or keep it from ever being cleaned up.

Writes are serialized and go through a temporary file, exactly like the export manifest: two
windows can finish jobs in the same working directory, and a half-written ledger would lose the
pairing of every source in it. A ledger that cannot be written only costs the overview precision,
so the callers log the failure instead of failing the job.
*/

let writeQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.catch(() => undefined);
  return run;
}

/** `<workRoot>/<finishedDir>/finish-history.json`, or `undefined` without a working directory. */
export function getPatchFinishLedgerPath(workRoot: string | undefined, dirNames: PatchDirNames): string | undefined {
  if (workRoot == null || workRoot.trim() === '') return undefined;
  return join(workRoot, dirNames.finishedDir, patchFinishLedgerFileName);
}

async function readLedgerFile(path: string): Promise<PatchFinishLedger> {
  try {
    return parsePatchFinishLedger(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    // No finished job yet, a hand-cleaned folder, or a damaged file: the file names still pair.
    return emptyPatchFinishLedger();
  }
}

async function writeLedgerFile(path: string, ledger: PatchFinishLedger) {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
  await rename(tempPath, path);
}

/** The ledger of a working directory (empty when there is none or it cannot be read). */
export async function readPatchFinishLedger(workRoot: string | undefined, dirNames: PatchDirNames): Promise<PatchFinishLedger> {
  const path = getPatchFinishLedgerPath(workRoot, dirNames);
  return path == null ? emptyPatchFinishLedger() : readLedgerFile(path);
}

/** Record the outputs of a finished job (one entry per source). */
export function recordPatchFinishLedgerEntry({ workRoot, dirNames, entry, caseInsensitive }: {
  workRoot: string | undefined;
  dirNames: PatchDirNames;
  entry: PatchFinishLedgerEntry;
  caseInsensitive: boolean;
}): Promise<void> {
  const path = getPatchFinishLedgerPath(workRoot, dirNames);
  if (path == null) return Promise.resolve();

  return enqueue(async () => {
    const ledger = await readLedgerFile(path);
    await writeLedgerFile(path, upsertPatchFinishLedgerEntry(ledger, entry, { caseInsensitive }));
  });
}

/** Follow a rename (or a move) of a result the ledger knows. */
export function renamePatchFinishLedgerEntry({ workRoot, dirNames, from, to, caseInsensitive }: {
  workRoot: string | undefined;
  dirNames: PatchDirNames;
  from: string;
  to: string;
  caseInsensitive: boolean;
}): Promise<void> {
  const path = getPatchFinishLedgerPath(workRoot, dirNames);
  if (path == null) return Promise.resolve();

  return enqueue(async () => {
    const ledger = await readLedgerFile(path);
    const result = renamePatchFinishLedgerPaths(ledger, { from, to, caseInsensitive });
    if (!result.updated) return;
    await writeLedgerFile(path, result.ledger);
  });
}

/** Log a ledger failure without failing the job that caused it. */
export function logPatchFinishLedgerError(message: string, error: unknown) {
  logger.warn(message, error);
}
