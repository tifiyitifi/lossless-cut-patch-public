import { dirname } from 'node:path';

import type { PatchDeleteOutcome, PatchDeleteStatus, PatchDetachableReport } from '../../../common/features/patchDeletable/index.js';
import { isSamePath } from '../../../common/features/patchFinish/paths.js';
import { isFileLockError } from '../../../common/features/patchPlayer/renameResult.js';

/**
Delete detached sources for good (fork-owned).

The check panel only offers sources the fresh report calls deletable (by default a kept result on
disk; more if the user allowed extra kinds in the deletion settings), but the decision is made again
here, right before the unlink: the panel may have been open for a while, a finish job may have moved
things, and the renderer must not be able to name a file that is not a detached source. Every file
is checked against a fresh report of the work area - built with the same settings the panel read -
and a file the app cannot prove belongs there is refused instead of deleted.

Windows refuses to unlink a file a player holds open, so the caller releases its players and stops
its ffmpeg readers first; a file that is still locked afterwards is reported as `locked`, never
retried into a `failed` and never replaced with a second, different path.
*/

const lockRetryDelays = [100, 200, 400, 800];

function errorCode(err: unknown) {
  const code = (err as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

async function withLockRetry<T>(operation: () => Promise<T>, sleep: (ms: number) => Promise<void>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await operation();
    } catch (err) {
      const delay = lockRetryDelays[attempt];
      if (!isFileLockError(err) || delay == null) throw err;
      // eslint-disable-next-line no-await-in-loop
      await sleep(delay);
    }
  }
}

export interface PatchDeleteDetachedParams {
  workRoot: string | undefined;
  paths: readonly string[];
  caseInsensitive: boolean;
}

export interface PatchDeleteDetachedDeps {
  /** A fresh report of the work area (the authoritative pairing at delete time). */
  readReport: (workRoot: string | undefined) => Promise<PatchDetachableReport>;
  exists: (path: string) => Promise<boolean>;
  /** Is one of this app's windows showing this file? Windows would refuse the unlink anyway. */
  isOpenElsewhere: (path: string) => boolean;
  /** Let the players go of their video before the unlink (the caller keeps the windows). */
  releasePlayers: () => Promise<void> | void;
  /** Stop the ffmpeg processes reading these files (previews, probes). */
  stopReaders: (paths: readonly string[]) => Promise<void>;
  unlink: (path: string) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  log?: ((message: string, ...args: unknown[]) => void) | undefined;
}

export interface PatchDeleteDetachedResult {
  /** One outcome per requested path, in the order the caller asked. */
  outcomes: PatchDeleteOutcome[];
}

/** What the fresh report says about this path, before anything is touched. */
async function classifyDetachedPath({ path, report, params, deps }: {
  path: string;
  report: PatchDetachableReport;
  params: PatchDeleteDetachedParams;
  deps: PatchDeleteDetachedDeps;
}): Promise<PatchDeleteStatus | 'ok'> {
  const { caseInsensitive } = params;
  const row = report.rows.find((candidate) => isSamePath(candidate.path, path, { caseInsensitive }));
  // Not a source of this folder any more: the panel's list is stale, or the path does not belong to
  // this work area at all.
  if (row == null || !row.deletable) return 'not-deletable';

  // Belt and braces: the report decides by its own scan, this checks the shape of the path too, so a
  // hand-crafted request cannot reach a file of a sibling folder (`detached_src_media2`, a source of
  // `finished_src_media` reached by `..`).
  const mediaDir = report.detachedSrcMediaDir;
  if (mediaDir == null || !isSamePath(dirname(path), mediaDir, { caseInsensitive })) return 'not-deletable';

  if (!(await deps.exists(path))) return 'missing';
  if (deps.isOpenElsewhere(path)) return 'open-elsewhere';
  return 'ok';
}

/**
Delete the requested detached sources.

Paths are de-duplicated (case-insensitively), validated against a fresh report, and then deleted one
at a time. A failure only affects that file: the others are still attempted, and the caller gets one
outcome per requested path.
*/
export async function deletePatchDetachedSources(
  params: PatchDeleteDetachedParams,
  deps: PatchDeleteDetachedDeps,
): Promise<PatchDeleteDetachedResult> {
  const requested: string[] = [];
  for (const path of params.paths) {
    if (path.trim() === '') continue;
    if (requested.some((existing) => isSamePath(existing, path, { caseInsensitive: params.caseInsensitive }))) continue;
    requested.push(path);
  }
  if (requested.length === 0) return { outcomes: [] };

  const report = await deps.readReport(params.workRoot);

  const outcomes = new Map<string, PatchDeleteOutcome>();
  const deletable: string[] = [];
  for (const path of requested) {
    // eslint-disable-next-line no-await-in-loop -- one file at a time keeps a big folder's checks cheap
    const status = await classifyDetachedPath({ path, report, params, deps });
    if (status === 'ok') deletable.push(path);
    else outcomes.set(path, { path, status });
  }

  if (deletable.length > 0) {
    // The files are about to disappear: nothing of ours may keep a handle on them (Windows), and the
    // preview ffmpeg of another window is stopped for the same reason.
    await deps.releasePlayers();
    await deps.stopReaders(deletable);

    for (const path of deletable) {
      try {
        // eslint-disable-next-line no-await-in-loop -- Windows wants one unlink at a time, and the report is per file
        await withLockRetry(() => deps.unlink(path), deps.sleep);
        outcomes.set(path, { path, status: 'deleted' });
      } catch (err) {
        const code = errorCode(err);
        if (code === 'ENOENT') {
          outcomes.set(path, { path, status: 'missing' });
        } else if (isFileLockError(err)) {
          deps.log?.('Failed to delete a detached source: the file is still locked', path, err);
          outcomes.set(path, { path, status: 'locked' });
        } else {
          deps.log?.('Failed to delete a detached source', path, err);
          outcomes.set(path, { path, status: 'failed', detail: errorMessage(err) });
        }
      }
    }
  }

  return { outcomes: requested.map((path) => outcomes.get(path) ?? { path, status: 'failed' as const }) };
}
