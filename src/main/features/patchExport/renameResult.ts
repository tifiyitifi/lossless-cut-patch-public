import { isFileLockError } from '../../../common/features/patchPlayer/renameResult.js';
import { normalizeManifestPath } from '../../../common/features/patchExport/manifest.js';
import { findFinishedAreaRoot, findWorkAreaRoot, resolveWorkRootForPath } from '../../../common/features/patchFinish/index.js';
import { defaultPatchDirNames } from '../../../common/features/patchWork/workDirs.js';
import type { PatchDirNames } from '../../../common/features/patchWork/workDirs.js';

/**
Renaming a cut result (fork-owned).

The results window renames a file on disk. The rename and the export manifest have to happen
together: the manifest is what the incremental export and the merge use to find the results, so
a renamed file the manifest does not know about is cut again on the next export and is skipped
by the merge.

The main process owns the manifest, so it owns the rename. Everything that touches the system is
injected (like `main/features/patch/postProcess.ts`), which keeps this testable.
*/

/** Why a rename did not happen. */
export type PatchRenameFailure = 'exists' | 'locked' | 'failed' | 'manifest' | 'busy' | 'in-use';

export interface PatchRenameOutcome {
  ok: boolean;
  reason?: PatchRenameFailure | undefined;
  /** Whether the manifest now points at the new path. */
  manifestUpdated: boolean;
}

/** How long to wait between attempts when Windows still holds the file. */
const lockRetryDelaysMs = [100, 200, 400, 800];

const defaultDelay = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

/** The file system and the manifest, injected so the logic can be unit-tested. */
export interface PatchRenameDeps {
  renameFile: (from: string, to: string) => Promise<void>;
  fileExists: (path: string) => Promise<boolean>;
  /**
  Follow the rename in the manifest. The read-modify-write happens atomically in the manifest
  queue, so a concurrent export cannot overwrite it with an older snapshot.
  */
  updateManifest: (workRoot: string | undefined, change: { from: string, to: string, label?: string | undefined, sourcePath?: string | undefined }) => Promise<{ updated: boolean }>;
  /** The working directory the user configured (the work area falls back to the source folder). */
  getConfiguredWorkRoot: () => string | undefined;
  /** The configured folder names (a source inside a renamed work area still belongs to its root). */
  getDirNames?: (() => PatchDirNames) | undefined;
  delay?: (ms: number) => Promise<void>;
  /**
  Does the file system treat `A.mp4` and `a.mp4` as the same file? On such a file system a
  case-only rename must skip the existence check (the target *is* the source), and the rename
  itself changes the stored spelling.
  */
  caseInsensitiveFs?: boolean | undefined;
  /**
  Is the backslash a path separator? On Windows it is (and it is never part of a file name), so
  `C:\a\b` and `C:/a/b` are the same file. On macOS and Linux it is an ordinary character.
  */
  backslashIsSeparator?: boolean | undefined;
  /**
  Reports a problem that does not fail the rename (the manifest could not be updated after a
  rename that only changed the spelling of the path). Injected like the file system, so this
  module stays testable outside Electron.
  */
  logWarning: (message: string, error: unknown) => void;
}

/** Do the two paths differ only in their separators (`C:\a\b` and `C:/a/b` are the same file)? */
function onlySeparatorsDiffer(a: string, b: string) {
  return a.replaceAll('\\', '/') === b.replaceAll('\\', '/');
}

/**
Rename a file, retrying while the system still holds it (Windows keeps a handle for a moment
after a player unloads it).

Shared by the rename and its undo: the undo faces the same lock, and a rollback that gives up
leaves the disk and the manifest disagreeing - the state it exists to prevent.
*/
async function renameWithLockRetry({ from, to, renameFile, delay }: {
  from: string;
  to: string;
  renameFile: (source: string, target: string) => Promise<void>;
  delay: (ms: number) => Promise<void>;
}): Promise<{ ok: true } | { ok: false, error: unknown }> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await renameFile(from, to);
      return { ok: true };
    } catch (err) {
      const retryDelay = lockRetryDelaysMs[attempt];
      if (!isFileLockError(err) || retryDelay == null) return { ok: false, error: err };
      // eslint-disable-next-line no-await-in-loop
      await delay(retryDelay);
    }
  }
}

/**
The work area a rename belongs to.

The rename updates the manifest of exactly this area, so the lock (`renameResultLocked`) has to be
taken on the same one. The result's own area wins: a file in `losslesscut_finished` (or in a work
area) of some root belongs to that root, even when another root is configured - otherwise the
manifest of the wrong area is written and the next export cuts the renamed file again. A result
outside every area keeps the old resolution: the source's root, else the configured one. The ledger
call in the main process uses this too, so both writes agree by construction.
*/
export function resolveRenameWorkRoot({ from, sourcePath }: { from: string, sourcePath?: string | undefined }, getConfiguredWorkRoot: () => string | undefined, dirNames: PatchDirNames = defaultPatchDirNames) {
  return findWorkAreaRoot(from, dirNames)
    ?? findFinishedAreaRoot(from, dirNames)
    ?? (sourcePath != null
      ? resolveWorkRootForPath({ path: sourcePath, workRoot: getConfiguredWorkRoot(), dirNames })
      : getConfiguredWorkRoot());
}

/**
Rename a cut result and keep the export manifest in sync.

The manifest is updated after the rename; if that fails, the rename is undone, so the disk and
the manifest never disagree.
*/
export async function renameResult({ from, to, sourcePath, label }: {
  from: string,
  to: string,
  /** The source file the result was cut from; it locates the work area. */
  sourcePath?: string | undefined,
  /** The new label, when the rename changed it. */
  label?: string | undefined,
}, deps: PatchRenameDeps): Promise<PatchRenameOutcome> {
  const { renameFile, fileExists, updateManifest, getConfiguredWorkRoot, getDirNames, logWarning } = deps;
  const delay = deps.delay ?? defaultDelay;
  const caseInsensitiveFs = deps.caseInsensitiveFs ?? (process.platform === 'win32' || process.platform === 'darwin');
  const backslashIsSeparator = deps.backslashIsSeparator ?? process.platform === 'win32';

  // patch: the result's own area wins, so the manifest of the area that holds the file is updated.
  const workRoot = resolveRenameWorkRoot({ from, sourcePath }, getConfiguredWorkRoot, getDirNames?.() ?? defaultPatchDirNames);

  if (from === to) return { ok: true, manifestUpdated: false };

  // A rename that only changes the spelling of the path (`Clip.mp4` -> `clip.mp4`, or a different
  // separator). On a case-insensitive file system `to` resolves to `from` itself, so the existence
  // check would always say "exists" and the rename would never happen.
  const sameFile = caseInsensitiveFs
    ? normalizeManifestPath(from, { caseInsensitive: true }) === normalizeManifestPath(to, { caseInsensitive: true })
    : from === to;
  const spellingOnlyChange = sameFile && from !== to;

  // Only the separators differ (`C:\clips\a.mp4` -> `C:/clips/a.mp4`): it is the same file and
  // its name does not change, so there is nothing to move. A case-only change is a real rename
  // (the name of the file changes), so it is not a no-op.
  if (spellingOnlyChange && backslashIsSeparator && onlySeparatorsDiffer(from, to)) {
    // The file does not move, but the manifest should know the spelling the user asked for (and
    // the new label): it is the same file, so the next export finds it either way.
    if (workRoot == null) return { ok: true, manifestUpdated: false };
    try {
      const { updated } = await updateManifest(workRoot, { from, to, label, sourcePath });
      return { ok: true, manifestUpdated: updated };
    } catch (err) {
      // Nothing moved, so there is nothing to undo: the manifest keeps the old spelling of the
      // same file, which the next export still finds.
      logWarning('Failed to update the export manifest after a rename that only changed the spelling', err);
      return { ok: true, manifestUpdated: false };
    }
  }

  if (!spellingOnlyChange && await fileExists(to)) return { ok: false, reason: 'exists', manifestUpdated: false };

  const moved = await renameWithLockRetry({ from, to, renameFile, delay });
  if (!moved.ok) {
    return { ok: false, reason: isFileLockError(moved.error) ? 'locked' : 'failed', manifestUpdated: false };
  }

  // Without a work area there is no manifest to update (the results were not tracked).
  if (workRoot == null) return { ok: true, manifestUpdated: false };

  try {
    // The manifest knows the result by the source it was cut from: only that record is updated.
    const { updated } = await updateManifest(workRoot, { from, to, label, sourcePath });
    return { ok: true, manifestUpdated: updated };
  } catch (manifestError) {
    // Undo the rename: a file the manifest does not know about would be cut again.
    const rolledBack = await renameWithLockRetry({ from: to, to: from, renameFile, delay });
    if (!rolledBack.ok) {
      // The caller reports the manifest problem; a rollback that stays blocked leaves a file the
      // manifest does not know, which the next export regenerates - say so in the log.
      logWarning('Failed to undo the rename after the export manifest could not be updated', { manifestError, rollbackError: rolledBack.error });
    }
    return { ok: false, reason: 'manifest', manifestUpdated: false };
  }
}

/** The work-area lock, injected so the wrapper is testable without a file system. */
export interface PatchRenameLockDeps {
  /** Take the lock of this work area (`acquirePatchWorkLock` in `main/features/patchWork`). */
  acquireLock: (workRoot: string | undefined) => Promise<{ ok: true } | { ok: false, reason: string }>;
  releaseLock: (workRoot: string | undefined) => Promise<unknown>;
  /**
  Which of these files another window plays right now? (`findResultFilesClaimedElsewhere`)

  The player holds the file open: a rename would fail with "file in use" on Windows, and on any
  system the player would lose its file mid-playback.
  */
  findInUse?: ((paths: readonly string[]) => Promise<string[]>) | undefined;
}

/**
Rename a cut result while holding the work-area lock.

Two windows of the app may share one work area (`allowMultipleInstances`). The rename writes a
file and the manifest, which is exactly what an export and a finish job do - they take this lock
(``.export.lock``), so the rename has to take it too or it can race them into a name collision, a
locked file on Windows and a manifest record lost between two read-modify-writes.

A busy lock is reported instead of waited for: the rename comes from a dialog, and telling the
user another window is using the work folder is more useful than a spinner that outlives their
patience.
*/
export async function renameResultLocked({ from, to, ...rest }: {
  from: string,
  to: string,
  /** The source file the result was cut from; it locates the work area. */
  sourcePath?: string | undefined,
  /** The new label, when the rename changed it. */
  label?: string | undefined,
}, deps: PatchRenameDeps, lock: PatchRenameLockDeps): Promise<PatchRenameOutcome> {
  // Nothing moves and nothing is written: no reason to wait for another window.
  if (from === to) return { ok: true, manifestUpdated: false };

  const workRoot = resolveRenameWorkRoot({ from, sourcePath: rest.sourcePath }, deps.getConfiguredWorkRoot, deps.getDirNames?.() ?? defaultPatchDirNames);
  const acquired = await lock.acquireLock(workRoot);
  if (!acquired.ok) {
    if (acquired.reason !== 'busy') deps.logWarning('Failed to take the work-area lock for a rename', acquired);
    return { ok: false, reason: acquired.reason === 'busy' ? 'busy' : 'failed', manifestUpdated: false };
  }

  try {
    if (lock.findInUse != null && (await lock.findInUse([from])).length > 0) {
      return { ok: false, reason: 'in-use', manifestUpdated: false };
    }
    return await renameResult({ from, to, ...rest }, deps);
  } finally {
    // A release that fails leaves a lock file behind; it is taken over once this process is gone
    // (see `removeStalePatchWorkLock`), so it must not turn a successful rename into an error.
    await lock.releaseLock(workRoot).catch(() => undefined);
  }
}
