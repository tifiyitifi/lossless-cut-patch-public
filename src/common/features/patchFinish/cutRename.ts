import type { CutNameClip, CutNameProblem } from '../patchData/cutName.js';
import { resolveCutNames } from '../patchData/cutName.js';
import { getPathExtension, getPathFileName, isPathInside, normalizePath } from './paths.js';

/**
Renaming the cut results while the finish job moves them (pure).

The name comes from the same `{token}` rule the export uses (`features/patchData/cutName`), so the
dialog, the preview and the job all agree on one rendering. This module only plans: the job moves
the files (`main/features/patchFinish/execute`).

Why a *plan* and not "render the rule again for every clip": a job that stops halfway (a locked
result) is retried with the files it already moved gone from the preview. Rendering again would
renumber the remaining results and give the next attempt different names. The plan is therefore
rendered once per attempt from the results the job starts with, and the retry reuses it.
*/

/** One cut result the plan names: the file it is now and its clip data (from the export record). */
export interface CutRenamePlanClip extends CutNameClip {
  path: string;
}

export interface CutRenamePlanEntry {
  /** The result's path before the job (the preview's `clips[].path`). */
  from: string;
  /** The file name it is moved to (no folder). */
  fileName: string;
}

export interface PlanCutRenameParams {
  rule: string;
  /** Every cut result this job moves, in a stable order (the preview's order). */
  clips: readonly CutRenamePlanClip[];
  /** The source file name without its extension (the caller parses the path). */
  sourceName: string;
  /** The name of the folder the source file is in (`''` when there is none). */
  sourceFolder: string;
  /** The folder the results are moved to (the Windows path budget depends on it). */
  targetDir: string;
  /** The timestamp the dialog opened with: `{date}`, `{time}` and `{datetime}` use it. */
  epochMs: number;
  labelSeparator: string;
  maxLabelLength: number;
  minZeroPadding: number;
  isWindows: boolean;
  caseInsensitive: boolean;
}

export type PlanCutRenameResult = | { plan: CutRenamePlanEntry[] }
  /** The rule cannot name these results; the finish dialog blocks until it is changed or turned off. */
  | { problem: CutNameProblem };

/**
Plan the names of one job.

A result whose name another result of the same job already has gets the number + time suffix the
export applies (`... - 01-2026-11-16--18_01_06.019`), so no result ever replaces another one. A
name that is taken in the target folder is not part of the plan: the executor appends ` (n)` there,
because only it can ask the file system at the moment of the move.
*/
export function planCutRename({
  rule, clips, sourceName, sourceFolder, targetDir, epochMs, labelSeparator,
  maxLabelLength, minZeroPadding, isWindows, caseInsensitive,
}: PlanCutRenameParams): PlanCutRenameResult {
  if (clips.length === 0) return { plan: [] };

  // The results of one job normally share the output format. Keeping the longest extension for the
  // path budget means every name fits, whatever the others are, and each result still keeps its own.
  const extensions = clips.map((clip) => getPathExtension(clip.path));
  const longestExtension = extensions.reduce((longest, extension) => (extension.length > longest.length ? extension : longest), '');

  const resolved = resolveCutNames({
    rule,
    sourceName,
    sourceFolder,
    clips: clips.map(({ label, start, end }) => ({ ...(label !== undefined && { label }), start, end })),
    ext: longestExtension,
    outputDir: targetDir,
    epochMs,
    labelSeparator,
    maxLabelLength,
    minZeroPadding,
    isWindows,
    caseInsensitive,
  });
  if ('problem' in resolved) return resolved;

  const plan = clips.map((clip, index) => {
    const name = resolved.names[index] ?? '';
    // `resolveCutNames` appended the budget extension; swap in this result's own one.
    const stem = longestExtension === '' ? name : name.slice(0, name.length - longestExtension.length);
    return { from: clip.path, fileName: `${stem}${extensions[index] ?? ''}` };
  });
  return { plan };
}

function pathKey(path: string, caseInsensitive: boolean) {
  const normalized = normalizePath(path);
  return caseInsensitive ? normalized.toLowerCase() : normalized;
}

/**
A file name a move may use: not empty, not `.` / `..`, and no folder separator on either style.
`getPathFileName(name) === name` is the check Windows and POSIX both need.
*/
function isPlainFileName(name: string) {
  if (name.trim() === '' || name === '.' || name === '..') return false;
  if (name.includes('/') || name.includes('\\')) return false;
  return getPathFileName(name) === name;
}

/**
The file name a clip is renamed to, or `undefined` to keep the name it has.

The plan travels from the renderer through IPC, so it cannot be trusted blindly: a name is only
used when the clip really is a result inside this work area's `clips/` folder and the planned value
is a plain file name (no folder, no relative segments). Anything else keeps the original name
instead of turning a stale or hand-made plan into a move somewhere else.
*/
export function resolveCutRenameFileName({ plan, clipPath, clipsDir, caseInsensitive }: {
  plan: readonly CutRenamePlanEntry[] | undefined;
  clipPath: string;
  /** Only a result inside this folder may be renamed (and deleted) by a job. */
  clipsDir: string;
  caseInsensitive: boolean;
}): string | undefined {
  if (plan == null || plan.length === 0) return undefined;
  if (!isPathInside(clipPath, clipsDir, { caseInsensitive })) return undefined;

  const key = pathKey(clipPath, caseInsensitive);
  const entry = plan.find((candidate) => pathKey(candidate.from, caseInsensitive) === key);
  if (entry == null) return undefined;
  return isPlainFileName(entry.fileName) ? entry.fileName : undefined;
}
