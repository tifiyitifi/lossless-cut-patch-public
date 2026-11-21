/**
Free-space estimation for the writes of an export (pure, fork-owned).

Patch mode writes every result into a work area before the job is finished, and videos are large:
a full disk in the middle of a cut leaves half-written files and costs the user time. The renderer
therefore estimates the bytes an export will add, compares them with the free space of the target
volume, and cancels before anything is written.

The estimate is deliberately conservative for the values it knows: a cancelled export is cheap, a
half-written one is not. It is a hint, not a guarantee - ffmpeg may still run out of space (the
existing disk-full dialog covers that case). When the source size or duration is unknown, that
write is skipped instead: the app cannot know more than "try it", and ffmpeg's own error is the
fallback.
*/

/** How the output is produced. Encoding modes can temporarily need more than the final file. */
export type PatchSpaceEstimateMode = 'copy' | 'smartcut' | 'lossy';

/**
One write that is about to happen.

`dir` is the target directory (only its volume matters). `estimatedBytes` is how much the write
adds. `reclaimBytes` is the size of a file at the same path that ffmpeg truncates before writing
it: that much space becomes available again, so it does not have to be free up front.
*/
export interface PatchSpaceWrite {
  dir: string;
  estimatedBytes: number;
  reclaimBytes?: number | undefined;
}

/** Extra room on top of the estimate (keyframe overshoot, container overhead, other writers). */
export const patchSpaceSafetyFactor = 1.1;

/** Always leave this much free on the volume (the OS and the app itself still need room). */
export const patchSpaceMinFreeBytes = 64 * 1024 * 1024;

/** Container/index overhead per output file (chapters, the moov atom, ...). */
export const patchSpaceFileOverheadBytes = 8 * 1024 * 1024;

/**
How much bigger than the copied portion a segment can get.

- `copy`: lossless stream copy, proportional to the copied duration.
- `smartcut`: re-encodes the part before the next keyframe into a temporary file, then concatenates
  it with the copied part: peak usage is roughly the temporary parts plus the final file.
- `lossy`: encodes the whole segment; the source size is only a rough guide, so leave extra room.
*/
const modeFactors: Record<PatchSpaceEstimateMode, number> = {
  copy: 1,
  smartcut: 2.2,
  lossy: 1.5,
};

export interface PatchSpaceSegment {
  start: number;
  end: number;
}

/**
Estimated bytes the data of `segments` takes, without the per-file container overhead.

The app already estimates a single segment's size as `sourceSize * duration / sourceDuration`
(see the segment list); this is the same basis, with room for the selected mode. Overlapping
segments are not clamped: they really do copy the same data more than once.

`estimateCutBytes` adds the overhead of every file it describes. A caller that concatenates the
segments into one file (`estimateConcatBytes`) needs the data alone, so the single output's
overhead is added exactly once.
*/
export function estimateSegmentBytes({ sourceBytes, sourceDuration, segments, mode }: {
  sourceBytes: number;
  sourceDuration: number | undefined;
  segments: readonly PatchSpaceSegment[];
  mode: PatchSpaceEstimateMode;
}): number | undefined {
  if (!Number.isFinite(sourceBytes) || sourceBytes <= 0 || sourceDuration == null || !Number.isFinite(sourceDuration) || sourceDuration <= 0) return undefined;

  const selectedDuration = segments.reduce((total, segment) => total + Math.max(0, segment.end - segment.start), 0);
  if (!(selectedDuration > 0)) return 0;

  const copiedBytes = (sourceBytes * selectedDuration) / sourceDuration;
  return Math.ceil(copiedBytes * modeFactors[mode]);
}

/** Estimated bytes the cut files of `segments` write, including one container overhead per file. */
export function estimateCutBytes({ sourceBytes, sourceDuration, segments, mode }: {
  sourceBytes: number;
  sourceDuration: number | undefined;
  segments: readonly PatchSpaceSegment[];
  mode: PatchSpaceEstimateMode;
}): number | undefined {
  const bytes = estimateSegmentBytes({ sourceBytes, sourceDuration, segments, mode });
  if (bytes == null || bytes === 0) return bytes;
  return bytes + patchSpaceFileOverheadBytes * segments.length;
}

/** Estimated bytes a concatenation of already existing files writes (stream copy, so ~their sum). */
export function estimateConcatBytes({ inputBytes }: { inputBytes: number }): number {
  const safeInput = Number.isFinite(inputBytes) && inputBytes > 0 ? inputBytes : 0;
  return Math.ceil(safeInput + patchSpaceFileOverheadBytes);
}

/** Bytes a single write still needs: the estimate minus what the truncation of the old file frees. */
export function requiredWriteBytes({ estimatedBytes, reclaimBytes = 0 }: Pick<PatchSpaceWrite, 'estimatedBytes' | 'reclaimBytes'>): number {
  const estimated = Number.isFinite(estimatedBytes) ? Math.max(0, estimatedBytes) : 0;
  const reclaim = Number.isFinite(reclaimBytes) ? Math.max(0, reclaimBytes) : 0;
  return Math.max(0, Math.ceil(estimated - reclaim));
}

export interface PatchSpaceVerdict {
  sufficient: boolean;
  /** The estimate including the safety margin and the free-space floor. */
  requiredBytes: number;
  freeBytes: number;
  shortfallBytes: number;
}

/**
Compare a requirement with the free space of a volume.

The safety factor and the floor are applied here, so the dialog can show the same number the
decision was made with. A requirement of zero never warns: nothing is written.
*/
export function evaluatePatchSpace({ requiredBytes, freeBytes }: { requiredBytes: number; freeBytes: number }): PatchSpaceVerdict {
  const free = Number.isFinite(freeBytes) ? Math.max(0, freeBytes) : 0;
  if (!(requiredBytes > 0)) return { sufficient: true, requiredBytes: 0, freeBytes: free, shortfallBytes: 0 };

  const target = Math.ceil(requiredBytes * patchSpaceSafetyFactor + patchSpaceMinFreeBytes);
  return {
    sufficient: free >= target,
    requiredBytes: target,
    freeBytes: free,
    shortfallBytes: Math.max(0, target - free),
  };
}
