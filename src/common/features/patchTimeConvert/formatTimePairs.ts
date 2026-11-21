/**
Cut rows -> time pair text, and `.llc` segments -> cut rows (pure).

The outgoing text is the shape anybody can read and re-import: `HH:MM:SS.mmm HH:MM:SS.mmm
[label]`, one cut per line, optionally led by the video's file name and a blank line. It is exactly
what `parseTimePairs` reads back, so handing the text to someone else and getting it back (or
pasting it back into tab one) is lossless.

`formatLegacyTime` is reused for the times: it is already the canonical `HH:MM:SS.fff` of the fork
(hours padded to two digits and not capped, milliseconds rounded).
*/
import { formatLegacyTime } from '../patchData/timeParse.js';

import type { TimePairRow } from './parseTimePairs.js';

/** Fewest spaces the generated text may put between fields. */
export const minTimePairGap = 1;
/** Most spaces the generated text may put between fields. */
export const maxTimePairGap = 8;
/** The default spacing: two spaces keep the three columns visually apart. */
export const defaultTimePairGap = 2;

/** Clamp a stored / typed gap into the allowed range (`undefined` and junk become the default). */
export function normalizeTimePairGap(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return defaultTimePairGap;
  return Math.min(maxTimePairGap, Math.max(minTimePairGap, Math.round(value)));
}

export interface FormatTimePairsOptions {
  includeLabels: boolean;
  /** Spaces between the times and before the label; clamped to `minTimePairGap`..`maxTimePairGap`. */
  gap?: number | undefined;
}

/** One cut per line; labels are dropped when `includeLabels` is off. */
export function formatTimePairs(rows: readonly TimePairRow[], { includeLabels, gap = defaultTimePairGap }: FormatTimePairsOptions): string {
  const separator = ' '.repeat(normalizeTimePairGap(gap));

  return rows.map(({ start, end, label }) => {
    const times = `${formatLegacyTime(start)}${separator}${formatLegacyTime(end)}`;
    return includeLabels && label != null && label !== '' ? `${times}${separator}${label}` : times;
  }).join('\n');
}

export interface FormatTimePairDocumentOptions extends FormatTimePairsOptions {
  /** The cuts, in cut / merge order. */
  rows: readonly TimePairRow[];
  /**
  When given, the text starts with this name and a blank line (the shape a hand-written note has:
  name on the first line, the cuts below it). `parseTimePairs` reads it back with
  `firstLineIsName: true`.
  */
  mediaFileName: string | undefined;
}

/** The whole text of the project file's direction: optional name line, blank line, then the cuts. */
export function formatTimePairDocument({ rows, includeLabels, gap, mediaFileName }: FormatTimePairDocumentOptions): string {
  const body = formatTimePairs(rows, { includeLabels, gap });
  const name = mediaFileName?.trim();
  if (name == null || name === '') return body;
  return `${name}\n\n${body}`;
}

/** The fields of a project segment this conversion needs (already normalized to seconds). */
export interface LlcTimePairSegment {
  start: number;
  end?: number | undefined;
  name?: string | undefined;
  selected?: boolean | undefined;
}

export interface LlcTimePairPlan {
  rows: TimePairRow[];
  /** Segments left out because they are not selected for export. */
  skippedUnselected: number;
  /** Markers: a start without an end, they are never cut. */
  skippedMarkers: number;
  /** Times that cannot be cut: not finite, or the end is not later than the start. */
  skippedInvalid: number;
}

/**
Turn the segments of a project file into cut rows.

Mirrors what the cutting flow does with a project: markers are not cuts, only selected segments are
exported (unless the caller asks for all of them), and an unusable time is skipped and counted
instead of aborting the whole file.
*/
export function planLlcTimePairs({ segments, includeUnselected }: {
  segments: readonly LlcTimePairSegment[];
  includeUnselected: boolean;
}): LlcTimePairPlan {
  const rows: TimePairRow[] = [];
  let skippedUnselected = 0;
  let skippedMarkers = 0;
  let skippedInvalid = 0;

  for (const segment of segments) {
    if (segment.selected === false && !includeUnselected) {
      skippedUnselected += 1;
      continue;
    }
    if (segment.end == null) {
      skippedMarkers += 1;
      continue;
    }
    if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.end <= segment.start) {
      skippedInvalid += 1;
      continue;
    }

    const label = segment.name?.trim();
    rows.push({ start: segment.start, end: segment.end, label: label === '' || label == null ? undefined : label });
  }

  return { rows, skippedUnselected, skippedMarkers, skippedInvalid };
}
