import type { PatchFinishFlow } from './flow.js';
import { getPathFileName, isSamePath } from './paths.js';

/*
The final paths a finish job left on disk, prepared for the summary dialog (fork-owned, pure).

The job knows the real names: a target already taken got its ` (n)` suffix while moving, so the
renderer must not re-derive them from the preview. `PatchFinishReport.results` carries the kept
results and `newSourcePath` the source, and this module turns them into what the summary shows and
what its "open and select" button targets.

A long job must not push the dialog off the screen, so the list is capped the way the reference
project caps its own location list (`common/delete_warning.cpp`): the first few lines, then a count.
The main artifact keeps its place: merged results come before cut results, and in the skip workflow
(`Shift+F` the source is the deliverable) the source comes first.
*/

export const defaultSummaryPathLimit = 5;

export type PatchFinishSummaryPathKind = 'clip' | 'merged' | 'source';

export interface PatchFinishSummaryPath {
  path: string;
  kind: PatchFinishSummaryPathKind;
}

export interface PatchFinishSummaryPaths {
  /** The paths to show, in display order. */
  shown: PatchFinishSummaryPath[];
  /** How many paths the cap left out (0 when everything fits). */
  hidden: number;
  /**
  The file an "open and select it" button should select.

  The skip workflow selects the source video (that is what it put away); the finish workflow selects
  the main result, or the only clip. `undefined` when the job left nothing that still exists as a
  named result - the caller then offers no button instead of a dead one.
  */
  revealTarget: PatchFinishSummaryPath | undefined;
}

export function listSummaryPaths({
  results, newSourcePath, flow, limit = defaultSummaryPathLimit, caseInsensitive,
}: {
  results: readonly { path: string, kind: 'clip' | 'merged' }[];
  newSourcePath: string | undefined;
  flow: PatchFinishFlow;
  limit?: number;
  /** Does the file system ignore case? (the same answer the rest of the finish code uses) */
  caseInsensitive: boolean;
}): PatchFinishSummaryPaths {
  const entries: PatchFinishSummaryPath[] = [];
  const add = (entry: PatchFinishSummaryPath) => {
    if (entry.path === '') return;
    if (entries.some((existing) => isSamePath(existing.path, entry.path, { caseInsensitive }))) return;
    entries.push(entry);
  };

  // Merged results first, so the cap can never hide the main artifact behind a row of clips. (The job
  // moves the merged result and the clips in separate steps; the report order is not the display
  // order.)
  for (const result of results) if (result.kind === 'merged') add({ path: result.path, kind: 'merged' });
  for (const result of results) if (result.kind === 'clip') add({ path: result.path, kind: 'clip' });
  if (newSourcePath != null) add({ path: newSourcePath, kind: 'source' });

  const ordered = flow === 'keepSource'
    ? [...entries.filter((entry) => entry.kind === 'source'), ...entries.filter((entry) => entry.kind !== 'source')]
    : entries;

  const shown = ordered.slice(0, Math.max(0, limit));
  const hidden = ordered.length - shown.length;
  const revealTarget = flow === 'keepSource'
    ? (shown.find((entry) => entry.kind === 'source') ?? shown[0])
    : (shown.find((entry) => entry.kind === 'merged') ?? shown[0]);

  return { shown, hidden, revealTarget };
}

/**
Join a folder and a file name for display, keeping the folder's own separator.

`joinPaths` exists for paths the app compares or writes; it unifies the separators, which is right
there and wrong here: the dialog shows the paths the user will see in the file manager, so a Windows
folder keeps its backslashes.
*/
export function joinDisplayPath(dir: string, fileName: string) {
  if (dir === '') return fileName;
  const separator = dir.includes('\\') ? '\\' : '/';
  return /[\\/]$/.test(dir) ? `${dir}${fileName}` : `${dir}${separator}${fileName}`;
}

/**
The full paths of the cut results a finish job is about to move, for the dialog's preview.

The names come from the rename plan when the job renames them, and from the files themselves when it
does not; the folder is the one the chosen option moves them to. `dir` is `undefined` when the job
deletes them instead of moving them - a deleted result has no path to show.
*/
export function listPreviewResultPaths({
  clips, dir, plan, caseInsensitive,
}: {
  clips: readonly { path: string }[];
  dir: string | undefined;
  plan: readonly { from: string, fileName: string }[];
  caseInsensitive: boolean;
}): string[] {
  if (dir == null) return [];
  return clips.map((clip) => {
    const planned = plan.find((entry) => isSamePath(entry.from, clip.path, { caseInsensitive }));
    return joinDisplayPath(dir, planned?.fileName ?? getPathFileName(clip.path));
  });
}
