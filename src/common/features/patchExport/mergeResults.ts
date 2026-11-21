import type { PatchExportFileRecord, PatchManifestMergedInput, PatchManifestSegmentRecord } from './manifest.js';
import { roundPatchTime } from './time.js';
import compareStrings from './stringOrder.js';
import type { PatchTailMode } from '../patchExportPolicy/tailEnd.js';

/**
Merging the cut results of one source into a single file (pure logic).

The results are the manifest's records for the source, so the merge also works after a restart
and covers the results of every incremental export. Merging writes to the work area's `merged`
directory and records the merged file in the same manifest, so the next merge (and a later
export with merging enabled) can reuse it.
*/

/** One cut result as the merge sees it: the manifest record plus its stable segment id. */
export interface PatchMergeClip {
  segId: string;
  start: number;
  end: number;
  label?: string | undefined;
  path: string;
  /** The source segment's color, so the merged result reuses the same scheme. */
  segColorIndex?: number | undefined;
  /** The export signature the clip was cut with (the fingerprint of its content). */
  signature?: string | undefined;
  /** How the clip reaches its end (fork-owned, part of its identity). */
  tail?: PatchTailMode | undefined;
}

/**
The order the cut results are merged in (fork-owned).

Patch mode cuts and merges in the cut queue's order, and that order is recorded by the export (see
`PatchExportFileRecord.order`). It is the order the user sees in the cutting window and in the
results player, so a merge must follow it - the timeline order would silently undo a reorder.

A record written before the order was kept, or one whose identities no longer match (a project
reloaded with new ids), has no usable order: the merge then falls back to timeline order, which is
what it always did.

Only the recorded results are returned: an identity the manifest does not hold (a result a
deselected segment no longer contributes, or one a finish job moved away) is not merged.
*/
export function resolveMergeOrder({ order, segments }: {
  order?: readonly string[] | undefined;
  segments: Readonly<Record<string, PatchManifestSegmentRecord>>;
}): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const segId of order ?? []) {
    if (seen.has(segId) || !Object.hasOwn(segments, segId)) continue;
    seen.add(segId);
    ordered.push(segId);
  }
  if (ordered.length > 0) return ordered;

  return Object.entries(segments)
    .sort(([segIdA, a], [segIdB, b]) => a.start - b.start || compareStrings(segIdA, segIdB))
    .map(([segId]) => segId);
}

/** One manifest record as the merge / finish flows see it. */
function toMergeClip(segId: string, segment: PatchManifestSegmentRecord): PatchMergeClip {
  return {
    segId,
    start: segment.start,
    end: segment.end,
    label: segment.label,
    path: segment.path,
    segColorIndex: segment.segColorIndex,
    signature: segment.signature,
    ...((segment.tail !== undefined) && { tail: segment.tail }),
  };
}

/**
The cut results to merge, in the order of the last export's cut queue.

That order is the recorded one when the manifest has it, and timeline order otherwise (see
`resolveMergeOrder`). The merged file is the concatenation of the results in this order, so the
fingerprint of a merge and of an export with merging enabled agree.
*/
export function collectMergeClips(record: PatchExportFileRecord | undefined): PatchMergeClip[] {
  if (record == null) return [];

  return resolveMergeOrder({ order: record.order, segments: record.segments })
    .map((segId) => toMergeClip(segId, record.segments[segId]!));
}

/**
Every cut result the manifest still tracks for this source (fork-owned).

The finish flow works on the whole work area, not on the last export: a job may leave its results in
`clips/` (`clips: keep`) for a later pass, and another export of other segments must not hide them.
The merge itself still follows the recorded order only (`collectMergeClips`): it concatenates the
results of one export.

The recorded order comes first (the merge order the user sees), then the results that are not part
of it, in timeline order.
*/
export function listTrackedClips(record: PatchExportFileRecord | undefined): PatchMergeClip[] {
  if (record == null) return [];

  const ordered = resolveMergeOrder({ order: record.order, segments: record.segments });
  const inOrder = new Set(ordered);
  const rest = Object.entries(record.segments)
    .filter(([segId]) => !inOrder.has(segId))
    .sort(([segIdA, a], [segIdB, b]) => a.start - b.start || compareStrings(segIdA, segIdB))
    .map(([segId]) => segId);

  return [...ordered, ...rest].map((segId) => toMergeClip(segId, record.segments[segId]!));
}

export interface PatchMergeSignatureInput {
  /**
  The clips that go into the merge, in merge order.

  Every clip carries the signature of the export that cut it: the merged file is the
  concatenation of the clips, so it changes whenever a clip changes - not only when the export
  settings change.
  */
  segments: readonly { segId: string, start: number, end: number, label?: string | undefined, signature?: string | undefined, tail?: PatchTailMode | undefined }[];
  merge: {
    outFormat: string | undefined;
    ffmpegExperimental: boolean;
    preserveMovData: boolean;
    movFastStart: boolean;
    preserveMetadataOnMerge: boolean;
  };
  /**
  Do the labels become part of the file? Only when they are written into the container as
  chapters: otherwise a relabeled clip is the same media, and rebuilding the merged file for a
  new name would be wasted work (the merge renames the file instead).
  */
  labelsAffectContent?: boolean | undefined;
}

/**
The fingerprint of a merged file.

Deliberately the same shape (and key order) the export uses for its merged output, so a merge of
the cut results and an export with merging enabled share one merged file instead of producing
two. A merge whose labels are not written into the file uses another version, so the file of an
older build (whose labels were part of the fingerprint) is rebuilt once instead of being reused
with a signature that means something else now.
*/
export function buildMergedSignatureInput({ segments, merge, labelsAffectContent = true }: PatchMergeSignatureInput) {
  return {
    version: labelsAffectContent ? 2 : 3,
    // A reopened project parses its times with nanosecond precision: round them the same way so an
    // unchanged cut keeps the same merged signature instead of rebuilding the merged file.
    segments: segments.map((segment) => ({
      segId: segment.segId,
      start: roundPatchTime(segment.start),
      end: roundPatchTime(segment.end),
      ...(labelsAffectContent && { label: segment.label }),
      signature: segment.signature,
      ...((segment.tail !== undefined) && { tail: segment.tail }),
    })),
    merge: {
      outFormat: merge.outFormat,
      ffmpegExperimental: merge.ffmpegExperimental,
      preserveMovData: merge.preserveMovData,
      movFastStart: merge.movFastStart,
      preserveMetadataOnMerge: merge.preserveMetadataOnMerge,
    },
  };
}

/** What the merged file was built from: the identifying fields of one cut result. */
export interface PatchMergeInputClip {
  segId: string;
  start: number;
  end: number;
  /** The export signature the result was cut with (the fingerprint of its content). */
  signature?: string | undefined;
  /** How the result reaches its end (fork-owned, part of its identity). */
  tail?: PatchTailMode | undefined;
}

/**
The inputs to record with a merged file (fork-owned).

Times are rounded like `buildMergedSignatureInput` rounds them, so a project reopened with
nanosecond precision still matches the merge that was recorded from it.
*/
export function buildMergedInputs(clips: readonly PatchMergeInputClip[]): PatchManifestMergedInput[] {
  return clips.map((clip) => ({
    segId: clip.segId,
    start: roundPatchTime(clip.start),
    end: roundPatchTime(clip.end),
    ...((clip.signature !== undefined) && { signature: clip.signature }),
    ...((clip.tail !== undefined) && { tail: clip.tail }),
  }));
}

/**
Does the merged file contain exactly these cut results? (fork-owned)

The merged record names the results it was built from, which is the only reliable proof: the
modification times of two files say nothing about their order once the work area was copied,
restored from a backup or touched by another app. A result that was cut again after the merge
has another time range, another signature or no signature at all, and then it cannot be proven:
the finish job must not delete it.

The order does not matter: a merged file holds the same material whatever order the results were
joined in, so deleting them loses nothing either way.
*/
export function mergedClipsMatchInputs({ inputs, clips }: {
  /** The inputs the merge recorded (undefined for a merge recorded before they were kept). */
  inputs: readonly PatchManifestMergedInput[] | undefined;
  /** The cut results that are still there. */
  clips: readonly PatchMergeInputClip[];
}): boolean {
  if (inputs == null || inputs.length !== clips.length) return false;

  const bySegId = new Map(inputs.map((input) => [input.segId, input]));
  // A result named twice proves nothing about which one went into the merge.
  if (bySegId.size !== inputs.length) return false;

  return clips.every((clip) => {
    const input = bySegId.get(clip.segId);
    // A result without a signature cannot be proven to be the one the merge read.
    if (input == null || clip.signature == null || input.signature == null) return false;
    return roundPatchTime(input.start) === roundPatchTime(clip.start)
      && roundPatchTime(input.end) === roundPatchTime(clip.end)
      && input.signature === clip.signature
      && input.tail === clip.tail;
  });
}
