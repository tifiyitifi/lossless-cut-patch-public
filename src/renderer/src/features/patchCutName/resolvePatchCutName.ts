import type { PlatformPath } from 'node:path';

import type { CutNameClip, CutNameProblem, RuleCutNameContext } from '../../../../common/features/patchData/cutName';
import { resolveCutNames } from '../../../../common/features/patchData/cutName';

/**
The cut results' file names (fork-owned).

The rule engine lives in `common/features/patchData/cutName` (pure and tested); this wrapper only
reads the source path with `node:path` the way the rest of the renderer does, and turns the result
into the per-result records the export stores (`RuleCutNameContext`), so a later label rename
re-renders the same name.
*/

const { parse: parsePath, basename: pathBasename, dirname: pathDirname }: PlatformPath = window.require('node:path');

export interface ResolvePatchCutNamesParams {
  rule: string;
  /** The source video the results are cut from. */
  sourcePath: string;
  /** Every clip of this export, in export order. */
  clips: readonly CutNameClip[];
  /** The folder the results are written to (used for the path length budget). */
  outputDir: string;
  /** The output extension, with or without the leading dot. */
  ext: string;
  epochMs: number;
  exportCount?: number | undefined;
  labelSeparator: string;
  maxLabelLength: number;
  minZeroPadding: number;
  isWindows: boolean;
  /** Windows and macOS compare file names case-insensitively. */
  caseInsensitive: boolean;
}

export type PatchCutNamesResult = | {
  names: string[];
  /** The number + time suffix each name got (`''` when it was unique). */
  suffixes: string[];
  /** The record to store with each result, in export order. */
  contexts: RuleCutNameContext[];
}
  | { problem: CutNameProblem };

export function resolvePatchCutNames({
  rule, sourcePath, clips, outputDir, ext, epochMs, exportCount, labelSeparator,
  maxLabelLength, minZeroPadding, isWindows, caseInsensitive,
}: ResolvePatchCutNamesParams): PatchCutNamesResult {
  const { name: sourceName } = parsePath(sourcePath);
  const sourceFolder = pathBasename(pathDirname(sourcePath));
  const extension = ext === '' ? '' : `.${ext.replace(/^\.+/u, '')}`;

  const resolved = resolveCutNames({
    rule,
    sourceName,
    sourceFolder,
    clips,
    ext,
    outputDir,
    epochMs,
    exportCount,
    labelSeparator,
    maxLabelLength,
    minZeroPadding,
    isWindows,
    caseInsensitive,
  });
  if ('problem' in resolved) return resolved;

  const contexts: RuleCutNameContext[] = clips.map((_clip, index) => ({
    kind: 'rule',
    rule,
    outputDir,
    extension,
    sourceName,
    sourceFolder,
    clips: [...clips],
    index,
    epochMs,
    ...((exportCount != null) && { exportCount }),
    labelSeparator,
    maxLabelLength,
    minZeroPadding,
    maxStemLength: resolved.maxStemLength,
    forcedSuffix: resolved.suffixes[index] ?? '',
  }));

  return {
    names: resolved.names,
    suffixes: resolved.suffixes,
    contexts,
  };
}

/** The user-facing message for a rule that cannot name the cut results. */
export { cutNameProblemMessage } from '../patchNameRule/problemMessages';
