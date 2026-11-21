import type { PatchFinishFlow } from './flow.js';
import { getFinishPresetChoices } from './flow.js';
import type {
  PatchFinishCutClipsChoice, PatchFinishCutOptions, PatchFinishMergedResultChoice, PatchFinishMergeClipsChoice, PatchFinishMergeOptions, PatchFinishMode,
} from './options.js';

/**
The workflows the finish dialog offers as a preset (pure).

The dialog never stores "which preset is active": the preset is derived from the options, so any
edit below the preset row falls back to `custom` by construction - there is no second source of
truth that could disagree with what the dialog shows.

Every preset ends up in one of two situations, for merge and cut jobs alike:

- `one-video`: this video is done, the next one follows. Everything leaves the work area: the
  source, the project file and the results are archived; the cut results are dropped.
- `archive`: the same as `one-video`, but the source is kept instead of parked for deletion: it
  moves to the finished folder (`finished_src_media`).
- `skip`: the same as `archive`, but the source goes to `finished_skip_src` instead: the user
  skipped this video (no cut or merge needed). It belongs to the `Shift+F` workflow and is not
  offered to `Shift+E` (see `flow.ts`), which ends a job the user did work on.
- `loop-video`: the same video is cut again afterwards. The video and its project file stay, so
  the cut list (and the `.llc` that stores it) can be reused; only the merge result is moved out
  of the way, so the next merge starts from a free slot. In the merge job the cut results stay in
  the work area as well (they are what the next pass builds on), while a cut-only job moves them
  out: it is the last step of that video.
*/
export type PatchFinishPresetId = 'one-video' | 'archive' | 'skip' | 'loop-video' | 'custom';

/** A preset that sets options (everything but `custom`). */
export type PatchFinishPresetChoice = Exclude<PatchFinishPresetId, 'custom'>;

/** The fields every preset sets, whatever the mode. */
interface PresetCommonFields {
  source: 'finished' | 'skip' | 'detached' | 'keep';
  projectFile: 'install-llc' | 'keep';
  next: 'next' | 'none';
  workDir: 'keep';
  /**
  What happens to results of earlier passes (fork-owned).

  The two ends of the workflow disagree on purpose: a job that leaves this video (`next: next`)
  clears the stale results, so the work area does not carry them into the next video; a job that
  keeps working on it (`next: none`) keeps them, so the next pass does not cut them again.
  */
  deleteStaleClips: boolean;
}

const mergePresetFields: Record<PatchFinishPresetChoice, PresetCommonFields & { merged: 'finished'; clips: PatchFinishMergeClipsChoice }> = {
  'one-video': { source: 'detached', projectFile: 'install-llc', merged: 'finished', clips: 'delete', next: 'next', workDir: 'keep', deleteStaleClips: true },
  archive: { source: 'finished', projectFile: 'install-llc', merged: 'finished', clips: 'delete', next: 'next', workDir: 'keep', deleteStaleClips: true },
  skip: { source: 'skip', projectFile: 'install-llc', merged: 'finished', clips: 'delete', next: 'next', workDir: 'keep', deleteStaleClips: true },
  // The video is worked on again: only the merged result leaves (it is a finished product), while
  // the source and the cut results stay usable for the next pass.
  'loop-video': { source: 'keep', projectFile: 'keep', merged: 'finished', clips: 'keep', next: 'none', workDir: 'keep', deleteStaleClips: false },
};

const cutPresetFields: Record<PatchFinishPresetChoice, PresetCommonFields & { clips: PatchFinishCutClipsChoice; mergedResult: PatchFinishMergedResultChoice }> = {
  'one-video': { source: 'detached', projectFile: 'install-llc', clips: 'finished', mergedResult: 'finished', next: 'next', workDir: 'keep', deleteStaleClips: true },
  archive: { source: 'finished', projectFile: 'install-llc', clips: 'finished', mergedResult: 'finished', next: 'next', workDir: 'keep', deleteStaleClips: true },
  skip: { source: 'skip', projectFile: 'install-llc', clips: 'finished', mergedResult: 'finished', next: 'next', workDir: 'keep', deleteStaleClips: true },
  'loop-video': { source: 'keep', projectFile: 'keep', clips: 'finished', mergedResult: 'finished', next: 'none', workDir: 'keep', deleteStaleClips: false },
};

/** The project destination the preset asks for, downgraded when the installation folder is read-only. */
function resolvePresetProjectFile(projectFile: PatchFinishMergeOptions['projectFile'], installLlcWritable: boolean) {
  if (projectFile === 'install-llc' && !installLlcWritable) return 'userdata-llc';
  return projectFile;
}

/**
The options a preset stands for.

Two safe downgrades keep a preset applicable when the dialog's own option is disabled:

- `mergedCoversClips`: deleting the cut results is only allowed when the merged result provably
  contains them, so a stale merge moves them to `detached_clips` instead of blocking the Execute
  button (a preset that keeps them needs no downgrade).
- `installLlcWritable`: the installation folder can be read-only (Program Files, a portable build
  on a locked share) and the dialog disables that destination; the preset then uses the app data
  folder, which is always writable.
- `mergedInsideWorkArea`: only a merged result inside this work area may be deleted, so the
  `mergedResult: 'delete'` choice becomes `keep` there. The presets move it to `finished_merged`,
  which works wherever the result lives.

The preset detection uses the same downgrades, so a preset stays selected when one of them
applies.
*/
export function resolvePresetOptions(params: { preset: PatchFinishPresetChoice; mode: 'merge'; options: PatchFinishMergeOptions; mergedCoversClips: boolean; installLlcWritable?: boolean; mergedInsideWorkArea?: boolean }): PatchFinishMergeOptions;
export function resolvePresetOptions(params: { preset: PatchFinishPresetChoice; mode: 'cut'; options: PatchFinishCutOptions; mergedCoversClips: boolean; installLlcWritable?: boolean; mergedInsideWorkArea?: boolean }): PatchFinishCutOptions;
export function resolvePresetOptions({ preset, mode, options, mergedCoversClips, installLlcWritable = true, mergedInsideWorkArea = true }: {
  preset: PatchFinishPresetChoice;
  mode: PatchFinishMode;
  options: PatchFinishMergeOptions | PatchFinishCutOptions;
  mergedCoversClips: boolean;
  /** Can the installation folder hold the project file? (`false` falls back to the app data folder) */
  installLlcWritable?: boolean;
  /** May this job delete a merged result? (`false` keeps it instead) */
  mergedInsideWorkArea?: boolean;
}): PatchFinishMergeOptions | PatchFinishCutOptions {
  if (mode === 'merge') {
    const fields = mergePresetFields[preset];
    return {
      ...(options as PatchFinishMergeOptions),
      source: fields.source,
      projectFile: resolvePresetProjectFile(fields.projectFile, installLlcWritable),
      // A folder picked for an earlier custom choice does not belong to the preset.
      projectDir: undefined,
      merged: fields.merged,
      // Deleting is only safe when the merged result provably contains the results; anything that
      // keeps them (`keep`, `detached`) needs no downgrade.
      clips: mergedCoversClips || fields.clips === 'keep' ? fields.clips : 'detached',
      deleteStaleClips: fields.deleteStaleClips,
      next: fields.next,
      workDir: fields.workDir,
    };
  }

  const fields = cutPresetFields[preset];
  return {
    ...(options as PatchFinishCutOptions),
    source: fields.source,
    projectFile: resolvePresetProjectFile(fields.projectFile, installLlcWritable),
    projectDir: undefined,
    clips: fields.clips,
    // Moving the merged result works wherever it lives; only an explicit delete needs the work area.
    mergedResult: fields.mergedResult === 'delete' && !mergedInsideWorkArea ? 'keep' : fields.mergedResult,
    deleteStaleClips: fields.deleteStaleClips,
    next: fields.next,
    workDir: fields.workDir,
  };
}

function matchesMerge(a: PatchFinishMergeOptions, b: PatchFinishMergeOptions) {
  return a.source === b.source
    && a.projectFile === b.projectFile
    && a.merged === b.merged
    && a.clips === b.clips
    && a.deleteStaleClips === b.deleteStaleClips
    && a.next === b.next
    && a.workDir === b.workDir;
}

function matchesCut(a: PatchFinishCutOptions, b: PatchFinishCutOptions) {
  return a.source === b.source
    && a.projectFile === b.projectFile
    && a.clips === b.clips
    && a.mergedResult === b.mergedResult
    && a.deleteStaleClips === b.deleteStaleClips
    && a.next === b.next
    && a.workDir === b.workDir;
}

/**
Which preset the current options are.

`custom` covers everything a preset does not describe: a hand-picked project folder, another date
grouping, a cleared work directory, and so on. The date grouping and the custom folder are left
out of the comparison on purpose - they are a user preference the presets do not express, so
keeping them must not knock the preset out.
*/
export function resolveFinishPreset({ mode, options, mergedCoversClips, installLlcWritable = true, mergedInsideWorkArea = true, flow = 'finish' }: {
  mode: PatchFinishMode;
  options: PatchFinishMergeOptions | PatchFinishCutOptions;
  mergedCoversClips: boolean;
  /** The same constraints the preset applies, so the downgraded options still match a preset. */
  installLlcWritable?: boolean;
  mergedInsideWorkArea?: boolean;
  /**
  Which entry point opened the dialog. `skip` belongs to `Shift+F`, so the `Shift+E` workflow never
  derives that preset - the dialog and the key that saved the options cannot disagree about it.
  */
  flow?: PatchFinishFlow;
}): PatchFinishPresetId {
  if (mode === 'merge') {
    const current = options as PatchFinishMergeOptions;
    for (const preset of getFinishPresetChoices(flow)) {
      const candidate = resolvePresetOptions({ preset, mode: 'merge', options: current, mergedCoversClips, installLlcWritable, mergedInsideWorkArea });
      if (matchesMerge(current, candidate)) return preset;
    }
    return 'custom';
  }

  const current = options as PatchFinishCutOptions;
  for (const preset of getFinishPresetChoices(flow)) {
    const candidate = resolvePresetOptions({ preset, mode: 'cut', options: current, mergedCoversClips, installLlcWritable, mergedInsideWorkArea });
    if (matchesCut(current, candidate)) return preset;
  }
  return 'custom';
}
