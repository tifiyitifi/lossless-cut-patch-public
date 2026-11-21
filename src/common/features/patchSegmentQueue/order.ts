/**
Patch-mode cut-queue numbering (pure logic).

The queue panel shows two numbers per segment:
- the **start rank**: where the segment sits in the video, by start time. It is the segment's
  identity, so it survives a drag (reordering the queue) and only changes when the segment's
  own start time changes.
- the **queue position**: where the segment sits in the export order (the order the clips are
  cut and merged in). It follows the list from top to bottom.

Two rules make the numbers readable:
- a segment without an end time is a marker: it is not exported, so it gets no number at all
  (and it does not push the other segments' start ranks around);
- a segment that is not selected is not exported either, so it does not take a queue position
  (the selected segments after it move up).

The caller passes the segments the export would really use: the initial full-length segment is
filtered out, and "nothing selected" is already resolved to "all segments" (the upstream export
falls back to all of them). The numbers are not shown in invert mode, where the export set is the
gaps between the segments and `selected` means "cut away".
*/

/** One segment of the queue, as the numbering sees it. */
export interface PatchQueueSegmentInput {
  segId: string;
  start: number;
  /** `undefined` for a marker (a segment without an end time is never exported). */
  end?: number | undefined;
  /** Whether the segment is part of the export. */
  selected: boolean;
}

/** The numbers shown in front of a segment. */
export interface PatchSegmentNumbers {
  /** 1-based rank by start time. */
  startRank: number;
  /** 1-based position in the export queue. `undefined` when the segment is not exported. */
  queueRank?: number | undefined;
}

/**
The numbers of every exported segment, keyed by segment id.

Markers are absent from the result: they have no number to show.
*/
export function buildSegmentOrderNumbers(segments: readonly PatchQueueSegmentInput[]): Map<string, PatchSegmentNumbers> {
  const exported = segments
    .map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => segment.end != null);

  // The start rank only depends on the times, so a reorder does not change it. Equal starts are
  // broken by the end time and then by the list order, so the ranking is always well defined.
  const byStart = [...exported].sort((a, b) => (
    a.segment.start - b.segment.start
    || (a.segment.end ?? 0) - (b.segment.end ?? 0)
    || a.index - b.index
  ));

  const numbers = new Map<string, PatchSegmentNumbers>();
  byStart.forEach(({ segment }, index) => {
    numbers.set(segment.segId, { startRank: index + 1 });
  });

  // The queue position follows the list and only counts the segments that are exported.
  let queueRank = 0;
  for (const { segment } of exported) {
    if (!segment.selected) {
      continue;
    }

    queueRank += 1;
    const existing = numbers.get(segment.segId);
    if (existing != null) numbers.set(segment.segId, { ...existing, queueRank });
  }

  return numbers;
}
