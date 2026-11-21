import type { PatchFinishCutOptions, PatchFinishDiscardOptions, PatchFinishMergeOptions, PatchFinishMode, PatchFinishModeRequest, PatchFinishOptions } from './options.js';
import type { PatchFinishPreview } from './preview.js';
import { splitClipsByExportSelection } from './unselected.js';

/**
How the finish job is carried out (pure).

The dialog's choices become an ordered list of steps. The order matters: the source video moves
first, because the "rename the merged result to the source name" choice needs its name free. The
main process turns each step into file operations (`main/features/patchFinish`).

The discard flow (`Ctrl+Delete`) is the exception: its results are handled *before* the source moves, so
a result that cannot be deleted or moved leaves the source in place for a retry.
*/

export type PatchFinishSourceStep = 'finished' | 'skip' | 'detached' | 'keep';

export type PatchFinishStep = | { kind: 'move-source'; target: 'finished' | 'skip' | 'detached' }
  | { kind: 'move-merged'; target: 'finished' | 'source' | 'source-rename' | 'detached' }
  | { kind: 'delete-merged' }
  /** `clipPaths` limits the step to this export's results; omitted it means every result (discard). */
  | { kind: 'move-clips'; target: 'detached' | 'finished' | 'source'; clipPaths?: string[] }
  /** Deletes this export's results (needs the merged-coverage proof, or a discard). */
  | { kind: 'delete-clips'; clipPaths?: string[] }
  /**
  Deletes the results of earlier passes that this export did not produce (fork-owned).

  Unlike `delete-clips` it needs no merged-coverage proof: these files are not the input of the
  merge this job ends; their own output already left earlier.
  */
  | { kind: 'delete-stale-clips'; clipPaths: string[] }
  /** Move the project file to an explicit store (`finish_llc`, userData, installation folder, custom). */
  | { kind: 'move-project' };

export type PatchFinishOptionProblem =
  /** The source file does not exist (any more). */
  | 'source-missing'
  /** The source file exists but cannot be read (permissions, a lock). */
  | 'source-unreadable'
  /** The source video is inside a `.losslesscut_work` directory: move it out first. */
  | 'source-inside-work-area'
  /** "Move the project file to another folder" was chosen, but no folder was picked. */
  | 'project-dir-missing'
  /** The project file cannot be stored in the installation folder. */
  | 'project-dir-unwritable'
  /** A merge-only choice was made but there is no merged result. */
  | 'merged-required'
  /** "Delete the cut results" was chosen, but the merged result does not cover them. */
  | 'clips-delete-unsafe'
  /**
  The manifest tracks a cut result that is gone from its recorded path while other results are
  still there: finishing could silently lose its record (a previous attempt may have moved it).
  */
  | 'clips-missing'
  /**
  Another window is playing a cut result (or the merged result) this job would move or delete.
  The player holds the file open, so the move fails on Windows; on any system it would pull the
  file out of a running player. The user stops the playback and runs the job again.
  */
  | 'files-in-use'
  /** The work directory cannot be cleared because it holds something outside the whitelist. */
  | 'work-dir-not-clearable'
  /** The rename rule cannot name the cut results (empty, a separator, a too long path, an empty name). */
  | 'cut-rename-invalid'
  /** Every choice leaves every file where it is. */
  | 'nothing-to-do';

/**
Resolve `auto` from what the source file has: a merged result means the merge job, else the cut job.

This is the preview's fallback for a request that still arrives as `auto` (an older build, the
HTTP API). Every window of this build resolves `auto` itself, from the window the key was pressed
in (`resolveFinishWindowMode`).
*/
export function resolveFinishMode(requested: PatchFinishMode | 'auto', { hasMerged }: { hasMerged: boolean }): PatchFinishMode {
  if (requested === 'auto') return hasMerged ? 'merge' : 'cut';
  return requested;
}

/** The window the finish key was pressed in (fork-owned). */
export type PatchFinishWindowKind = 'cutting' | 'cut-results' | 'merged';

/**
Which window a renderer instance is (fork-owned).

The merged-result window plays one file (`playerMode` plus `mergedMode`), the cut-results window is
a player that is not the merged one, and everything else is the cutting window. The check player is
a player as well: it ends a job like the cut-results window it belongs to.
*/
export function resolveFinishWindowKind({ playerMode, mergedMode }: { playerMode: boolean, mergedMode: boolean }): PatchFinishWindowKind {
  if (mergedMode) return 'merged';
  return playerMode ? 'cut-results' : 'cutting';
}

/**
Resolve `auto` from the window the key was pressed in (fork-owned).

`Shift+E` ends the job the way the window shows it: the cutting window and the cut-results window
end with the cut results (the merge is its own step, `zm`), and the merged-result window ends with
the merge. Resolving `auto` from the source's merged result instead made the cut-results window end
with a merge the user never asked for, and the cutting window ask for a merge just because one
existed.

An explicit request (`zm` / `zc`, the discard flow) is kept as pressed, whatever the window.
*/
export function resolveFinishWindowMode(requested: PatchFinishModeRequest, { windowKind }: { windowKind: PatchFinishWindowKind }): PatchFinishMode {
  if (requested !== 'auto') return requested;
  return windowKind === 'merged' ? 'merge' : 'cut';
}

/**
The source choice in effect.

"Rename the merged result to the source name" needs the source name and the source folder, so the
source video always moves to `finished_src_media` in that case (whatever the source radio says).
The discard flow always parks the source in `detached_src_media`.
*/
export function resolveSourceChoice(mode: PatchFinishMode, options: PatchFinishMergeOptions | PatchFinishCutOptions | PatchFinishDiscardOptions): PatchFinishSourceStep {
  if (mode === 'discard') return 'detached';
  if (mode === 'merge' && (options as PatchFinishMergeOptions).merged === 'source-rename') return 'finished';
  return options.source;
}

/** Does the job delete anything permanently? */
export function isPermanentDelete(mode: PatchFinishMode, options: PatchFinishMergeOptions | PatchFinishCutOptions | PatchFinishDiscardOptions) {
  if (mode === 'discard') return (options as PatchFinishDiscardOptions).results === 'delete';
  if (mode === 'merge') return (options as PatchFinishMergeOptions).clips === 'delete';
  return (options as PatchFinishCutOptions).mergedResult === 'delete';
}

/**
Do the cut results stay where they are? (fork-owned)

A `keep` job leaves the files in `clips/` and only ends the job: the export manifest has to keep
tracking them, so the next export can reuse them and a later finish step can handle them.

The discard flow never keeps them - it deletes or parks every result before it parks the source -,
so this is `false` there whatever the stored choice was.
*/
export function keepsCutResults(mode: PatchFinishMode, options: PatchFinishMergeOptions | PatchFinishCutOptions | PatchFinishDiscardOptions) {
  if (mode === 'discard') return false;
  return (options as PatchFinishMergeOptions | PatchFinishCutOptions).clips === 'keep';
}

/** Does the job permanently delete the results earlier passes left in the work area? (fork-owned) */
export function deletesStaleClips(mode: PatchFinishMode, options: PatchFinishMergeOptions | PatchFinishCutOptions | PatchFinishDiscardOptions) {
  if (mode === 'discard') return false;
  return (options as PatchFinishMergeOptions | PatchFinishCutOptions).deleteStaleClips;
}

/**
Does the job leave any cut result in the work area? (fork-owned)

Either it keeps this export's results (`clips: keep`) for the next pass, or it keeps the stale results
of earlier passes because the video is still being worked on. Only then does the manifest record have
to survive (and be pruned); otherwise every tracked result left, and the record is forgotten.
*/
export function leavesCutResultsInWorkArea({ mode, options, preview }: {
  mode: PatchFinishMode;
  options: PatchFinishMergeOptions | PatchFinishCutOptions | PatchFinishDiscardOptions;
  preview: Pick<PatchFinishPreview, 'clips' | 'selectedSegIds'>;
}): boolean {
  if (mode === 'discard') return false;
  if (keepsCutResults(mode, options)) return true;
  if (deletesStaleClips(mode, options)) return false;
  return splitClipsByExportSelection(preview.clips, preview.selectedSegIds).stale.length > 0;
}

/** How many cut results the job leaves in the work area (the finish summary reports it). */
export function countCutResultsLeftInWorkArea({ mode, options, preview }: {
  mode: PatchFinishMode;
  options: PatchFinishMergeOptions | PatchFinishCutOptions | PatchFinishDiscardOptions;
  preview: Pick<PatchFinishPreview, 'clips' | 'selectedSegIds'>;
}): number {
  if (mode === 'discard') return 0;
  const split = splitClipsByExportSelection(preview.clips, preview.selectedSegIds);
  return (keepsCutResults(mode, options) ? split.selected.length : 0)
    + (deletesStaleClips(mode, options) ? 0 : split.stale.length);
}

/**
The files the chosen options actually move or delete.

`preview.filesInUse` is about the job's files as a whole; only the ones these options touch block
it. A result another window plays may stay in the work area while the job runs (every clip choice
moves them, so in practice it blocks - but the merged result is only touched when the job really
takes it: merge mode always moves it, cut mode moves it by default and only deletes or leaves it
when asked).
*/
export function getFinishTouchedPaths({ mode, options, preview }: {
  mode: PatchFinishMode;
  options: PatchFinishMergeOptions | PatchFinishCutOptions | PatchFinishDiscardOptions;
  preview: Pick<PatchFinishPreview, 'clips' | 'selectedSegIds' | 'merged' | 'mergedInsideWorkArea'>;
}): string[] {
  // `keep` leaves this export's results alone: another window may play one without this job touching
  // it. The discard flow settles every result, whatever the stored choice says.
  const split = splitClipsByExportSelection(preview.clips, preview.selectedSegIds);
  const paths: string[] = [];
  if (mode === 'discard') {
    paths.push(...preview.clips.map((clip) => clip.path));
  } else {
    if (!keepsCutResults(mode, options)) paths.push(...split.selected.map((clip) => clip.path));
    if (deletesStaleClips(mode, options)) paths.push(...split.stale.map((clip) => clip.path));
  }
  if (preview.merged != null) {
    if (mode === 'discard') {
      // Deleting only ever touches a merged result of this work area; moving one takes it from
      // wherever the manifest says it is.
      if ((options as PatchFinishDiscardOptions).results === 'detached' || preview.mergedInsideWorkArea) paths.push(preview.merged.path);
    } else if (mode === 'merge') {
      paths.push(preview.merged.path);
    } else {
      const { mergedResult } = options as PatchFinishCutOptions;
      // A moved result is touched wherever it lives; only a delete needs it inside the work area.
      if (mergedResult === 'finished' || (mergedResult === 'delete' && preview.mergedInsideWorkArea)) paths.push(preview.merged.path);
    }
  }
  return paths;
}

/**
Does the job archive the project file into one of the explicit stores?

`follow` travels with the source step (it needs the video's final name), so it never gets a
project step of its own.
*/
export function movesProjectToStore(options: PatchFinishOptions) {
  return options.projectFile !== 'follow' && options.projectFile !== 'keep';
}

/** The ordered steps of the job. */
export function buildFinishSteps({ mode, options, preview }: {
  mode: PatchFinishMode;
  options: PatchFinishOptions;
  preview: Pick<PatchFinishPreview, 'merged' | 'mergedInsideWorkArea' | 'clips' | 'selectedSegIds' | 'mergedCoversClips' | 'projectFile'>;
}): PatchFinishStep[] {
  const steps: PatchFinishStep[] = [];

  // Discard: settle the results first, then park the source. A result that cannot be deleted or
  // moved stops the job while the source is still where it was, so nothing is lost and a retry can
  // work from the same paths.
  if (mode === 'discard') {
    const discardOptions = options as PatchFinishDiscardOptions;
    if (discardOptions.results === 'delete') {
      if (preview.clips.length > 0) steps.push({ kind: 'delete-clips' });
      // The executor only deletes a merged result inside `merged/`; one that lives elsewhere is
      // reported and left alone (it cannot belong to this work area's results).
      if (preview.merged != null) steps.push({ kind: 'delete-merged' });
    } else {
      if (preview.clips.length > 0) steps.push({ kind: 'move-clips', target: 'detached' });
      if (preview.merged != null) steps.push({ kind: 'move-merged', target: 'detached' });
    }
    steps.push({ kind: 'move-source', target: 'detached' });
    return steps;
  }

  const sourceChoice = resolveSourceChoice(mode, options);
  if (sourceChoice !== 'keep') steps.push({ kind: 'move-source', target: sourceChoice });
  if (preview.projectFile != null && movesProjectToStore(options)) steps.push({ kind: 'move-project' });

  // This export's results and the ones earlier passes left (see `splitClipsByExportSelection`).
  const { selected, stale } = splitClipsByExportSelection(preview.clips, preview.selectedSegIds);
  // Only spell out the paths when the step is a subset of every tracked result: the common case
  // (everything belongs to this export) keeps the step as it was.
  const subsetPaths = (clips: typeof selected) => (clips.length === preview.clips.length ? {} : { clipPaths: clips.map((clip) => clip.path) });

  if (mode === 'merge') {
    const mergeOptions = options as PatchFinishMergeOptions;
    if (preview.merged != null) steps.push({ kind: 'move-merged', target: mergeOptions.merged });
    if (selected.length > 0) {
      // The merged result has to cover the cut results before they may be deleted; the executor
      // re-checks this too and moves them to `detached_clips` instead when it cannot prove it.
      if (mergeOptions.clips === 'delete' && preview.mergedCoversClips) steps.push({ kind: 'delete-clips', ...subsetPaths(selected) });
      // `keep` leaves them in `clips/` for a later pass; the manifest keeps tracking them.
      else if (mergeOptions.clips !== 'keep') steps.push({ kind: 'move-clips', target: 'detached', ...subsetPaths(selected) });
    }
    if (mergeOptions.deleteStaleClips && stale.length > 0) steps.push({ kind: 'delete-stale-clips', clipPaths: stale.map((clip) => clip.path) });
    return steps;
  }

  const cutOptions = options as PatchFinishCutOptions;
  if (preview.merged != null) {
    // The cut job keeps the merged result as an output: it moves to `finished_merged` by default,
    // and only an explicit delete (inside the work area) removes it.
    if (cutOptions.mergedResult === 'finished') steps.push({ kind: 'move-merged', target: 'finished' });
    else if (cutOptions.mergedResult === 'delete' && preview.mergedInsideWorkArea) steps.push({ kind: 'delete-merged' });
  }
  if (cutOptions.clips !== 'keep' && selected.length > 0) steps.push({ kind: 'move-clips', target: cutOptions.clips, ...subsetPaths(selected) });
  if (cutOptions.deleteStaleClips && stale.length > 0) steps.push({ kind: 'delete-stale-clips', clipPaths: stale.map((clip) => clip.path) });
  return steps;
}

/** Everything that makes the chosen options unusable (the dialog disables Execute while non-empty). */
export function getFinishOptionProblems({ mode, options, preview, workDirClearable, cutRenameBlocked }: {
  mode: PatchFinishMode;
  options: PatchFinishOptions;
  preview: PatchFinishPreview;
  /** The finish dialog's predicted whitelist result; omitted by callers that do not offer the choice. */
  workDirClearable?: boolean | undefined;
  /**
  Set when the cut results' rename rule cannot name them. The dialog has the rule and its reason
  (`planCutRename`), so it only tells this function whether the job is blocked - the wording of the
  cause stays in the renderer.
  */
  cutRenameBlocked?: boolean | undefined;
}): PatchFinishOptionProblem[] {
  const problems: PatchFinishOptionProblem[] = [];
  if (!preview.source.exists) problems.push(preview.source.unreadable ? 'source-unreadable' : 'source-missing');
  if (preview.source.insideWorkArea) problems.push('source-inside-work-area');
  if (preview.projectFile != null && options.projectFile === 'custom' && (options.projectDir?.trim() ?? '') === '') problems.push('project-dir-missing');
  if (preview.projectFile != null && options.projectFile === 'install-llc' && !preview.projectStores.installLlcWritable) problems.push('project-dir-unwritable');
  if (mode === 'merge' && preview.merged == null) problems.push('merged-required');
  if (mode === 'merge' && (options as PatchFinishMergeOptions).clips === 'delete' && !preview.mergedCoversClips) problems.push('clips-delete-unsafe');
  // A result the manifest tracks but that is gone from its recorded path may be one a previous
  // attempt already moved. With no other result to move there is nothing to lose (the job only
  // writes the merged result then), but with results left the job would write a project file that
  // silently drops the missing one's record - so it stays blocked. Only a missing result of *this*
  // export can lose a record: a result of an earlier pass is never moved by this job.
  if (preview.missingSelectedClipCount > 0 && preview.clips.length > 0) problems.push('clips-missing');
  // Another window plays a file this job would move or delete. Blocked instead of attempted: the
  // player holds the file open, and the job would fail on Windows with an error that hides the cause.
  if (preview.filesInUse.length > 0) {
    const touched = new Set(getFinishTouchedPaths({ mode, options, preview }));
    if (preview.filesInUse.some((path) => touched.has(path))) problems.push('files-in-use');
  }
  if (options.workDir === 'clear' && workDirClearable === false) problems.push('work-dir-not-clearable');
  // Renaming is part of the job, so a rule that cannot name the results blocks it: the user either
  // fixes the rule or turns the rename off (the reason is shown next to the rule itself).
  if (mode === 'cut' && cutRenameBlocked === true) problems.push('cut-rename-invalid');
  if (buildFinishSteps({ mode, options, preview }).length === 0) problems.push('nothing-to-do');
  return problems;
}

/** How many files the job deletes permanently. */
export function getPermanentDeleteCount({ mode, options, preview }: {
  mode: PatchFinishMode;
  options: PatchFinishOptions;
  preview: PatchFinishPreview;
}) {
  const split = splitClipsByExportSelection(preview.clips, preview.selectedSegIds);
  if (mode === 'discard') {
    if ((options as PatchFinishDiscardOptions).results !== 'delete') return 0;
    return preview.clips.length + (preview.merged != null && preview.mergedInsideWorkArea ? 1 : 0);
  }
  const staleCount = deletesStaleClips(mode, options) ? split.stale.length : 0;
  // The merge branch must ask the same question as `buildFinishSteps`: a stale merged result cannot
  // cover the cut results, so they are moved aside instead of being deleted.
  if (mode === 'merge') return ((options as PatchFinishMergeOptions).clips === 'delete' && preview.mergedCoversClips ? split.selected.length : 0) + staleCount;
  return ((options as PatchFinishCutOptions).mergedResult === 'delete' && preview.merged != null && preview.mergedInsideWorkArea ? 1 : 0) + staleCount;
}

/**
How many bytes the job frees permanently (fork-owned).

It answers the same question as `getPermanentDeleteCount`, so the confirmation's "about {{size}}"
never counts a file the job leaves on disk. In particular a merged result outside the work area is
not deleted (only reported), and a stale merge cannot cover the cut results, so neither frees space.
*/
export function getPermanentDeleteSize({ mode, options, preview }: {
  mode: PatchFinishMode;
  options: PatchFinishOptions;
  preview: PatchFinishPreview;
}) {
  const split = splitClipsByExportSelection(preview.clips, preview.selectedSegIds);
  const staleSize = deletesStaleClips(mode, options) ? split.stale.reduce((total, clip) => total + clip.size, 0) : 0;
  if (mode === 'discard') {
    if ((options as PatchFinishDiscardOptions).results !== 'delete') return 0;
    return preview.clipsTotalSize + (preview.merged != null && preview.mergedInsideWorkArea ? preview.merged.size : 0);
  }
  const selectedSize = split.selected.reduce((total, clip) => total + clip.size, 0);
  if (mode === 'merge') return ((options as PatchFinishMergeOptions).clips === 'delete' && preview.mergedCoversClips ? selectedSize : 0) + staleSize;
  return ((options as PatchFinishCutOptions).mergedResult === 'delete' && preview.merged != null && preview.mergedInsideWorkArea ? preview.merged.size : 0) + staleSize;
}
