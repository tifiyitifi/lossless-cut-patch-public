import { useEffect, useRef } from 'react';

import type { PatchCutResultEntry } from '../../../../common/features/patchPlayer/playerMode.js';
import type { PatchMergedChapterSegment } from '../../../../common/features/patchMerged/mergedChapters.js';
import { planMergedChapterSync } from '../../../../common/features/patchMerged/mergedChapters.js';

/**
The merged window's read-only chapters (fork-owned).

The chapters travel with the playlist entry (built at merge time from the clips), so the merged
window shows which part of the merged file is which cut result - with the source labels and
colors - without any editable cut list. Only a new merge replaces them.

The list is *not* always there: a merged file recorded by an older version carries no chapters,
and the "others" list can show a video that is not in the playlist at all. Those cases clear the
list - the upstream loader rejects an empty list (see `planMergedChapterSync`), and its error
would replace the whole window with an error page.
*/
export default function usePatchMergedChapters({ mergedMode, entry, filePath, clearSegments, loadCutSegments }: {
  mergedMode: boolean;
  entry: PatchCutResultEntry | undefined;
  filePath: string | undefined;
  clearSegments: () => void;
  /** Non-empty only: `useSegments.loadCutSegments` throws on an empty list. */
  loadCutSegments: (args: { segments: [PatchMergedChapterSegment, ...PatchMergedChapterSegment[]], append: boolean }) => void;
}) {
  const loadedKeyRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!mergedMode || (filePath == null)) return;
    // The chapters belong to the merged result that is playing. A video opened from the "others"
    // section is not in the playlist (no entry), so it has none: the previous file's chapters must
    // not stay on the timeline.
    const chapters = entry?.path === filePath ? (entry.mergedChapters ?? []) : [];
    // The key covers everything that is displayed: a renamed label or another color is a new list,
    // even when the ids and the times are unchanged.
    const key = `${filePath}|${chapters.map((chapter) => (
      `${chapter.segId}:${chapter.start}-${chapter.end}:${chapter.name}:${chapter.segColorIndex}:${chapter.startRank ?? ''}:${chapter.queueRank ?? ''}`
    )).join(',')}`;
    if (loadedKeyRef.current === key) return;
    loadedKeyRef.current = key;
    const sync = planMergedChapterSync(chapters);
    if (sync.kind === 'clear') {
      clearSegments();
      return;
    }
    loadCutSegments({ segments: sync.segments, append: false });
  }, [mergedMode, entry, filePath, clearSegments, loadCutSegments]);
}
