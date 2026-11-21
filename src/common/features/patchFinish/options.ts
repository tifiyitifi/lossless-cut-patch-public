/**
Finish-the-job choices (pure).

After a video has been cut (and maybe merged), the user ends the job: the source video, the merged
result and the cut results are moved out of the working area (or the cut results are deleted).
Every choice has a safe default; the dialog edits these objects and the settings store keeps the
last choice per mode.
*/

import { defaultCutLabelSeparator, defaultFinishCutRenameRule } from '../patchData/cutName.js';
import { labelSeparatorOptions } from '../patchData/mergedName.js';

/**
Which dialog the key opens.

`auto` is resolved by the window the key was pressed in (the merged window merges, the cut-results
window and the cutting window end with the cut results, see `resolveFinishWindowMode`); the preview
falls back to the source's merged result only for a request that still arrives as `auto`.
*/
export type PatchFinishMode = 'merge' | 'cut' | 'discard';
export type PatchFinishModeRequest = PatchFinishMode | 'auto';

/** What happens to the source video. */
export type PatchFinishSourceChoice = 'finished' | 'skip' | 'detached' | 'keep';

/** Where the merged result goes. */
export type PatchFinishMergedChoice = 'finished' | 'source' | 'source-rename';

/**
What happens to the cut results after a merge.

`keep` leaves them in the work area's `clips/`, still tracked by the export manifest: the job ends
(the merged result leaves) while the results stay usable for a later export or finish step - the
way a video is worked on in several passes (`loop-video`).
*/
export type PatchFinishMergeClipsChoice = 'delete' | 'detached' | 'keep';

/** What happens to the cut results when the job ends with the cut only. */
export type PatchFinishCutClipsChoice = 'finished' | 'source' | 'keep';

/**
What happens to a merged result found while ending a cut-only job (fork-owned).

`finished` moves it to `finished_merged`, the same place a merge job sends it: the cut results are
kept below, so the merged result is still an output of this source. `delete` is offered for a merge
that is no longer needed (only a result inside the work area may be deleted), and `keep` leaves it
where it is for the next pass.
*/
export type PatchFinishMergedResultChoice = 'finished' | 'delete' | 'keep';

/** Load the next source from the batch list, or keep the current source open. */
export type PatchFinishNextChoice = 'next' | 'none';

/**
What happens to `.losslesscut_work` itself after the job.

`clear` only moves an **empty** work area (whitelisted stage folders + the app's export manifest)
to the recycle bin; see `features/patchWork/emptyWorkDirs`. It is never persisted: every dialog
opens with `keep`, so a batch of jobs cannot repeat a destructive-looking choice by accident.
*/
export type PatchFinishWorkDirChoice = 'keep' | 'clear';

/**
Where the project file (`.llc`) goes.

This is independent of the source video: a job may keep the video and still archive its project
file. `follow` is the old `moveProjectFile: true` behaviour; `keep` is the old `false`.
*/
export type PatchFinishProjectChoice =
  /** Move with the source video (stays put when the video stays put). */
  | 'follow'
  /** Leave it where it is. */
  | 'keep'
  /** `<finished area>/finish_llc`, flat. */
  | 'finish-llc'
  /** `<userData>/llc/<date>`. */
  | 'userdata-llc'
  /** `<installation folder>/llc/<date>`. */
  | 'install-llc'
  /** A folder the user picked, optionally with `<date>` folders. */
  | 'custom';

/**
How the dated project stores name their folders (local time):
`2026-10` for `ym`, `2026-10/23` for `ymd`, the store folder itself for `none`.

One choice instead of a "split by date" switch plus a grouping, so a store can never be
"grouped" without knowing how. Ignored by `finish_llc`, which is always flat.
*/
export type PatchFinishDateGrouping = 'none' | 'ym' | 'ymd';

export interface PatchFinishMergeOptions {
  source: PatchFinishSourceChoice;
  projectFile: PatchFinishProjectChoice;
  /** Only used when `projectFile` is `custom`. */
  projectDir?: string | undefined;
  projectDateGrouping: PatchFinishDateGrouping;
  merged: PatchFinishMergedChoice;
  clips: PatchFinishMergeClipsChoice;
  /**
  Permanently delete the cut results that are **not** part of this export (fork-owned).

  A finish job only ends one export's work; results from earlier passes (a merge that kept its
  inputs, clips cut for a later merge) may stay in the work area to avoid cutting them again. When
  the video is done they are stale, and ending the job removes them. The presets decide the default
  from their own intent: ending the video (`next: next`) clears them, continuing (`next: none`)
  keeps them.
  */
  deleteStaleClips: boolean;
  next: PatchFinishNextChoice;
  /** Clear the (then empty) work directory after the job? Never persisted, always `keep` on open. */
  workDir: PatchFinishWorkDirChoice;
}

export interface PatchFinishCutOptions {
  source: PatchFinishSourceChoice;
  projectFile: PatchFinishProjectChoice;
  /** Only used when `projectFile` is `custom`. */
  projectDir?: string | undefined;
  projectDateGrouping: PatchFinishDateGrouping;
  clips: PatchFinishCutClipsChoice;
  /** Delete a merged result the source still has (it can be re-merged from the cut results). */
  mergedResult: PatchFinishMergedResultChoice;
  /**
  Permanently delete the cut results that are **not** part of this export (fork-owned).

  The cut-results window shows this export's clips; older results (a merge that kept its inputs, or
  clips cut earlier for a later merge) also sit in the work area. Keeping them avoids cutting them
  again while the video is still being worked on; ending the video clears them. The presets decide
  the default from their own intent: ending (`next: next`) deletes them, continuing (`next: none`)
  keeps them.
  */
  deleteStaleClips: boolean;
  next: PatchFinishNextChoice;
  /** Clear the (then empty) work directory after the job? Never persisted, always `keep` on open. */
  workDir: PatchFinishWorkDirChoice;
  /**
  Rename the cut results while they move (`features/patchData/cutName` rule).

  The export names a clip in the work area; this is the last point at which its final name can be
  chosen, which matters most when one clip is the whole result and nothing is merged. On by
  default: a cut-only job then ends with a readable name instead of the export's working title.
  */
  cutRename: PatchCutRenameOptions;
}

/** How the cut results are renamed when the job moves them (fork-owned). */
export interface PatchCutRenameOptions {
  enabled: boolean;
  /** A `{token}` rule (see `features/patchData/cutName`). */
  rule: string;
  /** Joins the labels in `{labels}`, the same separators the export rule offers. */
  labelSeparator: string;
}

/** What happens to the results of a video that is being discarded (`Ctrl+Delete`). */
export type PatchFinishDiscardResultsChoice = 'delete' | 'detached';

/**
The choices of the discard flow (fork-owned).

Discarding sets a source aside instead of finishing it: the video moves to
`detached_src_media` (kept, so it can be cut again) and the results it already has are either
deleted or moved to the `detached_*` folders. The project file follows the video, so the parked
source still opens with its segments.
*/
export interface PatchFinishDiscardOptions {
  /** The source always goes to the waiting-for-deletion folder. */
  source: 'detached';
  /** The project file travels with the source video. Fixed; the dialog does not edit it. */
  projectFile: 'follow';
  projectDateGrouping: PatchFinishDateGrouping;
  results: PatchFinishDiscardResultsChoice;
  next: PatchFinishNextChoice;
  /** Clear the (then empty) work directory after the job? Never persisted, always `keep` on open. */
  workDir: PatchFinishWorkDirChoice;
}

/** Any options object the finish executor understands. */
export type PatchFinishOptions = PatchFinishMergeOptions | PatchFinishCutOptions | PatchFinishDiscardOptions;

export const defaultPatchFinishMergeOptions: PatchFinishMergeOptions = {
  source: 'detached',
  projectFile: 'install-llc',
  projectDateGrouping: 'ym',
  merged: 'finished',
  clips: 'delete',
  deleteStaleClips: true,
  next: 'next',
  workDir: 'keep',
};

export const defaultPatchFinishCutOptions: PatchFinishCutOptions = {
  source: 'detached',
  projectFile: 'install-llc',
  projectDateGrouping: 'ym',
  clips: 'finished',
  mergedResult: 'finished',
  deleteStaleClips: true,
  next: 'next',
  workDir: 'keep',
  cutRename: {
    enabled: true,
    rule: defaultFinishCutRenameRule,
    labelSeparator: defaultCutLabelSeparator,
  },
};

export const defaultPatchFinishDiscardOptions: PatchFinishDiscardOptions = {
  source: 'detached',
  projectFile: 'follow',
  projectDateGrouping: 'ym',
  results: 'delete',
  next: 'next',
  workDir: 'keep',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : fallback;
}

const projectChoices: readonly PatchFinishProjectChoice[] = ['follow', 'keep', 'finish-llc', 'userdata-llc', 'install-llc', 'custom'];
const dateGroupings: readonly PatchFinishDateGrouping[] = ['none', 'ym', 'ymd'];

/**
Read the stored project-file choice, including the old `moveProjectFile` boolean (`true` meant
"follow", `false` meant "keep").
*/
function parseProjectChoice(value: Record<string, unknown>, fallback: PatchFinishProjectChoice): PatchFinishProjectChoice {
  if (typeof value['projectFile'] === 'string') {
    return oneOf(value['projectFile'], projectChoices, fallback);
  }
  if (typeof value['moveProjectFile'] === 'boolean') {
    return value['moveProjectFile'] ? 'follow' : 'keep';
  }
  return fallback;
}

function parseProjectDir(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
Read the stored date-folder choice, including the old `projectDateFolders` switch (`false` meant
a flat store, which is the `none` grouping now).
*/
function parseDateGrouping(value: Record<string, unknown>, fallback: PatchFinishDateGrouping): PatchFinishDateGrouping {
  if (value['projectDateFolders'] === false) return 'none';
  return oneOf(value['projectDateGrouping'], dateGroupings, fallback);
}

/**
Read the stale-result choice.

An options object stored before the field existed was written when the presets expressed the intent
through `next` alone. Read the same intent back from it - continuing keeps the old results, ending
clears them - so an old `loop-video` still reads as that preset instead of `custom`.
*/
function parseDeleteStaleClips(value: Record<string, unknown>, next: PatchFinishNextChoice, fallback: boolean): boolean {
  if (typeof value['deleteStaleClips'] === 'boolean') return value['deleteStaleClips'];
  return next === 'none' ? false : fallback;
}

/** Read the stored merge-mode options; anything malformed falls back to the default. */
export function parsePatchFinishMergeOptions(value: unknown): PatchFinishMergeOptions {
  if (!isRecord(value)) return { ...defaultPatchFinishMergeOptions };
  const next = oneOf(value['next'], ['next', 'none'], defaultPatchFinishMergeOptions.next);
  return {
    source: oneOf(value['source'], ['finished', 'skip', 'detached', 'keep'], defaultPatchFinishMergeOptions.source),
    projectFile: parseProjectChoice(value, defaultPatchFinishMergeOptions.projectFile),
    projectDir: parseProjectDir(value['projectDir']),
    projectDateGrouping: parseDateGrouping(value, defaultPatchFinishMergeOptions.projectDateGrouping),
    merged: oneOf(value['merged'], ['finished', 'source', 'source-rename'], defaultPatchFinishMergeOptions.merged),
    clips: oneOf(value['clips'], ['delete', 'detached', 'keep'], defaultPatchFinishMergeOptions.clips),
    deleteStaleClips: parseDeleteStaleClips(value, next, defaultPatchFinishMergeOptions.deleteStaleClips),
    next,
    workDir: oneOf(value['workDir'], ['keep', 'clear'], defaultPatchFinishMergeOptions.workDir),
  };
}

/**
Read the stored rename choice.

A value stored before the rename existed is missing entirely: the choice then defaults to enabled,
which is what a stored options object without the field meant at the time.
*/
function parseCutRenameOptions(value: unknown): PatchCutRenameOptions {
  const fallback = defaultPatchFinishCutOptions.cutRename;
  if (!isRecord(value)) return { ...fallback };
  return {
    enabled: typeof value['enabled'] === 'boolean' ? value['enabled'] : fallback.enabled,
    rule: typeof value['rule'] === 'string' && value['rule'].trim() !== '' ? value['rule'] : fallback.rule,
    labelSeparator: typeof value['labelSeparator'] === 'string' && (labelSeparatorOptions as readonly string[]).includes(value['labelSeparator'])
      ? value['labelSeparator']
      : fallback.labelSeparator,
  };
}

/** Read the stored cut-mode options; anything malformed falls back to the default. */
export function parsePatchFinishCutOptions(value: unknown): PatchFinishCutOptions {
  if (!isRecord(value)) return { ...defaultPatchFinishCutOptions };
  const next = oneOf(value['next'], ['next', 'none'], defaultPatchFinishCutOptions.next);
  return {
    source: oneOf(value['source'], ['finished', 'skip', 'detached', 'keep'], defaultPatchFinishCutOptions.source),
    projectFile: parseProjectChoice(value, defaultPatchFinishCutOptions.projectFile),
    projectDir: parseProjectDir(value['projectDir']),
    projectDateGrouping: parseDateGrouping(value, defaultPatchFinishCutOptions.projectDateGrouping),
    clips: oneOf(value['clips'], ['finished', 'source', 'keep'], defaultPatchFinishCutOptions.clips),
    mergedResult: oneOf(value['mergedResult'], ['finished', 'delete', 'keep'], defaultPatchFinishCutOptions.mergedResult),
    deleteStaleClips: parseDeleteStaleClips(value, next, defaultPatchFinishCutOptions.deleteStaleClips),
    next,
    workDir: oneOf(value['workDir'], ['keep', 'clear'], defaultPatchFinishCutOptions.workDir),
    cutRename: parseCutRenameOptions(value['cutRename']),
  };
}

/** Read the stored discard-mode options; anything malformed falls back to the default. */
export function parsePatchFinishDiscardOptions(value: unknown): PatchFinishDiscardOptions {
  if (!isRecord(value)) return { ...defaultPatchFinishDiscardOptions };
  return {
    source: 'detached',
    projectFile: 'follow',
    projectDateGrouping: parseDateGrouping(value, defaultPatchFinishDiscardOptions.projectDateGrouping),
    results: oneOf(value['results'], ['delete', 'detached'], defaultPatchFinishDiscardOptions.results),
    next: oneOf(value['next'], ['next', 'none'], defaultPatchFinishDiscardOptions.next),
    workDir: oneOf(value['workDir'], ['keep', 'clear'], defaultPatchFinishDiscardOptions.workDir),
  };
}

/**
The project-file choice a dialog opens with.

The default is the installation folder's store, but a packaged app may live in a read-only
directory (`Program Files`): opening with that choice would block the job, so it falls back to
the app data store, which is always writable. This is the same safe downgrade the presets apply
(see `presets.ts`), which keeps the dialog's default on the `one-video` preset instead of
reporting `custom` for options the preset itself produced.
*/
export function resolveProjectChoiceOnOpen({ choice, installLlcWritable }: {
  choice: PatchFinishProjectChoice;
  /** Can the app create the installation-folder store? (from the finish preview) */
  installLlcWritable: boolean;
}): PatchFinishProjectChoice {
  if (choice === 'install-llc' && !installLlcWritable) return 'userdata-llc';
  return choice;
}

/**
Apply `resolveProjectChoiceOnOpen` to the stored options (the other choices are kept as they are).

A folder picked for an earlier `custom` choice is dropped: the app data fallback is a different
destination, so a folder from another job is not silently reused.
*/
export function withProjectChoiceOnOpen<T extends { projectFile: PatchFinishProjectChoice, projectDir?: string | undefined }>(
  options: T,
  { installLlcWritable }: { installLlcWritable: boolean },
): T {
  const projectFile = resolveProjectChoiceOnOpen({ choice: options.projectFile, installLlcWritable });
  if (projectFile === options.projectFile) return options;
  return { ...options, projectFile, projectDir: undefined };
}
