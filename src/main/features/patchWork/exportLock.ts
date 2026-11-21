import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { isPidLockFileStale, parsePidLockFile, serializePidLockFile } from '../../../common/features/patchExportLock/pidLock.js';
import type { PidLockFile } from '../../../common/features/patchExportLock/pidLock.js';
import { defaultPatchDirNames, patchWorkLockFileName } from '../../../common/features/patchWork/workDirs.js';
import type { PatchDirNames } from '../../../common/features/patchWork/workDirs.js';
import { getPatchWorkDirs } from './workDirs.js';

/**
The work-area lock (fork-owned).

Two windows of the app may share one work area (`allowMultipleInstances`). The incremental-export
manifest is read-modify-written by a queue that only exists inside one process, and a finish job
moves and deletes the results another window may be cutting right now. This lock serializes those
jobs across processes: one job at a time per work area.

The file is created with `wx` (it fails when it exists), so two windows cannot both win. A lock
whose owner is gone - or that is older than a day, because the system may have reused the pid -
is taken over instead of blocking the app for good.
*/
export type PatchWorkLockHolder = PidLockFile;

export type PatchWorkLockAcquireResult = | { ok: true }
  | { ok: false, reason: 'busy', holder: PatchWorkLockHolder | undefined }
  | { ok: false, reason: 'error', message: string };

/** Age after which a lock is taken over even though the pid is alive (a reused pid). */
const staleAfterMs = 24 * 60 * 60 * 1000;

export function getPatchWorkLockPath(workRoot: string | undefined, dirNames: PatchDirNames = defaultPatchDirNames): string | undefined {
  const dirs = getPatchWorkDirs(workRoot, dirNames);
  return dirs == null ? undefined : join(dirs.workDir, patchWorkLockFileName);
}

export interface PatchWorkLockDeps {
  mkdir: (dir: string) => Promise<unknown>;
  /** Open a file that must not exist yet; rejects with `code: 'EEXIST'` otherwise. */
  openExclusive: (path: string) => Promise<{ write: (text: string) => Promise<unknown>, close: () => Promise<unknown> }>;
  readFile: (path: string) => Promise<string>;
  unlink: (path: string) => Promise<unknown>;
  isPidAlive: (pid: number) => boolean;
  now: () => number;
  pid: number;
}

function errorCode(error: unknown) {
  return (error as { code?: unknown } | undefined)?.code;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isPidAlive(pid: number) {
  // `kill(pid, 0)` only asks whether the process exists. EPERM means it exists but belongs to
  // another user, which still counts as alive.
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === 'EPERM';
  }
}

const defaultDeps: PatchWorkLockDeps = {
  mkdir: async (dir) => mkdir(dir, { recursive: true }),
  openExclusive: async (path) => {
    const handle = await open(path, 'wx');
    return {
      write: (text) => handle.writeFile(text, 'utf8'),
      close: () => handle.close(),
    };
  },
  readFile: (path) => readFile(path, 'utf8'),
  unlink: (path) => unlink(path),
  isPidAlive,
  now: Date.now,
  pid: process.pid,
};

/** Locks this process holds, so a release cannot delete another window's lock. */
interface HeldLock {
  /**
  The lock file this acquisition created.

  The configured folder names can change while the lock is held (`PatchWorkSettingsDialog`
  applies them immediately); the release must still remove *this* file, so the path is part of the
  entry instead of being recomputed from the current setting.
  */
  path: string;
  /** The job that took it (export, finish, ...). */
  owner: string;
  /** The page load that took it: two windows of one process are different holders. */
  holderId: string;
  /** The `startedAt` written into the lock file, so a pid that was reused is not mistaken for us. */
  startedAt: number;
}

/**
Locks this process holds, keyed by the work area they protect.

The lock file lives in `<work root>/<work dir name>`, and that name can be changed while a job
runs. Keying by the lock *path* would make the release look up a different entry after a rename:
it would not find the lock it took, and the file (which names a live pid) would keep the area busy
for up to a day. The work root is the identity of the shared area, so it keys the entry.
*/
const heldLocks = new Map<string, HeldLock>();

const caseInsensitivePaths = process.platform === 'win32' || process.platform === 'darwin';

/** The bookkeeping key of a work area (`undefined`: no work area, so no lock). */
function heldLockKey(workRoot: string | undefined) {
  const trimmed = workRoot?.trim();
  if (trimmed == null || trimmed === '') return undefined;
  // One area spelled differently (`C:/work`, `C:\work\`, `C:\Work`) is still one area.
  const resolved = resolve(trimmed);
  return caseInsensitivePaths ? resolved.toLowerCase() : resolved;
}


/** The owner of an acquire call that does not name its job. */
const defaultLockOwner = '';

/** The holder of a lock taken outside a renderer page (the main process itself). */
const defaultHolderId = 'main';

/**
The holder id of a renderer page.

One page load is one holder: a reload is a new page, and a crashed page cannot release its lock
any more. The main process releases the locks of a holder when its web contents goes away or
navigates (see `releasePatchWorkLocksForHolder`).
*/
export function patchWorkLockHolderIdForWebContents(id: number | undefined): string {
  return id == null ? defaultHolderId : `wc:${id}`;
}

async function readLockFile(path: string, deps: PatchWorkLockDeps): Promise<PatchWorkLockHolder | undefined> {
  try {
    return parsePidLockFile(await deps.readFile(path));
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined;
    throw error;
  }
}

/**
Take the work-area lock for a job.

`{ ok: true }` means this job owns the lock. `owner` names the job (export, finish, rename, ...)
and `holderId` the page load that runs it: one process may run several jobs in different windows,
so a *second* job - or the same job of another window - must be refused just like another process
would be. Only the very same job of the same holder may take the lock twice. `busy` means another
job (or another live window) holds it; the caller refuses and says so.
*/
export async function acquirePatchWorkLock({ workRoot, owner = defaultLockOwner, holderId = defaultHolderId, deps: overrides, dirNames = defaultPatchDirNames }: {
  workRoot?: string | undefined;
  /** The job taking the lock: another job of one process is busy, the same job is re-entrant. */
  owner?: string | undefined;
  /** The page load taking the lock: another window is busy, the same one is re-entrant. */
  holderId?: string | undefined;
  deps?: Partial<PatchWorkLockDeps> | undefined;
  /** The configured folder names (the lock lives in the work area). */
  dirNames?: PatchDirNames | undefined;
} = {}): Promise<PatchWorkLockAcquireResult> {
  const deps = { ...defaultDeps, ...overrides };
  const path = getPatchWorkLockPath(workRoot, dirNames);
  const key = heldLockKey(workRoot);
  // No working directory: there is no shared work area to protect (the results go next to the
  // source, which the same-source claim already guards).
  if (path == null || key == null) return { ok: true };
  const held = heldLocks.get(key);
  if (held != null) {
    if (held.owner === owner && held.holderId === holderId) return { ok: true };
    // Another job of this process is writing the same work area: the lock file says this process
    // owns it, so wait for it like for another window instead of reporting the pid.
    return { ok: false, reason: 'busy', holder: undefined };
  }

  try {
    await deps.mkdir(dirname(path));
  } catch (error) {
    return { ok: false, reason: 'error', message: errorMessage(error) };
  }

  // Three attempts: the second one after taking over a stale lock usually succeeds, and a racer that
  // re-created the file in between must not turn a free lock into a `busy` report.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const handle = await deps.openExclusive(path);
      const startedAt = deps.now();
      try {
        // eslint-disable-next-line no-await-in-loop
        await handle.write(serializePidLockFile({ pid: deps.pid, startedAt }));
      } finally {
        // eslint-disable-next-line no-await-in-loop
        await handle.close();
      }
      heldLocks.set(key, { path, owner, holderId, startedAt });
      return { ok: true };
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') return { ok: false, reason: 'error', message: errorMessage(error) };

      let holder: PatchWorkLockHolder | undefined;
      try {
        // eslint-disable-next-line no-await-in-loop
        holder = await readLockFile(path, deps);
      } catch (readError) {
        return { ok: false, reason: 'error', message: errorMessage(readError) };
      }

      // A lock that names this process but is not tracked here belongs to a page that is gone. It is
      // released by the lifecycle hooks (see `releasePatchWorkLocksForHolder`), so it is not taken
      // over here: another window may have opened the same work area with a differently spelled
      // root, and taking its lock over would break the mutual exclusion this lock exists for.
      const stale = holder == null || isPidLockFileStale({
        lock: holder,
        alive: deps.isPidAlive(holder.pid),
        now: deps.now(),
        staleMs: staleAfterMs,
      });
      if (!stale) return { ok: false, reason: 'busy', holder };

      // eslint-disable-next-line no-await-in-loop
      await deps.unlink(path).catch(() => undefined);
    }
  }

  return { ok: false, reason: 'busy', holder: undefined };
}

/**
Release one held lock, and only the file that still names that acquisition.

The lock may have been taken over since (a pid that looked dead, the pid being reused): deleting
it would free a lock another window now owns.
*/
async function releaseHeldLock(held: HeldLock, deps: PatchWorkLockDeps) {
  let holder: PatchWorkLockHolder | undefined;
  try {
    holder = await readLockFile(held.path, deps);
  } catch {
    return;
  }
  if (holder != null && (holder.pid !== deps.pid || holder.startedAt !== held.startedAt)) return;
  await deps.unlink(held.path).catch(() => undefined);
}

/** Release the lock a job of this process holds (a no-op when another job, or nobody, holds it). */
export async function releasePatchWorkLock({ workRoot, owner = defaultLockOwner, holderId = defaultHolderId, deps: overrides }: {
  workRoot?: string | undefined;
  /** The job releasing the lock; a different job's lock is left alone. */
  owner?: string | undefined;
  /** The page load releasing the lock; another window's lock is left alone. */
  holderId?: string | undefined;
  deps?: Partial<PatchWorkLockDeps> | undefined;
} = {}): Promise<void> {
  const deps = { ...defaultDeps, ...overrides };
  const key = heldLockKey(workRoot);
  if (key == null) return;
  const held = heldLocks.get(key);
  if (held == null || held.owner !== owner || held.holderId !== holderId) return;
  heldLocks.delete(key);
  // The path the lock was *taken* with: the configured folder names may have changed since.
  await releaseHeldLock(held, deps);
}

/**
Release every lock a page load holds.

Called when its web contents is destroyed or navigates: a reload or a crash skips the renderer's
own `finally`, and the lock would otherwise stay with a page that no longer exists (the file names
a live pid, so no other window would ever take it over).
*/
export async function releasePatchWorkLocksForHolder(holderId: string, { deps: overrides }: { deps?: Partial<PatchWorkLockDeps> | undefined } = {}): Promise<void> {
  const deps = { ...defaultDeps, ...overrides };
  const held = [...heldLocks].filter(([, entry]) => entry.holderId === holderId);
  // Drop them from the map first: a page that reloads must not be refused by bookkeeping of the
  // page it replaced, and the unlink below may race with its first acquire.
  for (const [key] of held) heldLocks.delete(key);
  await Promise.all(held.map(async ([, entry]) => releaseHeldLock(entry, deps)));
}

/** Release every lock this process still holds (called when the app quits). */
export async function releaseAllPatchWorkLocks(): Promise<void> {
  const entries = [...heldLocks.values()];
  heldLocks.clear();
  await Promise.all(entries.map(async (entry) => unlink(entry.path).catch(() => undefined)));
}

/**
Remove the lock of a work area whose owner is gone, before a cleanup inspects it.

A live lock is left in place: the cleanup then sees it as an entry it must not touch and keeps
the whole work area (see `getWorkDirClearDecision`).
*/
export async function removeStalePatchWorkLock(workDir: string, { deps: overrides }: { deps?: Partial<PatchWorkLockDeps> | undefined } = {}): Promise<void> {
  const deps = { ...defaultDeps, ...overrides };
  const path = join(workDir, patchWorkLockFileName);
  let holder: PatchWorkLockHolder | undefined;
  try {
    holder = await readLockFile(path, deps);
  } catch {
    return;
  }
  if (holder == null) return;
  const stale = isPidLockFileStale({
    lock: holder,
    alive: deps.isPidAlive(holder.pid),
    now: deps.now(),
    staleMs: staleAfterMs,
  });
  if (stale) await deps.unlink(path).catch(() => undefined);
}
