/**
Tiny pid lock files (pure, fork-owned).

Two windows of the app may share one work area (`allowMultipleInstances`). The work area's
manifest is read-modify-written by the main process with an in-process queue, so two processes
would overwrite each other's records; and a finish job moves and deletes the files another
window is cutting. The app cannot lock files across processes, so it writes a lock file with the
owner's pid and treats it as stale when that process is gone.

The content is plain JSON and is re-validated on read: a lock file that cannot be parsed is
treated as stale, so a corrupted file (or a crash while writing one) cannot block the app for
good.
*/

export interface PidLockFile {
  /** The process that owns the lock. */
  pid: number;
  /** Epoch ms the lock was taken (a fallback for a pid that was reused). */
  startedAt: number;
}

/** Parse a lock file; `undefined` for anything that is not a usable lock. */
export function parsePidLockFile(text: string): PidLockFile | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed == null || Array.isArray(parsed)) return undefined;
  const { pid, startedAt } = parsed as { pid?: unknown, startedAt?: unknown };
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0 || typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return undefined;
  return { pid, startedAt };
}

export function serializePidLockFile(lock: PidLockFile): string {
  return JSON.stringify(lock);
}

/**
May this lock be taken over?

The owner is gone (`alive` false - the process was killed) or the lock is older than `staleMs`
(a pid the system handed to another process, or a clock that went backwards). A lock whose
owner is alive and young is honoured, whatever it says.
*/
export function isPidLockFileStale({ lock, alive, now, staleMs }: {
  lock: PidLockFile;
  alive: boolean;
  now: number;
  staleMs: number;
}): boolean {
  if (!alive) return true;
  if (!Number.isFinite(staleMs) || staleMs <= 0) return false;
  return now - lock.startedAt > staleMs;
}
