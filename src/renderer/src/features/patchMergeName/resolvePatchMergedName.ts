import type { PlatformPath } from 'node:path';

import type { ResolveMergedNameResult } from '../../../../common/features/patchData/mergedName';
import { resolveMergedName } from '../../../../common/features/patchData/mergedName';

/**
The merged result's file name (fork-owned).

The rule engine lives in `common/features/patchData/mergedName` (pure and tested); this wrapper
only reads the source path with `node:path` the way the rest of the renderer does, so the caller
passes the paths it already has.
*/

const { parse: parsePath, basename: pathBasename, dirname: pathDirname }: PlatformPath = window.require('node:path');

export interface ResolvePatchMergedNameParams {
  rule: string;
  /** The source video the clips were cut from. */
  sourcePath: string;
  /** One entry per merged clip; an unlabeled clip has no label. */
  labels: readonly (string | undefined)[];
  /** The folder the merged file is written to (used for the path length budget). */
  outputDir: string;
  /** The output extension, with or without the leading dot. */
  ext: string;
  epochMs: number;
  exportCount?: number | undefined;
  labelSeparator: string;
  maxLabelLength: number;
  isWindows: boolean;
}

export function resolvePatchMergedName({
  rule, sourcePath, labels, outputDir, ext, epochMs, exportCount, labelSeparator, maxLabelLength, isWindows,
}: ResolvePatchMergedNameParams): ResolveMergedNameResult {
  const { name } = parsePath(sourcePath);
  return resolveMergedName({
    rule,
    sourceName: name,
    sourceFolder: pathBasename(pathDirname(sourcePath)),
    labels,
    ext: ext.replace(/^\.+/u, ''),
    outputDir,
    epochMs,
    exportCount,
    labelSeparator,
    maxLabelLength,
    isWindows,
  });
}

/** The user-facing message for a rule that cannot render a file name. */
export { mergedNameProblemMessage } from '../patchNameRule/problemMessages';
