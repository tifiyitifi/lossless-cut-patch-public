import prettyBytes from 'pretty-bytes';

import type {
  PatchSpaceEstimateMode, PatchSpaceSegment, PatchSpaceVerdict, PatchSpaceWrite,
} from '../../../../common/features/patchSpace';
import { estimateConcatBytes, estimateCutBytes, estimateSegmentBytes, evaluatePatchSpace, getPatchVolumeKey, requiredWriteBytes } from '../../../../common/features/patchSpace';

import i18n from '../../i18n';
import getSwal from '../../swal';
import { isMac, isWindows, readFileSize } from '../../util';
import { pathExistsSync } from '../patchExport/resultFiles';

const { existsSync } = window.require('node:fs');
const { statfs } = window.require('node:fs/promises');
const { dirname, join: pathJoin } = window.require('node:path');

/** Windows and macOS ignore the case of a path, so `C:/a` and `c:/a` must be one key. */
const volumeCaseInsensitive = isWindows || isMac;

/** The directory `statfs` can be called on: the path itself, or its nearest existing parent. */
function getExistingAncestor(dir: string) {
  let current = dir;
  for (let depth = 0; depth < 64; depth += 1) {
    if (existsSync(current)) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
  return undefined;
}

/**
Free bytes on the volume of `dir`.

`undefined` means "could not find out" (a network share, for example). The caller then lets the
operation run: ffmpeg's own disk-full error is still handled, and refusing to write because the
volume cannot be queried would be worse than trying.
*/
async function readFreeBytes(dir: string) {
  const existing = getExistingAncestor(dir);
  if (existing == null) return undefined;
  try {
    const stats = await statfs(existing);
    const free = stats.bavail * stats.bsize;
    return Number.isFinite(free) ? Math.max(0, free) : undefined;
  } catch (err) {
    console.warn('Unable to read the free space', existing, err);
    return undefined;
  }
}

/** The volume a directory lives on (a Windows drive / UNC share, or `/` on POSIX). */
function getVolumeKey(dir: string) {
  return getPatchVolumeKey(dir, { caseInsensitive: volumeCaseInsensitive });
}

async function readExistingBytes(path: string) {
  if (!pathExistsSync(path)) return 0;
  try {
    return await readFileSize(path);
  } catch (err) {
    console.warn('Unable to read the size of the file a write replaces', path, err);
    return 0;
  }
}

export interface PatchSpaceClipWrite {
  segment: PatchSpaceSegment;
  /** The result name relative to `outputDir`; undefined when the name is not known in advance. */
  name: string | undefined;
}

/**
The writes a cut export is about to do (fork-owned).

A clip that is rewritten in place frees its old bytes as ffmpeg truncates it, so only the
difference has to be free. Smart cut is the exception: the temporary parts are written while the
old result still exists, so nothing is reclaimed there. The merged file is only estimated when it
is really regenerated (a reused/renamed merged result writes nothing).
*/
export async function buildExportSpaceWrites({ sourceBytes, sourceDuration, mode, outputDir, clips, merged }: {
  sourceBytes: number;
  sourceDuration: number | undefined;
  mode: PatchSpaceEstimateMode;
  outputDir: string;
  clips: readonly PatchSpaceClipWrite[];
  merged?: { targetPath: string, estimateSegments: readonly PatchSpaceSegment[], reclaim: boolean } | undefined;
}): Promise<PatchSpaceWrite[]> {
  const targets = clips.map(({ name }) => (name != null ? pathJoin(outputDir, name) : undefined));
  // Smart cut writes temporary files while the old target still exists, so its bytes are not free.
  const reclaims = mode === 'smartcut'
    ? targets.map(() => 0)
    : await Promise.all(targets.map(async (target) => (target != null ? readExistingBytes(target) : 0)));

  const writes: PatchSpaceWrite[] = clips.map(({ segment }, index) => ({
    dir: targets[index] != null ? dirname(targets[index]) : outputDir,
    // An unknown duration/size skips the check for this write; ffmpeg's disk-full error is the fallback.
    estimatedBytes: estimateCutBytes({ sourceBytes, sourceDuration, segments: [segment], mode }) ?? 0,
    reclaimBytes: reclaims[index] ?? 0,
  }));

  if (merged != null) {
    // The concatenation adds one container overhead of its own, so only the data of the segments is
    // summed here (their own per-file overhead belongs to the cut files, not to the merged result).
    // The merge concatenates existing files with a stream copy, so the cut mode's smart-cut / lossy
    // factor does not apply to it: using it would overestimate by up to 2.2x and refuse a merge
    // that fits.
    const inputBytes = merged.estimateSegments.reduce(
      (total, segment) => total + (estimateSegmentBytes({ sourceBytes, sourceDuration, segments: [segment], mode: 'copy' }) ?? 0),
      0,
    );
    writes.push({
      dir: dirname(merged.targetPath),
      estimatedBytes: estimateConcatBytes({ inputBytes }),
      reclaimBytes: merged.reclaim ? await readExistingBytes(merged.targetPath) : 0,
    });
  }

  return writes;
}

/**
Check that the planned writes fit on their volumes; show a warning and return `false` if not.

Called before an export or a merge writes anything. Requirements of different directories on the
same volume are summed, so two writes that each fit but together do not are still caught. When a
write overwrites a file in place, the free space of that file is subtracted (`reclaimBytes`).
*/
export async function confirmPatchSpace({ writes }: { writes: readonly PatchSpaceWrite[] }) {
  const byVolume = new Map<string, { dir: string, requiredBytes: number }>();

  for (const write of writes) {
    const requiredBytes = requiredWriteBytes(write);
    if (requiredBytes > 0) {
      const key = getVolumeKey(write.dir);
      const existing = byVolume.get(key);
      if (existing == null) byVolume.set(key, { dir: write.dir, requiredBytes });
      else existing.requiredBytes += requiredBytes;
    }
  }

  const shortfalls: { dir: string, verdict: PatchSpaceVerdict }[] = [];
  for (const { dir, requiredBytes } of byVolume.values()) {
    // eslint-disable-next-line no-await-in-loop
    const freeBytes = await readFreeBytes(dir);
    if (freeBytes != null) {
      const verdict = evaluatePatchSpace({ requiredBytes, freeBytes });
      if (!verdict.sufficient) shortfalls.push({ dir, verdict });
    }
  }

  if (shortfalls.length === 0) return true;

  // Show the volume with the largest deficit; freeing that one up is what the user has to do first.
  const worst = shortfalls.reduce((a, b) => (b.verdict.shortfallBytes > a.verdict.shortfallBytes ? b : a));
  console.warn('Not enough free space', { writes, shortfalls });

  await getSwal().Swal.fire({
    icon: 'warning',
    title: i18n.t('Not enough free space'),
    text: i18n.t('Not enough free space in {{dir}}: about {{required}} is needed, but only {{free}} is available. Free up some space and try again.', {
      dir: worst.dir,
      required: prettyBytes(worst.verdict.requiredBytes),
      free: prettyBytes(worst.verdict.freeBytes),
    }),
  });

  return false;
}
