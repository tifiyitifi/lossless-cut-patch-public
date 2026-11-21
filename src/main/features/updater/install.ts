// Fork-only: the file work around handing a package to the updater (see
// `common/features/updater/pending.ts` for the record itself and `install.ts` for the decisions).
// Electron is kept out of this module, so the record and the launch are testable against a temporary
// directory and an injected spawn.

import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { patchUpdateScriptName, patchUpdatesDirName } from '../../../common/features/updater/install.js';
import { parsePendingUpdate, pendingUpdateFileName } from '../../../common/features/updater/pending.js';
import type { PendingUpdate } from '../../../common/features/updater/pending.js';
import type { UpdaterCommand } from '../../../common/features/updater/install.js';

export interface UpdaterPaths {
  /** The folder the package, the script copy, the log and the record live in. */
  updatesDir: string;
  /** The copy of the updater script, taken from the running build. */
  scriptPath: string;
  /** The updater's transcript, outside the folder being replaced. */
  logPath: string;
  /** The record the next launch reads back. */
  pendingPath: string;
}

/** Stable locations under the app's userData: one attempt must not leave files behind per try. */
export function getUpdaterPaths(userDataDir: string): UpdaterPaths {
  const updatesDir = join(userDataDir, patchUpdatesDirName);
  return {
    updatesDir,
    scriptPath: join(updatesDir, patchUpdateScriptName),
    logPath: join(updatesDir, 'patch-update.log'),
    pendingPath: join(updatesDir, pendingUpdateFileName),
  };
}

/** Copies the updater script the running build ships into the updates folder. */
export async function prepareUpdaterScript({ shippedScriptPath, scriptPath }: {
  shippedScriptPath: string;
  scriptPath: string;
}): Promise<void> {
  await mkdir(dirname(scriptPath), { recursive: true });
  await copyFile(shippedScriptPath, scriptPath);
}

// Records a hand-off that is about to be started.
//
// Written before the updater is launched, because the whole point is to survive the app being
// replaced: a record written afterwards would never exist. A failure here is not fatal - the update
// can still succeed - but the next launch then has nothing to report.
export async function recordPendingUpdate({ pendingPath, from, to, packagePath, startedAt }: {
  pendingPath: string;
  from: string;
  to: string;
  packagePath: string;
  startedAt?: string | undefined;
}): Promise<void> {
  const record: PendingUpdate = {
    from,
    to,
    packagePath,
    startedAt: startedAt ?? new Date().toISOString(),
  };
  await mkdir(dirname(pendingPath), { recursive: true });
  await writeFile(pendingPath, JSON.stringify(record, null, 2), 'utf8');
}

// Reads the record, if there is one.
//
// A payload this build cannot read is deleted rather than left in place: nothing could ever report
// it, and the alternative is re-reading a broken file on every launch.
export async function clearPendingUpdate(pendingPath: string): Promise<void> {
  await unlink(pendingPath).catch(() => undefined);
}

export async function readPendingUpdateFile(pendingPath: string): Promise<PendingUpdate | undefined> {
  let raw: string;
  try {
    raw = await readFile(pendingPath, 'utf8');
  } catch {
    return undefined;
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    await clearPendingUpdate(pendingPath);
    return undefined;
  }

  const record = parsePendingUpdate(decoded);
  if (record === undefined) await clearPendingUpdate(pendingPath);
  return record;
}

export type SpawnImpl = typeof spawn;

// Starts the updater and returns immediately; the caller quits the app right after.
//
// The child is detached on purpose: it has to outlive this process, since replacing the program
// files means the app must be gone first. `stdio: ignore` keeps it from writing into a pipe this
// process owns.
export function launchUpdater({ command, spawnImpl = spawn }: {
  command: UpdaterCommand;
  spawnImpl?: SpawnImpl;
}): void {
  const child = spawnImpl(command.executable, command.args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}
