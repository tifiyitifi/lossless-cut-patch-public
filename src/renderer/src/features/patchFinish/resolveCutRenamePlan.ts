import type { PlatformPath } from 'node:path';

import type { CutRenamePlanEntry } from '../../../../common/features/patchFinish';
import { planCutRename } from '../../../../common/features/patchFinish';
import { cutNameProblemMessage } from '../patchNameRule/problemMessages';

/**
The names the finish job gives the cut results as it moves them (fork-owned).

The rule engine and the plan live in `common/features/patchFinish/cutRename` (pure and tested);
this wrapper only reads the source path with `node:path` the way the rest of the renderer does and
turns the plan into what the dialog shows: the file names, or the reason the rule cannot be used.

The plan is rendered from the results the job starts with and then kept for the whole attempt (see
`usePatchFinish`): a retry after a half-finished job must not renumber the results it did not reach.
*/

const { parse: parsePath, basename: pathBasename, dirname: pathDirname }: PlatformPath = window.require('node:path');

export interface ResolveFinishCutRenameParams {
  rule: string;
  /** The cut results the job moves: `path` plus the clip data the export record kept. */
  clips: readonly { path: string; label?: string | undefined; start?: number | undefined; end?: number | undefined }[];
  /** The source video the results were cut from (its name is `{source}`). */
  sourcePath: string;
  /** The folder the results are moved to (the Windows path budget depends on it). */
  targetDir: string;
  /** The timestamp the dialog opened with. */
  epochMs: number;
  labelSeparator: string;
  maxLabelLength: number;
  minZeroPadding: number;
  isWindows: boolean;
  caseInsensitive: boolean;
}

export type ResolveFinishCutRenameResult = | {
  /** One file name per clip, in plan order. */
  lines: string[];
  plan: CutRenamePlanEntry[];
}
  | { problem: string };

export function resolveFinishCutRename({
  rule, clips, sourcePath, targetDir, epochMs, labelSeparator, maxLabelLength, minZeroPadding, isWindows, caseInsensitive,
}: ResolveFinishCutRenameParams): ResolveFinishCutRenameResult {
  const { name } = parsePath(sourcePath);
  const result = planCutRename({
    rule,
    clips: clips.map((clip) => ({
      path: clip.path,
      ...(clip.label !== undefined && { label: clip.label }),
      start: clip.start ?? 0,
      end: clip.end ?? 0,
    })),
    sourceName: name,
    sourceFolder: pathBasename(pathDirname(sourcePath)),
    targetDir,
    epochMs,
    labelSeparator,
    maxLabelLength,
    minZeroPadding,
    isWindows,
    caseInsensitive,
  });
  if ('problem' in result) return { problem: cutNameProblemMessage(result.problem) };
  return { lines: result.plan.map((entry) => entry.fileName), plan: result.plan };
}
