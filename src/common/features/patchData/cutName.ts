/**
Naming rule for the cut results (fork-owned).

One file per cut result, named with the same `{token}` rule syntax the merged result uses (see
`mergedName.ts`): the engine (optional `[...]` groups, dangling separators, sanitizing, reserved
names, truncation) is shared, only the tokens differ. A rule can only name one file at a time and
never creates a folder, so the result always lands in `clips/`.

The rule of one export renders the name of every clip, so the whole batch is rendered at once:
when two clips would get the same name, **every** clip of that group gets the default suffix
` - {seg_num}-{datetime}` (number in the batch + the export's timestamp). The alternative is one
clip silently overwriting the other (the cutter forces overwriting for its own results), so the
suffix is applied instead of failing the export.
*/

import { formatEpochMsForFileName } from './naming.js';
import type { MergedNameProblem } from './mergedName.js';
import {
  checkMergedNameRule, defaultLabelSeparator, escapeWindowsReservedName, fileNameStemBudget,
  formatMergedNameDate, formatMergedNameTime, labelSeparatorOptions, normalizeMergedLabels,
  renderMergedNameStem, ruleUsesToken, sanitizeNamePart, truncateNameStem,
} from './mergedName.js';

/** One token a cut name rule can use. */
export interface CutNameToken {
  /** The token as written in a rule, without the braces. */
  name: string;
  /** Values a user typed (source name, labels) need sanitizing; derived values do not. */
  safe: boolean;
  /** The token can render nothing (use it in a `[...]` group). */
  mayEmpty: boolean;
  /**
  Can the rendered value make two exports of the same source differ?

  It cannot keep two clips of *one* export apart: one export shares one timestamp and one export
  number, so `{datetime}` and the like render the same value for every clip (see
  `cutRuleSeparatesClips`).
  */
  unique: boolean;
  /** Does the token render a different value for every clip of one export? */
  uniqueInBatch: boolean;
}

/**
The tokens a cut name rule can use.

`seg_num` is the position in *this export* (1..N), not the cut queue number: the name has to be
unique inside the batch, and the queue number of a selection (2, 5, 9) would leave gaps. It is the
one token that separates the clips of one export (`uniqueInBatch`); `datetime` and the like
separate two exports instead.
*/
export const cutNameTokens: readonly CutNameToken[] = [
  { name: 'source', safe: false, mayEmpty: false, unique: false, uniqueInBatch: false },
  { name: 'source_folder', safe: false, mayEmpty: true, unique: false, uniqueInBatch: false },
  { name: 'label', safe: false, mayEmpty: true, unique: false, uniqueInBatch: false },
  { name: 'labels', safe: false, mayEmpty: true, unique: false, uniqueInBatch: false },
  { name: 'seg_num', safe: true, mayEmpty: false, unique: false, uniqueInBatch: true },
  { name: 'count', safe: true, mayEmpty: false, unique: false, uniqueInBatch: false },
  { name: 'cut_from', safe: true, mayEmpty: false, unique: false, uniqueInBatch: false },
  { name: 'cut_to', safe: true, mayEmpty: false, unique: false, uniqueInBatch: false },
  { name: 'date', safe: true, mayEmpty: false, unique: false, uniqueInBatch: false },
  { name: 'time', safe: true, mayEmpty: false, unique: false, uniqueInBatch: false },
  { name: 'datetime', safe: true, mayEmpty: false, unique: true, uniqueInBatch: false },
  { name: 'epoch_ms', safe: true, mayEmpty: false, unique: true, uniqueInBatch: false },
  { name: 'export_count', safe: true, mayEmpty: false, unique: true, uniqueInBatch: false },
];

/**
Every value of a cut name rule. Empty when the token renders nothing.

A type alias for the same reason as `MergedNameValues`: the shared render functions take a token
map, and only an alias carries the implicit index signature they need.
*/
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- an interface would not be assignable to the shared token map.
export type CutNameValues = {
  source: string;
  source_folder: string;
  label: string;
  labels: string;
  seg_num: string;
  count: string;
  cut_from: string;
  cut_to: string;
  date: string;
  time: string;
  datetime: string;
  epoch_ms: string;
  export_count: string;
};

/**
The default rule.

`{seg_num}` is what keeps an unlabeled batch apart; a rule without a token that differs inside the
batch would need the forced suffix on every export, which is a fallback, not the normal case. The
cut times make a result identifiable without opening it (the same shape the upstream `${CUT_FROM}`
template writes), so a result that is copied elsewhere still says where it was cut from.
*/
export const defaultCutNameRule = '{source}-{seg_num}[ - {label}]-{cut_from}-{cut_to}';

/**
The default rule of the builds before the cut times were added.

`electron-store` writes the defaults into `patch-config.json` on the first start, so an existing
install has this string stored even though the user never edited the rule. `migrateCutNameRule`
moves exactly that value to the new default; a rule the user typed is left alone.
*/
export const oldDefaultCutNameRule = '{source}[ - {label}]-{seg_num}';

/** Joins the clip labels in `{labels}` (the same separators the merge rule offers). */
export const defaultCutLabelSeparator = defaultLabelSeparator;

/**
The rule the finish dialog (`Shift+E`) renames the cut results with.

The export rule names a clip while it is cut, in the work area; the finish step moves the clip to
its final folder, which is the last moment its name can change without leaving a stale result
behind. `{seg_num}` keeps the results of one job apart without the forced number + time suffix, so
a one-clip job and a many-clip job both read cleanly (`a-clip-1.mp4`, `a-clip-2.mp4`).
*/
export const defaultFinishCutRenameRule = '{source}-clip-{seg_num}';

export type CutNamePresetId = 'finish' | 'default' | 'label' | 'timecode' | 'number' | 'stamp';

export interface CutNamePreset {
  id: CutNamePresetId;
  rule: string;
}

/** The rules the export dialog offers as chips, in the order they are shown. */
export const cutNamePresets: readonly CutNamePreset[] = [
  { id: 'default', rule: defaultCutNameRule },
  { id: 'label', rule: '{source}[ - {label}]' },
  { id: 'timecode', rule: '{source}[ - {label}]-{cut_from}' },
  { id: 'number', rule: '{source}-{seg_num}' },
  { id: 'stamp', rule: '{source}[ - {label}]-{datetime}' },
];

/**
The rules the finish dialog offers: the finish default first, then the export presets (a user who
liked a name during cutting can pick the same shape for the finished file).
*/
export const finishCutRenamePresets: readonly CutNamePreset[] = [
  { id: 'finish', rule: defaultFinishCutRenameRule },
  ...cutNamePresets,
];

/** Why the cut results cannot be named with a rule. */
export type CutNameProblem = MergedNameProblem | { code: 'duplicateNames' };

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

/**
The clip's start or end as `HH.MM.SS.mmm`.

The upstream file-name timecode (`formatDuration` with `fileNameFriendly`): the cut name rule
writes the same shape as the `${CUT_FROM}` template variable, so a user switching between the two
naming systems sees the same value.
*/
export function formatCutNameTime(seconds: number) {
  const totalMs = Math.round(Math.abs(seconds) * 1000);
  const totalSeconds = Math.floor(totalMs / 1000);
  const timecode = [
    pad(Math.floor(totalSeconds / 3600)),
    pad(Math.floor(totalSeconds / 60) % 60),
    pad(totalSeconds % 60),
  ].join('.');
  return `${timecode}.${pad(totalMs % 1000, 3)}`;
}

/**
The number of the clip in this export, zero padded like the upstream `${SEG_NUM}`.

Padding by the size of the batch is what keeps a folder sorted (`02` before `10`); the user's
`outputFileNameMinZeroPadding` raises it further.
*/
export function formatClipNumber(index: number, count: number, minZeroPadding: number) {
  const digits = `${Math.max(1, count)}`.length;
  return `${index + 1}`.padStart(Math.max(digits, minZeroPadding), '0');
}

/** One clip of the export, as far as the name is concerned. */
export interface CutNameClip {
  label?: string | undefined;
  start: number;
  end: number;
}

export interface BuildCutNameValuesParams {
  /** The source file name without its extension (the caller parses the path). */
  sourceName: string;
  /** The name of the folder the source file is in (`''` when there is none). */
  sourceFolder: string;
  /** Every clip of this export, in export order (the `{labels}` / `{count}` view). */
  clips: readonly CutNameClip[];
  /** The position of the clip this name belongs to. */
  index: number;
  epochMs: number;
  exportCount?: number | undefined;
  labelSeparator: string;
  maxLabelLength: number;
  minZeroPadding: number;
}

/** A label the way the export sanitizes it (the same rule the merged names use). */
function cleanClipLabel(label: string | undefined, maxLabelLength: number) {
  const clean = normalizeMergedLabels({ labels: [label], maxLabelLength });
  return clean[0] ?? '';
}

/** Build (and sanitize) the values of all tokens for one clip. */
export function buildCutNameValues({
  sourceName, sourceFolder, clips, index, epochMs, exportCount, labelSeparator, maxLabelLength, minZeroPadding,
}: BuildCutNameValuesParams): CutNameValues {
  const clip = clips[index];
  return {
    source: sanitizeNamePart(sourceName),
    source_folder: sanitizeNamePart(sourceFolder),
    label: cleanClipLabel(clip?.label, maxLabelLength),
    // `{labels}` is the whole batch, exactly like the merged result's token: a rule that wants the
    // label of this clip only uses `{label}`.
    labels: normalizeMergedLabels({ labels: clips.map((entry) => entry.label), maxLabelLength }).join(labelSeparator),
    seg_num: formatClipNumber(index, clips.length, minZeroPadding),
    count: String(clips.length),
    cut_from: formatCutNameTime(clip?.start ?? 0),
    cut_to: formatCutNameTime(clip?.end ?? 0),
    date: formatMergedNameDate(epochMs),
    time: formatMergedNameTime(epochMs),
    datetime: formatEpochMsForFileName(epochMs),
    epoch_ms: String(epochMs),
    export_count: exportCount == null ? '' : String(exportCount),
  };
}

/**
Can the rule name every clip of one export differently?

Only `{seg_num}` does: it is the one token that renders a different value for every clip of the
batch. A token that differs *between* exports (`{datetime}`, `{epoch_ms}`, `{export_count}`) does
not help here - the whole export shares one timestamp and one export number, so every clip renders
the same value - and a rule that uses only those still gets the forced number + time suffix.
*/
export function cutRuleSeparatesClips(rule: string) {
  return cutNameTokens.some((token) => token.uniqueInBatch && ruleUsesToken(rule, token.name));
}

/** The rule alone (no export context needed): the same checks the merged rule gets. */
export function checkCutNameRule(rule: string) {
  return checkMergedNameRule(rule);
}

/** Render the rule's name (without the extension). The values are already sanitized. */
export function renderCutNameStem(rule: string, values: CutNameValues) {
  return renderMergedNameStem(rule, values);
}

/** The suffix forced onto every clip whose name another clip of the same export already has. */
export function cutNameCollisionSuffix(values: CutNameValues) {
  return ` - ${values.seg_num}-${values.datetime}`;
}

/** The smallest room a forced suffix may use; below that the name is shortened without it. */
const minSuffixStemBudget = 8;

interface RenderedStem {
  stem: string;
  truncated: boolean;
}

/**
The tokens a cut name keeps when it has to be shortened: the one that tells the clips of the batch
apart first, then the ones that separate exports.
*/
const cutNameKeepCandidates = ['seg_num', 'epoch_ms', 'export_count', 'datetime', 'source'] as const;

/**
Turn the rendered rule into the stem to write.

A leading dot would make the result a hidden file and a trailing dot/space is dropped by the file
system (or refuses the name). The forced suffix is appended *after* shortening, so it always
survives: it is what keeps the names apart.
*/
function renderStem({ rule, values, forcedSuffix, maxStemLength }: {
  rule: string;
  values: CutNameValues;
  /** `''` when the name is unique inside the batch. */
  forcedSuffix: string;
  maxStemLength: number;
}): RenderedStem | undefined {
  let stem = sanitizeNamePart(renderMergedNameStem(rule, values));
  stem = stem.replace(/^\.+/u, (dots) => '．'.repeat(dots.length)).replace(/[\s.]+$/u, '');
  stem = escapeWindowsReservedName(stem);
  if (stem === '') return undefined;

  const roomForSuffix = maxStemLength - forcedSuffix.length;
  const suffix = forcedSuffix !== '' && roomForSuffix >= minSuffixStemBudget ? forcedSuffix : '';

  const budget = Math.max(1, maxStemLength - suffix.length);
  const truncated = stem.length > budget;
  if (truncated) stem = truncateNameStem({ stem, maxStemLength: budget, rule, values, keepCandidates: cutNameKeepCandidates });

  return { stem: `${stem}${suffix}`, truncated };
}

export interface ResolveCutNamesParams {
  rule: string;
  sourceName: string;
  sourceFolder: string;
  /** Every clip of this export, in export order. */
  clips: readonly CutNameClip[];
  /** The output extension, with or without the leading dot. */
  ext: string;
  /** The absolute folder the results are written to (for the path length budget). */
  outputDir: string;
  epochMs: number;
  exportCount?: number | undefined;
  labelSeparator: string;
  maxLabelLength: number;
  minZeroPadding: number;
  isWindows: boolean;
  /** Windows and macOS compare file names case-insensitively. */
  caseInsensitive: boolean;
}

export type ResolveCutNamesResult = | {
  /** One file name per clip, in export order. */
  names: string[];
  /**
  The suffix appended to each name (`''` when the name was unique in the batch).

  Kept with the result so a later label rename re-renders the same name (see
  `RuleCutNameContext`).
  */
  suffixes: string[];
  /** The room the stems had; a later rename repeats the same shortening with it. */
  maxStemLength: number;
}
  | { problem: CutNameProblem };

/**
Render every clip's name for one export.

A name two clips would share is given to **none** of them: every clip of that group gets the
number + time suffix, so the outcome does not depend on the order and no clip silently replaces
another one.

A name that does not fit the file name / Windows path budget is **refused**, not shortened: the
cut time tokens are what identify a result, and a silently shortened name would either lose them
or collide with a sibling. The export stops until the user changes the output folder or the rule.
*/
export function resolveCutNames({
  rule, sourceName, sourceFolder, clips, ext, outputDir, epochMs, exportCount,
  labelSeparator, maxLabelLength, minZeroPadding, isWindows, caseInsensitive,
}: ResolveCutNamesParams): ResolveCutNamesResult {
  const ruleProblem = checkMergedNameRule(rule);
  if (ruleProblem != null) return { problem: ruleProblem };

  const extension = ext === '' ? '' : `.${ext.replace(/^\.+/u, '')}`;
  const maxStemLength = fileNameStemBudget({ outputDir, extension, isWindows });
  if (maxStemLength == null) return { problem: { code: 'pathTooLong' } };

  const valuesOfClip = clips.map((_clip, index) => buildCutNameValues({
    sourceName, sourceFolder, clips, index, epochMs, exportCount, labelSeparator, maxLabelLength, minZeroPadding,
  }));

  const plain = valuesOfClip.map((values) => renderStem({ rule, values, forcedSuffix: '', maxStemLength }));
  if (plain.some((rendered) => rendered == null)) return { problem: { code: 'emptyName' } };
  // Checked before the collision pass: a shortened stem would make the duplicate detection look at
  // names the export would never write.
  if (plain.some((rendered) => rendered!.truncated)) return { problem: { code: 'pathTooLong' } };

  const keyOf = (name: string) => (caseInsensitive ? name.toLocaleLowerCase('en-US') : name);
  const counts = new Map<string, number>();
  for (const rendered of plain) {
    const key = keyOf(rendered!.stem);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const suffixes = plain.map((rendered, index) => (
    (counts.get(keyOf(rendered!.stem)) ?? 0) > 1 ? cutNameCollisionSuffix(valuesOfClip[index]!) : ''
  ));

  const rendered = plain.map((_unused, index) => renderStem({
    rule,
    values: valuesOfClip[index]!,
    forcedSuffix: suffixes[index]!,
    maxStemLength,
  }));
  if (rendered.some((stem) => stem == null)) return { problem: { code: 'emptyName' } };
  // The forced suffix can push a name that fit on its own over the budget.
  if (rendered.some((stem) => stem!.truncated)) return { problem: { code: 'pathTooLong' } };

  const seen = new Set<string>();
  const names: string[] = [];
  for (const stem of rendered) {
    const name = `${stem!.stem}${extension}`;
    const key = keyOf(name);
    // The suffix carries the number, so the names are unique by construction; a rule that still
    // collides (a value that happens to look like the suffix) is refused instead of overwritten.
    if (seen.has(key)) return { problem: { code: 'duplicateNames' } };
    seen.add(key);
    names.push(name);
  }

  return {
    names,
    suffixes,
    maxStemLength,
  };
}

/**
How one cut result was named, stored with the result (fork-owned).

Everything the export rendered is kept, so renaming a label can re-render the rule without
guessing: the clips of the batch, the timestamp, the forced suffix and the room the name had. The
record is plain JSON - it travels to the player window and into the export manifest.
*/
export interface RuleCutNameContext {
  kind: 'rule';
  rule: string;
  /** The folder the result was written to. */
  outputDir: string;
  /** The extension, including the dot (`.mp4`). */
  extension: string;
  sourceName: string;
  sourceFolder: string;
  /** Every clip of the export, this one included, as they were at export time. */
  clips: CutNameClip[];
  /** The position of this result in `clips`. */
  index: number;
  epochMs: number;
  exportCount?: number | undefined;
  labelSeparator: string;
  maxLabelLength: number;
  minZeroPadding: number;
  /** The room the stem had (kept, so a later rename shortens the same way). */
  maxStemLength: number;
  /** The suffix the export had to append (`''` when the name was unique). */
  forcedSuffix: string;
}

/**
Re-render the stored rule with another label (`undefined` keeps the stored one).

Returns the file name (no folder): the caller joins `outputDir`. `undefined` when the rule no
longer renders a usable name (a hand-edited manifest).
*/
export function renderRuleCutName(context: RuleCutNameContext, label?: string | undefined) {
  const clips = context.clips.map((clip, index) => (
    index === context.index && label !== undefined ? { ...clip, label } : clip
  ));
  const values = buildCutNameValues({
    sourceName: context.sourceName,
    sourceFolder: context.sourceFolder,
    clips,
    index: context.index,
    epochMs: context.epochMs,
    exportCount: context.exportCount,
    labelSeparator: context.labelSeparator,
    maxLabelLength: context.maxLabelLength,
    minZeroPadding: context.minZeroPadding,
  });
  const stem = renderStem({
    rule: context.rule,
    values,
    forcedSuffix: context.forcedSuffix,
    maxStemLength: context.maxStemLength,
  });
  return stem == null ? undefined : `${stem.stem}${context.extension}`;
}

/** A stored rule, or the default when the value is missing or unusable. */
export function parseCutNameRule(value: unknown) {
  return typeof value === 'string' && value.trim() !== '' ? value : defaultCutNameRule;
}

/**
The rule to keep for a stored value, moving the old default to the new one.

Only the exact old default is migrated: it is what `electron-store` wrote for every install that
never touched the rule. Any other value is the user's choice and is returned unchanged (the
migration writes the result back, so a custom rule must not be replaced).
*/
export function migrateCutNameRule(value: unknown) {
  return value === oldDefaultCutNameRule ? defaultCutNameRule : value;
}

/** A stored label separator, or the default when the value is not one of the offered separators. */
export function parseCutLabelSeparator(value: unknown) {
  return typeof value === 'string' && (labelSeparatorOptions as readonly string[]).includes(value)
    ? value
    : defaultCutLabelSeparator;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

/**
A stored rule name context, or `undefined` when it cannot re-render a name.

A record written by another build or edited by hand must not crash the results window: it is
dropped instead (the rename then reports that the label cannot be renamed).
*/
export function parseRuleCutNameContext(value: unknown): RuleCutNameContext | undefined {
  if (!isRecord(value) || value['kind'] !== 'rule') return undefined;
  const { rule, outputDir, extension, sourceName, sourceFolder, clips, index, epochMs,
    exportCount, labelSeparator, maxLabelLength, minZeroPadding, maxStemLength, forcedSuffix } = value;

  if (typeof rule !== 'string' || rule.trim() === '' || typeof outputDir !== 'string' || typeof extension !== 'string') return undefined;
  if (typeof sourceName !== 'string' || typeof sourceFolder !== 'string' || !Array.isArray(clips)) return undefined;

  const parsedClips: CutNameClip[] = [];
  for (const clip of clips) {
    if (!isRecord(clip)) return undefined;
    const { label, start, end } = clip;
    if (label !== undefined && typeof label !== 'string') return undefined;
    if (typeof start !== 'number' || !Number.isFinite(start) || typeof end !== 'number' || !Number.isFinite(end)) return undefined;
    parsedClips.push({ ...((label !== undefined) && { label }), start, end });
  }

  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= parsedClips.length) return undefined;
  if (typeof epochMs !== 'number' || !Number.isFinite(epochMs)) return undefined;
  if (exportCount !== undefined && (typeof exportCount !== 'number' || !Number.isFinite(exportCount))) return undefined;
  if ((typeof labelSeparator !== 'string') || typeof maxLabelLength !== 'number' || !Number.isFinite(maxLabelLength)) return undefined;
  if (typeof minZeroPadding !== 'number' || !Number.isFinite(minZeroPadding) || typeof maxStemLength !== 'number' || !Number.isFinite(maxStemLength) || maxStemLength < 1) return undefined;
  if (typeof forcedSuffix !== 'string') return undefined;

  return {
    kind: 'rule',
    rule,
    outputDir,
    extension,
    sourceName,
    sourceFolder,
    clips: parsedClips,
    index,
    epochMs,
    ...((exportCount !== undefined) && { exportCount }),
    labelSeparator,
    maxLabelLength,
    minZeroPadding,
    maxStemLength,
    forcedSuffix,
  };
}
