/**
The merged result's chapters (fork-owned).

The merged file is the concatenation of the cut results, so the merged timeline is split the
same way: one read-only chapter per clip, in merge order, with the source segment's label and
color. The chapters are only refreshed when the merged file is regenerated - they can never be
edited in the merged window.
*/
import type { PatchSegmentNumbers } from '../patchSegmentQueue/order.js';

/** One clip as the chapter builder sees it. */
export interface PatchMergedChapterSource {
  segId: string;
  label?: string | undefined;
  /** The source segment's color (falls back to the merge position when unknown). */
  segColorIndex?: number | undefined;
  /** The clip's actual duration (probed); the source times are used when it is missing. */
  duration?: number | undefined;
  /** `end - start` of the source segment (always known from the manifest). */
  fallbackDuration: number;
  /** The segment's rank by start time in the cut queue (the colored number). */
  startRank?: number | undefined;
  /** The segment's position in the cut queue (the plain number). */
  queueRank?: number | undefined;
}

/** One read-only chapter of the merged timeline. */
export interface PatchMergedChapter {
  segId: string;
  start: number;
  end: number;
  /** The source segment's label. */
  name: string;
  /** The source segment's color. */
  segColorIndex: number;
  /**
  The two numbers the cutting window showed for this segment (fork-owned).

  They are carried from the cut queue at merge time, so the merged window's list reads the same
  as the list the clips were cut from: the colored one is the start-time rank (identity), the
  plain one is the queue position (which a reorder of the queue may change). Missing on merged
  files created before they were recorded - the list then falls back to the merge position.
  */
  startRank?: number | undefined;
  queueRank?: number | undefined;
}

/** One chapter as the merged window's read-only segment loader takes it. */
export interface PatchMergedChapterSegment {
  start: number;
  end: number;
  name: string;
  segId: string;
  segColorIndex: number;
}

/** How the merged window syncs its read-only chapter list. */
export type PatchMergedChapterSync = | { kind: 'clear' }
  | { kind: 'load', segments: [PatchMergedChapterSegment, ...PatchMergedChapterSegment[]] };

/**
Decide how the merged window syncs its read-only chapters.

The upstream segment loader (`useSegments.loadCutSegments`) rejects an empty list with a
user-facing error: an empty EDL is a broken file, so the throwing is base behavior and must not
change. A merged window can legitimately have no chapters though - a merged file recorded by an
older version carries none, and the "others" list can show a video that is not in the playlist -
and loading that empty list turns the whole window into an error page instead of an empty list.

The load case is typed as a non-empty tuple, so the loader cannot be handed a list that may be
empty without this decision being made first.
*/
export function planMergedChapterSync(chapters: readonly PatchMergedChapter[] | undefined): PatchMergedChapterSync {
  const segments = (chapters ?? []).map((chapter) => ({
    start: chapter.start,
    end: chapter.end,
    name: chapter.name,
    segId: chapter.segId,
    segColorIndex: chapter.segColorIndex,
  }));
  const [first, ...rest] = segments;
  if (first == null) return { kind: 'clear' };
  return { kind: 'load', segments: [first, ...rest] };
}

const isUsableDuration = (value: number | undefined): value is number => (
  value != null && Number.isFinite(value) && value > 0
);

/**
Lay the chapters end to end in merge order.

A clip with no usable duration (neither probed nor from its source times) is skipped: a
zero-length chapter cannot be previewed or clicked.
*/
export function buildMergedChapters(sources: readonly PatchMergedChapterSource[]): PatchMergedChapter[] {
  const chapters: PatchMergedChapter[] = [];
  let cursor = 0;
  sources.forEach((source, index) => {
    const length = isUsableDuration(source.duration) ? source.duration : source.fallbackDuration;
    if (!isUsableDuration(length)) return;
    const start = cursor;
    const end = cursor + length;
    chapters.push({
      segId: source.segId,
      start,
      end,
      name: source.label ?? '',
      segColorIndex: source.segColorIndex ?? index,
      ...((source.startRank !== undefined) && { startRank: source.startRank }),
      ...((source.queueRank !== undefined) && { queueRank: source.queueRank }),
    });
    cursor = end;
  });
  return chapters;
}

/**
The two numbers the merged window's segment list shows, keyed by chapter id.

They are the numbers the cutting window showed when the clips were cut (carried with the
chapters). A merged file created before they were recorded falls back to the merge position, so
the list always has a number for every chapter.
*/
export function buildMergedChapterNumbers(chapters: readonly PatchMergedChapter[]): Map<string, PatchSegmentNumbers> {
  const numbers = new Map<string, PatchSegmentNumbers>();
  chapters.forEach((chapter, index) => {
    numbers.set(chapter.segId, {
      startRank: chapter.startRank ?? index + 1,
      queueRank: chapter.queueRank ?? index + 1,
    });
  });
  return numbers;
}

/** Validate chapters received over IPC (the main process is typed, but this is a process boundary). */
export function parsePatchMergedChapters(value: unknown): PatchMergedChapter[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry == null) return [];
    const { segId, start, end, name, segColorIndex, startRank, queueRank } = entry as Record<string, unknown>;
    if (typeof segId !== 'string' || segId.length === 0 || typeof start !== 'number' || !Number.isFinite(start) || start < 0) return [];
    if (typeof end !== 'number' || !Number.isFinite(end) || end <= start || typeof segColorIndex !== 'number' || !Number.isFinite(segColorIndex) || segColorIndex < 0) return [];
    const rank = (raw: unknown) => (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : undefined);
    const ranks = { startRank: rank(startRank), queueRank: rank(queueRank) };
    return [{
      segId,
      start,
      end,
      name: typeof name === 'string' ? name : '',
      segColorIndex: Math.floor(segColorIndex),
      ...((ranks.startRank !== undefined) && { startRank: ranks.startRank }),
      ...((ranks.queueRank !== undefined) && { queueRank: ranks.queueRank }),
    }];
  });
}
