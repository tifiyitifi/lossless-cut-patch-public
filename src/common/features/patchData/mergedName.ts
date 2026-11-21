/**
Naming rule for the merged result (fork-owned).

The rule is the `{token}` rule of the downloader this fork follows
(PixivBatchDownloader's "image work naming rule"), not the upstream `${}` template: tokens are
plain names, a `[...]` group disappears when its token is empty, and a value never contributes a
path separator. Everything here is pure string work, so the dialog preview and the merge use the
same function and the whole rule set is covered by unit tests.

Order matters (and is the order the reference project uses):
1. build the token values and sanitize the unsafe ones,
2. resolve `[...]` optional groups on the *rule* (so brackets inside a value are literal),
3. remove the separator in front of an empty token,
4. substitute the tokens, append the output extension,
5. normalize the result for the file system (reserved names, dots, length).
*/

import { formatEpochMsForFileName } from './naming.js';

/** The tokens a merged name rule can use. */
export interface MergedNameToken {
  /** The token as written in a rule, without the braces. */
  name: string;
  /** Values a user typed (source name, labels) need sanitizing; derived values do not. */
  safe: boolean;
  /** The token can render nothing (use it in a `[...]` group). */
  mayEmpty: boolean;
  /** Can the rendered value make two merges of the same source differ? */
  unique: boolean;
}

export const mergedNameTokens: readonly MergedNameToken[] = [
  { name: 'source', safe: false, mayEmpty: false, unique: false },
  { name: 'source_folder', safe: false, mayEmpty: true, unique: false },
  { name: 'labels', safe: false, mayEmpty: true, unique: false },
  { name: 'label', safe: false, mayEmpty: true, unique: false },
  { name: 'count', safe: true, mayEmpty: false, unique: false },
  { name: 'date', safe: true, mayEmpty: false, unique: false },
  { name: 'time', safe: true, mayEmpty: false, unique: false },
  { name: 'datetime', safe: true, mayEmpty: false, unique: true },
  { name: 'epoch_ms', safe: true, mayEmpty: false, unique: true },
  { name: 'export_count', safe: true, mayEmpty: false, unique: true },
];

/**
The default rule.

`merge` is only text: it marks a processed file. The whole rule is editable, so a user who wants
a purely label based name changes this to `{source}[ - {labels}]`.
*/
export const defaultMergedNameRule = '{source}[ - {labels}]-merge';

/** Joins the clip labels in `{labels}`. */
export const defaultLabelSeparator = '-';

/** The separators the label join offers. */
export const labelSeparatorOptions = ['-', ',', '#', '^', '&', '_'] as const;

export type MergedNamePresetId = 'default' | 'labels' | 'datetime' | 'date' | 'plain';

export interface MergedNamePreset {
  id: MergedNamePresetId;
  rule: string;
}

/** The rules the dialogs offer as chips, in the order they are shown. */
export const mergedNamePresets: readonly MergedNamePreset[] = [
  { id: 'default', rule: defaultMergedNameRule },
  { id: 'labels', rule: '{source}[ - {labels}]' },
  { id: 'datetime', rule: '{source}-merge-{datetime}' },
  { id: 'date', rule: '{source}-merge-{date}' },
  { id: 'plain', rule: '{source}-merge' },
];

/** Why a rule (or the name it renders) cannot be used. */
export type MergedNameProblem = | { code: 'emptyRule' }
  | { code: 'separator', chars: string }
  | { code: 'emptyName' }
  /** The rendered name does not fit the file name limit or the Windows path budget. */
  | { code: 'pathTooLong' };

/**
Keeping the same characters the reference project removes: control characters, line/paragraph
separators (Zl/Zp, the ones that are easy to miss), invisible format characters and the special
spaces. U+0020 and U+3000 are kept: both are normal in a file name (U+3000 is common in Japanese
titles), and dropping U+3000 would change the meaning of a name.
*/
// eslint-disable-next-line no-control-regex -- the control characters are exactly what is removed.
const unsafeChars = /[\u0000-\u001F\u007F-\u009F\u00A0\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F\u2060-\u2064\u2066-\u206F\uFDD0-\uFDEF\uFEFF\uFFF9-\uFFFB\uFFFE\uFFFF]/g;

/**
Characters a file name (or a folder name) cannot reliably hold, mapped to their full-width form
instead of being dropped: the name stays readable, and a `/` from a label can never create a
folder. `~` is mapped as well (the reference project does the same).
*/
const fullWidthChars: readonly (readonly [string, string])[] = [
  ['\\', '＼'],
  ['/', '／'],
  [':', '：'],
  ['?', '？'],
  ['"', '＂'],
  ['<', '＜'],
  ['>', '＞'],
  ['*', '＊'],
  ['|', '｜'],
  ['~', '～'],
];

/**
Sanitize one value for a file name.

Used for every unsafe token (source name, folder name, labels) and for the rendered name as a
whole. Path separators are mapped to full-width, so no token can escape the merged folder.
*/
export function sanitizeNamePart(value: string) {
  let result = value.replaceAll(unsafeChars, '');
  for (const [halfWidth, fullWidth] of fullWidthChars) {
    result = result.replaceAll(halfWidth, fullWidth);
  }
  return result.trim();
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

/** The local date of `epochMs` as `YYYY-MM-DD`. */
export function formatMergedNameDate(epochMs: number) {
  const date = new Date(epochMs);
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The local time of `epochMs` as `HH_MM_SS` (a colon is not a file name character on Windows). */
export function formatMergedNameTime(epochMs: number) {
  const date = new Date(epochMs);
  return `${pad(date.getHours())}_${pad(date.getMinutes())}_${pad(date.getSeconds())}`;
}

/**
The values of every token for one merge. Every value is a string, empty when it renders nothing.

A type alias rather than an interface on purpose: the render functions take any token map (the
cut results have their own tokens, see `cutName.ts`), which needs the implicit index signature
only an alias gets.
*/
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- see above: an interface would not be assignable to the shared token map.
export type MergedNameValues = {
  source: string;
  source_folder: string;
  labels: string;
  label: string;
  count: string;
  date: string;
  time: string;
  datetime: string;
  epoch_ms: string;
  export_count: string;
};

/**
Clean, de-duplicate and join the clip labels.

An unlabeled clip is skipped (a rule that uses `{labels}` simply gets the labels that exist), and
a label that occurs twice is kept once: a merge of three clips labeled "intro" reads better as
"intro" than "intro-intro-intro". The order is the merge order (first occurrence wins).
*/
export function normalizeMergedLabels({ labels, maxLabelLength }: {
  labels: readonly (string | undefined)[];
  maxLabelLength: number;
}) {
  const limit = Math.max(0, maxLabelLength);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const label of labels) {
    if (!(label != null)) {
      continue;
    }

    // Truncate by code point: a slice of UTF-16 units can end in half of an emoji.
    const part = [...sanitizeNamePart(label)].slice(0, limit).join('').trim();
    if (part !== '' && !seen.has(part)) {
      seen.add(part);
      result.push(part);
    }
  }
  return result;
}

export interface BuildMergedNameValuesParams {
  /** The source file name without its extension (the caller parses the path). */
  sourceName: string;
  /** The name of the folder the source file is in (`''` when there is none). */
  sourceFolder: string;
  labels: readonly (string | undefined)[];
  /** Number of clips that go into the merge (labeled or not). */
  clipCount: number;
  epochMs: number;
  exportCount?: number | undefined;
  labelSeparator: string;
  maxLabelLength: number;
}

/** Build (and sanitize) the values of all tokens for one merge. */
export function buildMergedNameValues({
  sourceName, sourceFolder, labels, clipCount, epochMs, exportCount, labelSeparator, maxLabelLength,
}: BuildMergedNameValuesParams): MergedNameValues {
  const cleanLabels = normalizeMergedLabels({ labels, maxLabelLength });
  return {
    source: sanitizeNamePart(sourceName),
    source_folder: sanitizeNamePart(sourceFolder),
    labels: cleanLabels.join(labelSeparator),
    // `{label}` is "the one label of this merge": with several labeled clips there is no single
    // label, and a rule that wants the list uses `{labels}`.
    label: cleanLabels.length === 1 ? cleanLabels[0]! : '',
    count: String(clipCount),
    date: formatMergedNameDate(epochMs),
    time: formatMergedNameTime(epochMs),
    datetime: formatEpochMsForFileName(epochMs),
    epoch_ms: String(epochMs),
    export_count: exportCount == null ? '' : String(exportCount),
  };
}

/**
`{{` and `}}` stand for a literal brace pair. They are swapped for characters no rule can contain
before the rule is read, so the token pass cannot see a token inside them; `renderMergedNameStem`
puts the braces back at the end.
*/
const escapedOpenBrace = '\u{E000}';
const escapedCloseBrace = '\u{E001}';

/** Hide the escaped braces from the token / bracket / separator passes. */
function protectEscapedBraces(rule: string) {
  return rule.replaceAll('{{', escapedOpenBrace).replaceAll('}}', escapedCloseBrace);
}

function restoreEscapedBraces(text: string) {
  return text.replaceAll(escapedOpenBrace, '{').replaceAll(escapedCloseBrace, '}');
}

/** Does the rule use the token as a token? An escaped `{{name}}` is literal text, not a token. */
export function ruleUsesToken(rule: string, name: string) {
  return protectEscapedBraces(rule).includes(`{${name}}`);
}

/** Does the rule ask for a value that always differs between two merges? */
export function ruleHasUniqueToken(rule: string) {
  return mergedNameTokens.some((token) => token.unique && ruleUsesToken(rule, token.name));
}

/** The token is written as a plain `{name}` (not escaped, not part of a longer word). */
const tokenPattern = String.raw`\{([^{}]*)\}`;

/** The token names used by a piece of the rule (unknown names included: they are not analyzable). */
function tokensOf(text: string) {
  return [...text.matchAll(new RegExp(tokenPattern, 'g'))].map((match) => match[1]!);
}

/** Opening bracket index -> closing bracket index (unmatched brackets are absent). */
function matchBrackets(rule: string) {
  const closeOf = new Map<number, number>();
  const open: number[] = [];
  // Indices are UTF-16 code units, the same unit `rule[index]` and `rule.slice` use: counting code
  // points (`[...rule]`) would shift every bracket behind an emoji and mangle the rule.
  let index = 0;
  while (index < rule.length) {
    const char = rule[index];
    if (char === '[') open.push(index);
    else if (char === ']' && open.length > 0) {
      closeOf.set(open.pop()!, index);
    }
    index += 1;
  }
  return closeOf;
}

/**
Resolve the `[...]` optional groups of a rule.

A group that holds exactly one token and no nested group is removed when that token renders
nothing, so the text around it (a dash, a space, a prefix) disappears with it. A group without a
token, or with several, is kept: only a single empty token can prove the whole group pointless.
Nested brackets are literal: `[[...]]` keeps its brackets and resolves the inner group. An
unmatched bracket is literal as well.
*/
export function resolveOptionalSegments(rule: string, values: Readonly<Record<string, string>>) {
  const closeOf = matchBrackets(rule);
  const known = new Set(Object.keys(values));

  const processRange = (start: number, end: number): string => {
    let result = '';
    let index = start;
    while (index < end) {
      const close = closeOf.get(index);
      if (close == null || close >= end) {
        result += rule[index];
        index += 1;
      } else {
        const openIndex = index;
        const inner = processRange(openIndex + 1, close);
        const hasNestedGroup = [...closeOf.keys()].some((child) => child > openIndex && child < close);

        if (hasNestedGroup) {
          result += `[${inner}]`;
        } else {
          const names = tokensOf(rule.slice(index + 1, close));
          if (names.length === 0) {
            result += `[${inner}]`;
          } else if (names.length === 1 && known.has(names[0]!) && values[names[0]!] === '') {
            // The single token renders nothing: drop the whole group, brackets and custom text.
          } else {
            result += inner;
          }
        }

        index = close + 1;
      }
    }
    return result;
  };

  return processRange(0, rule.length);
}

/** The separators that are removed together with an empty token they sit next to. */
const emptyTokenSeparators = ['-', '_', ' ', ',', '&', '#'] as const;

/** A run of separators at the edge of a rule, left behind by a token that rendered nothing. */
const leadingSeparatorRun = /^[\s\-_,&#]+/u;

/**
Remove the separator that an empty token would leave dangling.

The separator in front of the token goes away with it (`{source}-{labels}`). A token at the start
of the rule (or of a `[...]` group) has nothing in front, so the separator behind it goes instead,
together with the rest of that run (`{labels} - {source}`).
*/
export function dropEmptyTokenSeparators(rule: string, token: string) {
  let result = rule;
  const atEdge = () => result.startsWith(token) || result.startsWith(`[${token}`);
  for (const separator of emptyTokenSeparators) {
    if (result.includes(`${separator}${token}`)) {
      result = result.replaceAll(`${separator}${token}`, '');
    } else if (atEdge() && result.includes(`${token}${separator}`)) {
      result = result.replaceAll(`${token}${separator}`, '');
      if (leadingSeparatorRun.test(result)) result = result.replace(leadingSeparatorRun, '');
    }
  }
  return result;
}

/**
Render the rule's name (without the extension).

A token is `{name}`; an unknown name is left as written. A doubled brace writes the braces
literally: `{{source}}` renders `{source}`, whatever the source file is called.
*/
export function renderMergedNameStem(rule: string, values: Readonly<Record<string, string>>) {
  // The escaped braces are hidden first: a token inside them is text, and a separator next to it
  // must not be read as a dangling one.
  let result = resolveOptionalSegments(protectEscapedBraces(rule), values);

  // The dangling separator is resolved on the rule (before any value is in it), so a value that
  // happens to contain a token-like `{labels}` is never read as a token.
  for (const [name, value] of Object.entries(values)) {
    if (value === '') result = dropEmptyTokenSeparators(result, `{${name}}`);
  }

  return restoreEscapedBraces(result.replaceAll(new RegExp(tokenPattern, 'g'), (match, name: string) => (
    name in values ? (values[name] ?? '') : match
  )));
}

/** Windows device names that cannot be used as a file or folder name (the reference list, completed). */
const windowsReservedNames = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

/** Is this file/folder name one of Windows' reserved device names? (`CON.txt` still is `CON`.) */
export function isWindowsReservedName(name: string) {
  const firstDot = name.indexOf('.');
  const head = firstDot === -1 ? name : name.slice(0, firstDot);
  return windowsReservedNames.has(head.toUpperCase());
}

/** Keep a reserved name usable by appending the marker the reference project uses. */
export function escapeWindowsReservedName(stem: string) {
  const firstDot = stem.indexOf('.');
  if (!isWindowsReservedName(stem)) return stem;
  const head = firstDot === -1 ? stem : stem.slice(0, firstDot);
  return `${head}[WindowsReservedName]${firstDot === -1 ? '' : stem.slice(firstDot)}`;
}

/** Upstream's file name limit (`maxFileNameLength` in `renderer/src/util/outputNameTemplate`). */
export const maxMergedFileNameLength = 250;

/** Windows refuses a full path that reaches this length (upstream checks the same number). */
const maxWindowsPathLength = 259;

/** The smallest file name budget that still produces a usable name. */
const minFileNameBudget = 16;

export interface ResolveMergedNameParams {
  rule: string;
  sourceName: string;
  sourceFolder: string;
  labels: readonly (string | undefined)[];
  /** The output extension, without the dot. */
  ext: string;
  /** The absolute folder the merged file is written to (for the path length budget). */
  outputDir: string;
  epochMs: number;
  exportCount?: number | undefined;
  labelSeparator: string;
  maxLabelLength: number;
  isWindows: boolean;
}

export type ResolveMergedNameResult = | { fileName: string }
  | { problem: MergedNameProblem };

/**
Check the rule alone (no merge context needed): it must not be empty and must not contain a path
separator. The merged result is a single file in the merged folder, so a rule cannot create
folders here; a separator in a value is mapped to full-width instead (see `sanitizeNamePart`).
*/
export function checkMergedNameRule(rule: string): MergedNameProblem | undefined {
  if (rule.trim() === '') return { code: 'emptyRule' };
  const found: string[] = [];
  if (rule.includes('/')) found.push('/');
  if (rule.includes('\\')) found.push('\\');
  return found.length > 0 ? { code: 'separator', chars: found.join('", "') } : undefined;
}

/**
Cut the stem so the name still fits, keeping the token that makes it unique when possible.

Shared with the cut results (see `cutName.ts`): the same rule syntax has to be shortened the same
way wherever it names a file. `keepCandidates` is the caller's priority order - a merge is told
apart by its timestamp / export number, a cut result by its number inside the batch, so each
passes its own (the default is the merged order).
*/
export function truncateNameStem({ stem, maxStemLength, rule, values, keepCandidates = ['epoch_ms', 'export_count', 'datetime', 'source'] }: {
  stem: string;
  maxStemLength: number;
  rule: string;
  values: Readonly<Record<string, string>>;
  /** Token names tried in order; the first one the rule really uses is kept in the shortened name. */
  keepCandidates?: readonly string[] | undefined;
}) {
  // The value a shortened name must keep: the one that tells two results apart (or the source, so
  // the shortened name still says what it was cut from). An escaped token renders text, not a
  // value, so it does not qualify.
  const keepToken = keepCandidates.find((name) => ruleUsesToken(rule, name));
  const keep = keepToken == null ? '' : (values[keepToken] ?? '');

  const trimEdges = (value: string) => value.replace(/^[\s.,_-]+/u, '').replace(/[\s.,_-]+$/u, '');
  // `…` rather than `...`: a path must not end with a dot.
  const plain = () => `${trimEdges(stem.slice(0, Math.max(0, maxStemLength - 1)))}…`;
  if (keep === '' || keep.length + 2 > maxStemLength) return plain();

  // A rule that ends with the kept token should not repeat it at the end of the shortened name.
  if (stem.endsWith(keep)) {
    // Slice one more unit than before: the separator put back in front of the kept value needs room.
    const head = trimEdges(stem.slice(0, maxStemLength - keep.length - 2));
    return `${head}${head === '' ? '' : '-'}${keep}…`;
  }
  const prefix = trimEdges(stem.slice(0, maxStemLength - keep.length - 2));
  return `${prefix}${prefix === '' ? '' : '-'}${keep}…`;
}

/**
The room a name stem has in `outputDir`, after the extension (`undefined`: no usable name fits).

Shared with the cut results, which have to shorten their names with the same budget.
*/
export function fileNameStemBudget({ outputDir, extension, isWindows }: {
  outputDir: string;
  /** The extension, including the dot (`''` when there is none). */
  extension: string;
  isWindows: boolean;
}) {
  const nameBudget = isWindows
    // `>= 259` is what upstream refuses (`util/outputNameTemplate`): the joined path must stay below
    // it, so the name may use `259 - dir - 2` characters (`dir` + separator + name).
    ? Math.min(maxMergedFileNameLength, maxWindowsPathLength - outputDir.length - 2)
    : maxMergedFileNameLength;
  if (nameBudget < minFileNameBudget) return undefined;
  return Math.max(1, nameBudget - extension.length);
}

/**
Render the rule and turn the result into the file name to write.

`outputDir` is only used for the Windows path budget: the caller still joins the name itself, so
this function cannot write anywhere. A name that does not fit is **refused** (`pathTooLong`)
instead of shortened: the caller stops and lets the user shorten the folder or the rule.
*/
export function resolveMergedName({
  rule, sourceName, sourceFolder, labels, ext, outputDir, epochMs, exportCount,
  labelSeparator, maxLabelLength, isWindows,
}: ResolveMergedNameParams): ResolveMergedNameResult {
  const ruleProblem = checkMergedNameRule(rule);
  if (ruleProblem != null) return { problem: ruleProblem };

  const values = buildMergedNameValues({
    sourceName, sourceFolder, labels, clipCount: labels.length, epochMs, exportCount, labelSeparator, maxLabelLength,
  });

  let stem = sanitizeNamePart(renderMergedNameStem(rule, values));
  // A leading dot would make the merged result a hidden file; a trailing dot/space is dropped by
  // the file system (or refuses the name), and the extension is appended right after the stem.
  stem = stem.replace(/^\.+/u, (dots) => '．'.repeat(dots.length)).replace(/[\s.]+$/u, '');
  stem = escapeWindowsReservedName(stem);
  if (stem === '') return { problem: { code: 'emptyName' } };

  const extension = ext === '' ? '' : `.${ext.replace(/^\.+/u, '')}`;
  const maxStemLength = fileNameStemBudget({ outputDir, extension, isWindows });
  if (maxStemLength == null) return { problem: { code: 'pathTooLong' } };
  // Refused, not shortened: the export stops until the user shortens the folder or the rule.
  if (stem.length > maxStemLength) return { problem: { code: 'pathTooLong' } };

  return { fileName: `${stem}${extension}` };
}

/** A stored rule, or the default when the value is missing or unusable. */
export function parseMergedNameRule(value: unknown) {
  return typeof value === 'string' && value.trim() !== '' ? value : defaultMergedNameRule;
}

/** A stored label separator, or the default when the value is not one of the offered separators. */
export function parseLabelSeparator(value: unknown) {
  return typeof value === 'string' && (labelSeparatorOptions as readonly string[]).includes(value)
    ? value
    : defaultLabelSeparator;
}
