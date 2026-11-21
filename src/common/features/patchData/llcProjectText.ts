/**
The text of a `.llc` project file (pure).

Upstream writes the project with `JSON5.stringify`, which cannot carry comments. The fork keeps
the same data but adds help that only exists in the text:
- a header explaining the numbering;
- one comment line above every segment, with the numbers the app shows in its cut queue;
- a blank line after every fifth segment, so a long list stays readable.

The numbers are derived from the file content alone, never from UI state (e.g. the initial
full-length segment), so every writer derives the same numbers for the same file: the finish
flow re-renders a project file in the main process, where that UI state does not exist.

JSON5 ignores comments when parsing, so this app, upstream and older builds read the file as
before. (The comments do make the file invalid *strict* JSON; it stays valid JSON5.)

Pure logic only: the translation function is injected (pass `i18next`'s `t`).
*/
import JSON5 from 'json5';

import { buildSegmentOrderNumbers } from '../patchSegmentQueue/order.js';
import { normalizeLlcTimeValue } from './llcTime.js';

/** The slice of i18next's `t` this module needs. */
export type LlcTranslate = (key: string, options?: Record<string, unknown>) => string;

/** A blank line follows every complete group of this many segments. */
const segmentsPerGroup = 5;

const indent = '  ';
const segmentIndent = `${indent}${indent}`;

interface LlcProjectTextOptions {
  /** When given, the text carries comments in this language; without it, plain JSON5. */
  t?: LlcTranslate | undefined;
}

/** One segment as the numbering sees it. A segment that cannot be read gets no comment. */
type SegmentForComments = | { kind: 'invalid' }
  | { kind: 'marker' }
  | { kind: 'cut'; start: number; end: number; selected: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

/**
Read the fields the numbering needs. Times may be numbers (v2) or timecodes (v3), so the stored
value is normalized the same way the loader does it.
*/
function parseSegmentForComments(segment: unknown): SegmentForComments {
  if (!isRecord(segment)) return { kind: 'invalid' };
  const start = normalizeLlcTimeValue(segment['start']);
  if (start == null) return { kind: 'invalid' };
  if (segment['end'] == null) return { kind: 'marker' };
  const end = normalizeLlcTimeValue(segment['end']);
  if (end == null) return { kind: 'invalid' };
  return { kind: 'cut', start, end, selected: segment['selected'] !== false };
}

/**
The comment line of every segment (`undefined` = no comment, for a segment that cannot be read).

The numbers follow the cut queue exactly (see `buildSegmentOrderNumbers`): the colored number is
the rank by start time (markers get none), the queue number is the position among the exported
segments, in file order. As in the app, "nothing selected" falls back to "all segments".
*/
export function buildLlcSegmentComments(segments: readonly unknown[], t: LlcTranslate): (string | undefined)[] {
  const parsed = segments.map((segment) => parseSegmentForComments(segment));
  const cuts = parsed.flatMap((segment, index) => (segment.kind === 'cut' ? [{ index, segment }] : []));
  const nothingSelected = cuts.every(({ segment }) => !segment.selected);

  const numbers = buildSegmentOrderNumbers(cuts.map(({ index, segment }) => ({
    segId: String(index),
    start: segment.start,
    end: segment.end,
    selected: segment.selected || nothingSelected,
  })));

  return parsed.map((segment, index) => {
    if (segment.kind === 'invalid') return undefined;
    const entry = numbers.get(String(index));
    if (entry == null) return t('Marker (no end time, not exported)');
    if (entry.queueRank == null) return t('#{{startRank}} (not exported)', { startRank: entry.startRank });
    return t('#{{startRank}} (queue {{queueRank}})', { startRank: entry.startRank, queueRank: entry.queueRank });
  });
}

/** JSON5 writes keys unquoted when they are identifiers; match that for the keys we emit ourselves. */
function formatKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON5.stringify(key);
}

function serialize(value: unknown): string[] {
  return JSON5.stringify(value, null, 2).split('\n');
}

/** One top-level entry (`version`, `mediaFileName`, …), indented. JSON5 ends it with a comma. */
function renderEntryLines({ key, value }: {
  key: string;
  value: unknown;
}): string[] {
  const [firstLine = '', ...restLines] = serialize(value);
  const lines = [`${indent}${formatKey(key)}: ${firstLine}`];
  for (const line of restLines) lines.push(line === '' ? line : `${indent}${line}`);
  const lastIndex = lines.length - 1;
  lines[lastIndex] = `${lines[lastIndex] ?? ''},`;
  return lines;
}

/** The `cutSegments` array: a comment per segment, and a blank line after every group. */
function renderSegmentArrayLines({ segments, comments }: {
  segments: readonly unknown[];
  comments: readonly (string | undefined)[] | undefined;
}): string[] {
  if (segments.length === 0) return [`${indent}cutSegments: [],`];

  const lines = [`${indent}cutSegments: [`];
  segments.forEach((segment, index) => {
    const comment = comments?.[index];
    if (comment != null) lines.push(`${segmentIndent}// ${comment}`);

    const serializedLines = serialize(segment);
    serializedLines.forEach((line, lineIndex) => {
      const isLastLine = lineIndex === serializedLines.length - 1;
      // JSON5.stringify (with indentation) terminates every segment with a comma, the last one too.
      const comma = isLastLine ? ',' : '';
      lines.push(`${segmentIndent}${line}${comma}`);
    });

    const isLastSegment = index === segments.length - 1;
    if (comments != null && !isLastSegment && (index + 1) % segmentsPerGroup === 0) lines.push('');
  });
  lines.push(`${indent}],`);
  return lines;
}

/**
Render a project object as the text of a `.llc` file.

Unknown top-level fields and their order are preserved, so an older or newer project file is
rewritten without losing data. The result has no trailing newline, like `JSON5.stringify`.
*/
export function renderLlcProjectText(project: unknown, options: LlcProjectTextOptions = {}): string {
  const { t } = options;
  if (!isRecord(project)) return JSON5.stringify(project, null, 2);

  const entries = Object.entries(project).filter(([, value]) => value !== undefined && typeof value !== 'function');
  const lines: string[] = [];

  if (t != null) {
    lines.push(
      `// ${t('LosslessCut project (JSON5). Comments are for humans; the app ignores them.')}`,
      `// ${t("The colored number #n is the segment's place in the video by start time; markers (no end time) have no number.")}`,
      `// ${t('The queue number is the export and merge order: the segments are cut and merged in the order they appear below.')}`,
    );
    // Only a finished project carries this, so the line would be noise in every other file.
    if (entries.some(([key]) => key === 'patchExport')) {
      lines.push(`// ${t('The patchExport block records the outputs of the last finished export: merged lists the merged files, clips the kept cut results (the file names are relative to this folder).')}`);
    }
  }

  lines.push('{');
  entries.forEach(([key, value]) => {
    if (key === 'cutSegments' && Array.isArray(value)) {
      const comments = t != null ? buildLlcSegmentComments(value, t) : undefined;
      lines.push(...renderSegmentArrayLines({ segments: value, comments }));
      return;
    }
    lines.push(...renderEntryLines({ key, value }));
  });
  lines.push('}');
  return lines.join('\n');
}
