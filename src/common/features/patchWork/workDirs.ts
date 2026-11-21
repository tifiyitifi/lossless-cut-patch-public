/**
Patch work area layout (pure).

The user picks one *working directory*; the app then keeps a work area of its own inside it,
mirroring the layout of the earlier PowerShell workflow (a root directory holding one directory
per workflow stage):

```
<working directory>\
  .losslesscut_work\      <- maintained by the app
    clips\                 <- cut results
      repairing_tmp\       <- temporary files of "Fix incorrect duration" / "Decimate video"
    merged\                <- merge results
  losslesscut_finished\  <- what a finish job moves out of the work area (created on demand)
```

The name follows the product name (`LosslessCut` is one word) and the lower-case snake case of
that earlier workflow. The leading dot keeps the app's *work area* out of the way in the video
directory (it sorts with the hidden/system entries instead of between the videos); the finished
folder keeps its plain name, because it is the folder the user browses for kept results.

Both names are *defaults*: the user can rename them in the working-directory settings
(`PatchSettings.workDirName` / `finishedDirName`). Only the configured names are created; the
defaults keep being recognized as work / finished areas, so renaming never exposes an existing
work area to cutting (see `dirNames.ts`).

Only the names live here: the paths are joined with the platform separator by the process that
owns them (`main/features/patchWork` and the renderer), because shared code must not depend on
node APIs.
*/
export const defaultPatchWorkDirName = '.losslesscut_work';

/**
The lock file a job takes while it writes into the work area (fork-owned).

It lives here because two processes have to agree on it: the lock itself
(`main/features/patchWork/exportLock`) and the cleanup decision, which must know that a lock file
is the app's own file and not something the user left in the folder.
*/
export const patchWorkLockFileName = '.export.lock';

/** Sub directories of the work area. */
export const patchWorkSubdirs = {
  /** Cut results (one file per exported segment). */
  clips: 'clips',
  /** Merge results. */
  merged: 'merged',
} as const;

/**
A folder inside `clips/` for the temporary files of "Fix incorrect duration" and
"Decimate video" (fork-owned).

Both tools reload their result as the new working file. In patch mode the output directory is
`clips/`, so without a folder of their own those files sit next to the cut results and look like
results - a `-reformatted` file has already been mistaken for a failed export. The name says what
they are: temporary files of a repair, never a result.
*/
export const patchRepairTmpDirName = 'repairing_tmp';

/**
The name of a temporary repair output inside the export directory (`repairing_tmp/<fileName>`).

`/` separated; the renderer's `getOutPath` joins it with the platform separator.
*/
export function getPatchRepairTmpFileName(fileName: string): string {
  return `${patchRepairTmpDirName}/${fileName}`;
}

/**
The default name of the directory the finish flow moves everything the user keeps into
(fork-owned).

It is a sibling of the work area, not part of it: `.losslesscut_work` only holds what the app is
still working on, so the results that are done leave the work area - and with it the work-area
cleanup (see `emptyWorkDirs`), which may only ever trash an empty work area.
*/
export const defaultPatchFinishedDirName = 'losslesscut_finished';

/**
The names of the two app-owned folders, as configured by the user.

The defaults are the names every build before the setting existed used, so an old work area keeps
working. `finishedDir` is a *sibling* of `workDir`, never inside it.
*/
export interface PatchDirNames {
  /** The work area inside the working directory (`<workRoot>/<workDir>`). */
  workDir: string;
  /** The folder a finish job moves kept files into (`<workRoot>/<finishedDir>`). */
  finishedDir: string;
}

/** The names used when the user has not configured any (also the fallback for a bad setting). */
export const defaultPatchDirNames: PatchDirNames = {
  workDir: defaultPatchWorkDirName,
  finishedDir: defaultPatchFinishedDirName,
};

/**
What a finish job moves into `losslesscut_finished` (fork-owned).

The folders are created on demand (never eagerly): a job that keeps every file leaves no empty
folders behind. Everything here is what the user keeps, so it leaves the work area.
*/
export const patchFinishedSubdirs = {
  /** Source videos whose job is done and that the user keeps for now. */
  finishedSrcMedia: 'finished_src_media',
  /**
  Source videos the user skipped: they need no cut or merge, so `Shift+F` moves them here
  (fork-owned). A separate folder, not `finished_src_media`: a source that was processed and then
  kept is not the same as one that was never processed, and the results overview shows the two.
  */
  finishedSkipSrc: 'finished_skip_src',
  /** Merged results whose job is done. */
  finishedMerged: 'finished_merged',
  /** Cut results whose job is done (cut-only mode). */
  finishedClips: 'finished_clips',
  /** Archived project files (`.llc`) that the user keeps flat, without dated folders. */
  finishLlc: 'finish_llc',
} as const;

/**
What a finish job parks inside the work area (fork-owned).

These are the files the user decided to delete, and the app does not delete them on its own: they
stay next to the work they belong to until the user deletes them (the deletion check deletes a
parked source whose kept result is on disk) or removes them by hand.
*/
export const patchDetachedSubdirs = {
  /** Source videos the user decided to get rid of. */
  detachedSrcMedia: 'detached_src_media',
  /** Cut results the user decided to get rid of. */
  detachedClips: 'detached_clips',
  /** Merged results the user decided to get rid of. */
  detachedMerged: 'detached_merged',
} as const;

/**
Every stage folder a finish job may leave inside the work area.

The `finished_*` names are still listed: earlier versions kept them inside `losslesscut_work`, and
the leftovers of a job that ran before the move must not make an old work area uncleanable (a
folder that still holds anything blocks the cleanup either way). The same list is what a hand-made
folder inside today's `.losslesscut_work` may still carry.
*/
export const patchFinishSubdirNames: readonly string[] = [
  ...Object.values(patchFinishedSubdirs),
  ...Object.values(patchDetachedSubdirs),
];

export type PatchFinishSubdirKind = keyof typeof patchFinishedSubdirs | keyof typeof patchDetachedSubdirs;

/** The work area directories, relative to the working directory. */
export interface PatchWorkDirNames {
  workDir: string;
  clipsDir: string;
  mergedDir: string;
}

/** The work area directories (absolute paths). */
export interface PatchWorkDirs {
  /** The work area itself. */
  workDir: string;
  /** Where the cut results are written. */
  clipsDir: string;
  /** Where the merge results are written. */
  mergedDir: string;
}

/**
The directories of the work area, relative to the working directory.

The parts are separated by `/`, which every platform accepts and which `path.join` normalizes
to the platform separator.
*/
export function getPatchWorkDirNames(dirNames: PatchDirNames = defaultPatchDirNames): PatchWorkDirNames {
  return {
    workDir: dirNames.workDir,
    clipsDir: `${dirNames.workDir}/${patchWorkSubdirs.clips}`,
    mergedDir: `${dirNames.workDir}/${patchWorkSubdirs.merged}`,
  };
}

/**
The root the work area is created in.

The working directory is optional: without one, patch mode keeps its work area next to the
source file instead of writing the results into the source folder itself (that is what base mode
does). `undefined` when neither is known, so callers keep the upstream behaviour.
*/
export function resolvePatchWorkRoot({ workRoot, sourceDir }: {
  workRoot: string | undefined;
  sourceDir: string | undefined;
}): string | undefined {
  const trimmedWorkRoot = workRoot?.trim();
  if (trimmedWorkRoot != null && trimmedWorkRoot !== '') return trimmedWorkRoot;

  const trimmedSourceDir = sourceDir?.trim();
  if (trimmedSourceDir != null && trimmedSourceDir !== '') return trimmedSourceDir;

  return undefined;
}
