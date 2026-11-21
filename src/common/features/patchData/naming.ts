/**
Output naming presets for patch mode.

`losslesscut` mirrors the upstream default templates; `legacy` mirrors the old PowerShell
script prefixes (`clip_NNN_...`, `merged_...`). The actual template rendering is done by the
upstream output-name template engine, so these templates use the upstream placeholder syntax.
*/
/* eslint-disable no-template-curly-in-string */

export type NamingPresetId = 'losslesscut' | 'legacy';

/**
A readable, file-name safe timestamp for the export name templates.

Same precision as `EPOCH_MS` (milliseconds), but written as local time:
`2026-10-26--18_01_06.019` (the double hyphen separates date and time, the dot marks the
milliseconds). Only digits, `-`, `_` and `.` are used, so the name stays valid on every platform
and still sorts chronologically.
*/
export function formatEpochMsForFileName(epochMs: number) {
  const date = new Date(epochMs);
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return [
    `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}_${pad(date.getMinutes())}_${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`,
  ].join('--');
}

/** The template variable that holds `formatEpochMsForFileName`'s value. */
export const epochStrVariable = 'EPOCH_STR';

/**
Patch-mode defaults for merged files (arbitrary files concatenated in the batch dialog).

They use the readable stamp instead of the raw `EPOCH_MS` number. Base mode keeps the upstream
defaults; a template the user set always wins. The merged *cut* results are named by
`mergedName.ts` instead (fork-owned `{token}` rule).
*/
export const patchMergedFileTemplate = '${FILENAME}-merged-${EPOCH_STR}${EXT}';

/**
The file name to write to: the trimmed one, or a free ` (n)` sibling when it is taken.

`overwrite` is the user's answer to "may the existing file be replaced?" - it only matters when
the name is taken, so a unique template ignores it. An existing file is never replaced silently:
without the choice, the merge writes next to it instead.

`undefined` means every candidate is taken (a folder full of ` (1)`..` (9999)` siblings): the
caller must refuse the merge instead of replacing a file nobody checked.
*/
export function resolveMergeFileName({ fileName, isTaken, overwrite }: {
  fileName: string;
  /** Is this name already used in the target folder? */
  isTaken: (candidate: string) => boolean;
  overwrite: boolean;
}): string | undefined {
  if (overwrite || !isTaken(fileName)) return fileName;

  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const extension = dot > 0 ? fileName.slice(dot) : '';
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = `${stem} (${index})${extension}`;
    if (!isTaken(candidate)) return candidate;
  }
  return undefined;
}

export interface NamingPreset {
  id: NamingPresetId;
  /** Template for individually cut segments. */
  cutTemplate: string;
  /** Template for the merged output of the selected cut segments. */
  cutMergedTemplate: string;
  /** Template for merging arbitrary (non-cut) files. */
  mergedTemplate: string;
}

export const namingPresets: Record<NamingPresetId, NamingPreset> = {
  // Mirrors src/renderer/src/util/outputNameTemplate.ts defaults.
  losslesscut: {
    id: 'losslesscut',
    cutTemplate: '${FILENAME}-${CUT_FROM}-${CUT_TO}${SEG_SUFFIX}${EXT}',
    cutMergedTemplate: '${FILENAME}-cut-merged-${EPOCH_MS}${EXT}',
    mergedTemplate: '${FILENAME}-merged-${EPOCH_MS}${EXT}',
  },
  // Approximates the old PowerShell prefixes. Refine when wiring the real exporter (phase 2/5).
  legacy: {
    id: 'legacy',
    cutTemplate: 'clip_${SEG_NUM}${EXT}',
    cutMergedTemplate: 'merged_${SEG_NUM}${EXT}',
    mergedTemplate: 'merged_${EPOCH_MS}${EXT}',
  },
};

export const defaultNamingPresetId: NamingPresetId = 'losslesscut';

export function getNamingPreset(id: NamingPresetId): NamingPreset {
  return namingPresets[id];
}

/**
The cut file-name template patch should use.

`legacy` applies the old PowerShell prefixes; the default (`losslesscut`) keeps whatever template
the user configured upstream, so patch output naming never diverges from base mode unless asked.
*/
export function getPatchCutTemplate(namingPreset: NamingPresetId | undefined, upstreamTemplate: string): string {
  if (namingPreset === 'legacy') return namingPresets.legacy.cutTemplate;
  return upstreamTemplate;
}

/**
Insert a suffix before the extension: `('clip.mp4', '_fixed')` -> `'clip_fixed.mp4'`.
Used for patch's derivative outputs (merged / fixed), so their names stay predictable.
*/
export function appendNameSuffix(fileName: string, suffix: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return `${fileName}${suffix}`;
  return `${fileName.slice(0, dot)}${suffix}${fileName.slice(dot)}`;
}
