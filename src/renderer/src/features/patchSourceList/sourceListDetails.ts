import type { BatchFileSortMeta, BatchSortKey } from '../../../../common/features/batchSort';
import { formatCompactModifiedTime, formatFileSize } from '../../../../common/features/patchData/sourceList';
import { formatDuration } from '../../util/duration';

/**
The source list row's detail line (patch, fork-owned).

The list is sorted by name, extension, size, modification time or duration, and a sort the user
cannot verify is a sort they do not trust: the row therefore carries the values it was sorted by.
`field` says which value a part is, so the list can highlight the part that belongs to the active
sort key (see `PatchSourceFileRowBody`).

Two rules that are pinned by tests:

- An unknown value is **left out**, not printed as `--`. A file without a readable duration still
  shows its size and time; a placeholder would only add noise to every row of a broken batch.
- The order is fixed - duration, size, time - whatever the sort key. The line is read as a column,
  so its shape must not move when the sort changes; only the emphasis moves.
*/

export type SourceListDetailField = 'duration' | 'size' | 'mtime';

export interface SourceListDetailPart {
  field: SourceListDetailField;
  text: string;
}

/**
What counts as a known value.

Zero is unknown for the duration, exactly as it is for sorting: a container that reports a zero
length has not answered "how long is this". A zero *size* is different - it is shown as `0 B` (a
result of a failed export is exactly that), even though the sort keys put it last like any other
unknown.
*/
function isKnownValue(value: number | undefined): value is number {
  return value != null && Number.isFinite(value) && value > 0;
}

export function buildSourceListDetail(meta: BatchFileSortMeta | undefined): SourceListDetailPart[] {
  const parts: SourceListDetailPart[] = [];

  // Seconds only: a list row is read as "how long is this", and the milliseconds of a container
  // header would cost width on every row without ever helping a decision. A result shorter than a
  // second keeps them, though: rounded to whole seconds it would read `00:00:00`, i.e. as if it
  // were empty.
  if (isKnownValue(meta?.duration)) {
    parts.push({ field: 'duration', text: formatDuration({ seconds: meta.duration, showFraction: meta.duration < 1 }) });
  }

  const size = formatFileSize(meta?.size);
  if (size != null) parts.push({ field: 'size', text: size });

  const mtime = formatCompactModifiedTime(meta?.mtime);
  if (mtime != null) parts.push({ field: 'mtime', text: mtime });

  return parts;
}

/** Whether the active sort key is one the detail line can emphasise. */
export function isDetailField(key: BatchSortKey | undefined): key is SourceListDetailField {
  return key === 'duration' || key === 'size' || key === 'mtime';
}
