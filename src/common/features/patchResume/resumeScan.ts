import type { PatchCutResultEntry } from '../patchPlayer/playerMode.js';
import type { PatchMergedChapter } from '../patchMerged/mergedChapters.js';
import { buildMergedChapters } from '../patchMerged/mergedChapters.js';
import type { PatchSegmentNumbers } from '../patchSegmentQueue/order.js';
import { normalizeManifestPath } from '../patchExport/manifest.js';
import compareStrings from '../patchExport/stringOrder.js';

export interface ResumeSegmentInput {
  start: number;
  end: number;
  label?: string | undefined;
  path: string;
}

/** Manifest segments -> cut-window playlist entries, in the recorded cut-queue order, source attached. */
export function buildResumeClipEntries(
  segments: Readonly<Record<string, ResumeSegmentInput>>,
  sourcePath: string,
  /**
  The order the last export cut the results in (fork-owned). A missing order (a manifest of an older
  version) falls back to timeline order.
  */
  order?: readonly string[] | undefined,
): PatchCutResultEntry[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const segId of order ?? []) {
    if (seen.has(segId) || !Object.hasOwn(segments, segId)) continue;
    seen.add(segId);
    ordered.push(segId);
  }
  // A code-point order: the playlist is built from the same manifest on another computer, so it
  // must not follow the machine's collation (or the ICU version bundled with the app).
  const segIds = ordered.length > 0
    ? ordered
    : Object.keys(segments).sort((a, b) => (segments[a]?.start ?? 0) - (segments[b]?.start ?? 0) || compareStrings(a, b));

  return segIds
    .map((segId) => {
      const segment = segments[segId]!;
      return { segId, start: segment.start, end: segment.end, label: segment.label, path: segment.path };
    })
    .map(({ segId, label, path }) => ({
      path,
      ...((label !== undefined) && { label }),
      segId,
      sourcePath,
    }));
}

/**
Fill in the merged chapters' cut-queue numbers from the export manifest (fork-owned).

A merged file records its chapters when it is created, but the numbers can be missing (a merged
file from an older version) or stale (the manifest knows the segments better). The numbers are
recomputed from the manifest's segment records, which is exactly what the cutting window shows:
the colored number is the start-time rank, the plain one is the queue position.

A chapter the manifest does not know (the record was lost or the result was renamed away) keeps
whatever it had; the list then falls back to the merge position.
*/
export function applyChapterNumbers(
  chapters: readonly PatchMergedChapter[],
  numbers: ReadonlyMap<string, PatchSegmentNumbers>,
): PatchMergedChapter[] {
  return chapters.map((chapter) => {
    const chapterNumbers = numbers.get(chapter.segId);
    if (chapterNumbers == null) return chapter;
    // The queue position is part of the recomputed numbers: a segment the current queue does not
    // list (only colors, no queue) must not keep the number it carried from an older merge.
    const withoutNumbers = { ...chapter };
    delete withoutNumbers.queueRank;
    return {
      ...withoutNumbers,
      startRank: chapterNumbers.startRank,
      ...((chapterNumbers.queueRank !== undefined) && { queueRank: chapterNumbers.queueRank }),
    };
  });
}

/**
The chapters the merged window shows when it is reopened (fork-owned).

The chapters are stored with the merged record, but only since they were recorded: a merged file
from an older version has none. They are then rebuilt from the manifest's segment records in the
merge's start order - the clips may already be deleted (merged-only mode), but the records still
say what went into the file. Either way the cut-queue numbers are recomputed, so the reopened
list reads like the cut queue it came from.
*/
export function buildResumeMergedChapters({ storedChapters, clips, numbers }: {
  storedChapters: readonly PatchMergedChapter[] | undefined;
  clips: readonly { segId: string, start: number, end: number, label?: string | undefined, segColorIndex?: number | undefined }[];
  numbers: ReadonlyMap<string, PatchSegmentNumbers>;
}): PatchMergedChapter[] {
  if (storedChapters != null) return applyChapterNumbers(storedChapters, numbers);
  return buildMergedChapters(clips.map((clip) => ({
    segId: clip.segId,
    label: clip.label,
    segColorIndex: clip.segColorIndex,
    fallbackDuration: clip.end - clip.start,
    startRank: numbers.get(clip.segId)?.startRank,
    queueRank: numbers.get(clip.segId)?.queueRank,
  })));
}

export interface ResumeAvailability {
  hasClips: boolean;
  hasMerged: boolean;
}

/** Empty when neither present clips nor present merged exist. */
export function decideResumeAvailability({ clipCount, mergedExists }: {
  clipCount: number,
  mergedExists: boolean,
}): ResumeAvailability | undefined {
  if (clipCount <= 0 && !mergedExists) return undefined;
  return { hasClips: clipCount > 0, hasMerged: mergedExists };
}

/**
Other videos of a work folder: everything except the current playlist.

Already sorted callers stay sorted (the main process lists with numeric sort, shared with the
playlist). Comparison follows file-system semantics so `C:\a\b` and `C:/a/b` count as one file.
*/
export function buildOtherVideoPaths({ allPaths, excludePaths, caseInsensitive }: {
  allPaths: readonly string[],
  excludePaths: readonly string[],
  caseInsensitive: boolean,
}): string[] {
  const excluded = new Set(excludePaths.map((path) => normalizeManifestPath(path, { caseInsensitive })));
  return allPaths.filter((path) => !excluded.has(normalizeManifestPath(path, { caseInsensitive })));
}
