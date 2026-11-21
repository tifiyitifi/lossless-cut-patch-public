import { getParentPath, isSamePath } from '../patchFinish/paths.js';

import type { PatchFinishLedgerEntry, PatchSourceFingerprint } from './ledger.js';

/**
Which outputs a finish job left where (fork-owned, pure).

The ledger only stores what the job really produced: a result the job deleted is gone, and one it
left in the work area is not part of the finished project. The finish flow knows both from its
preview (`clips`, `merged`) and from the moves it performed, so the entry can be built without
touching the disk.

A move that did not happen (the file was already at its target) is not part of `moved`; the path
then stays as it is. Classifying by the *final* parent folder covers that case and drops deleted
results at the same time, because a deleted result still points into the work area.
*/

export interface PatchFinishLedgerDirs {
  finishedClipsDir: string | undefined;
  finishedMergedDir: string | undefined;
  detachedClipsDir: string | undefined;
  detachedMergedDir: string | undefined;
}

type OutputBucket = 'clips' | 'merged' | 'parkedClips' | 'parkedMerged';

function classifyOutput(path: string, dirs: PatchFinishLedgerDirs, caseInsensitive: boolean): OutputBucket | undefined {
  const parent = getParentPath(path);
  const isIn = (dir: string | undefined) => dir != null && isSamePath(parent, dir, { caseInsensitive });

  if (isIn(dirs.finishedClipsDir)) return 'clips';
  if (isIn(dirs.finishedMergedDir)) return 'merged';
  if (isIn(dirs.detachedClipsDir)) return 'parkedClips';
  if (isIn(dirs.detachedMergedDir)) return 'parkedMerged';
  return undefined;
}

/**
The ledger entry of a finish job, or `undefined` when it produced no result that stayed on disk.

The source is recorded at its final path: the job may have renamed it to a free name, and the
overview pairs by the file that exists now.
*/
export function buildFinishLedgerEntry({ sourcePath, newSourcePath, sourceIdentity, clipPaths, mergedPath, moved, dirs, at }: {
  /** The source as the job found it. */
  sourcePath: string;
  /** Where the job moved the source, when it moved it. */
  newSourcePath: string | undefined;
  /** The source's fingerprint, read by the caller (the works area scan pairs moved sources by it). */
  sourceIdentity?: PatchSourceFingerprint | undefined;
  /** The cut results the job knew (their paths before the job). */
  clipPaths: readonly string[];
  /** The merged result the job knew (its path before the job). */
  mergedPath: string | undefined;
  /** The moves the job performed (a file already at its target is not listed). */
  moved: readonly { from: string, to: string }[];
  dirs: PatchFinishLedgerDirs;
  /** Unix milliseconds of the job. */
  at: number;
}, { caseInsensitive }: { caseInsensitive: boolean }): PatchFinishLedgerEntry | undefined {
  const finalPath = (path: string) => moved.find((entry) => isSamePath(entry.from, path, { caseInsensitive }))?.to ?? path;

  const clips: string[] = [];
  const merged: string[] = [];
  const parkedClips: string[] = [];
  const parkedMerged: string[] = [];

  const place = (path: string, bucket: OutputBucket) => {
    switch (bucket) {
      case 'clips': { clips.push(path); break; }
      case 'merged': { merged.push(path); break; }
      case 'parkedClips': { parkedClips.push(path); break; }
      case 'parkedMerged': { parkedMerged.push(path); break; }
      default: { break; }
    }
  };

  for (const clipPath of clipPaths) {
    const target = finalPath(clipPath);
    const bucket = classifyOutput(target, dirs, caseInsensitive);
    if (bucket != null) place(target, bucket);
  }

  if (mergedPath != null) {
    const target = finalPath(mergedPath);
    const bucket = classifyOutput(target, dirs, caseInsensitive);
    if (bucket === 'merged' || bucket === 'parkedMerged') place(target, bucket);
  }

  if (clips.length === 0 && merged.length === 0 && parkedClips.length === 0 && parkedMerged.length === 0) return undefined;

  return {
    source: newSourcePath ?? sourcePath,
    ...(sourceIdentity != null && { sourceIdentity }),
    clips,
    merged,
    parkedClips,
    parkedMerged,
    at,
  };
}
