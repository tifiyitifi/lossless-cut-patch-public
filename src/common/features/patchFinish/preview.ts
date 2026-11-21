import type { PatchFinishMode, PatchFinishModeRequest } from './options.js';
import type { CutRenamePlanEntry } from './cutRename.js';
import type { PatchWorkDirEntry } from '../patchWork/index.js';

/**
What the finish dialog shows and what the job reports back (pure types).

The preview is built by the main process (it reads the export manifest and the file system); the
renderer only renders it and passes the chosen options back. Warning *codes* travel over IPC, so
every user-visible text stays in the renderer's i18n.
*/

export type PatchFinishWarning =
  /** The manifest does not track this source, so the merged result / cut results are unknown. */
  | 'no-record'
  /** The source file is gone (moved by hand). */
  | 'source-missing'
  /** The source video is there but cannot be read (permissions, a lock): it is not "missing". */
  | 'source-unreadable'
  /** The source video sits inside a `.losslesscut_work` directory. */
  | 'source-inside-work-area'
  /** The manifest knows a merged result, but the file is gone. */
  | 'merged-missing'
  /** The merged result cannot be read (permissions, a lock). */
  | 'merged-unreadable'
  /** A cut result is newer than the merged result: deleting the cuts would lose content. */
  | 'merged-stale'
  /** Manifest records outside the work area (never touched by this job). */
  | 'clips-outside-work-area'
  /** Some cut results could not be read; they are left out of this job. */
  | 'clips-unreadable'
  /**
  The manifest tracks a cut result, but the file is gone from its recorded path. The job cannot
  tell a result the user deleted from one a previous attempt already moved, so finishing would
  write a project file that silently loses its record.
  */
  | 'clips-missing'
  /** The merged result is outside `merged/`: it may be moved, but only that folder may be deleted into. */
  | 'merged-outside-work-area'
  /** The job could not move the project file (`.llc`). */
  | 'project-move-failed'
  /** The project file (`.llc`) exists but cannot be read: it is left where it is. */
  | 'project-unreadable'
  /** The work directory could not be scanned (permissions, a lock). */
  | 'work-dir-unreadable'
  /** The work directory still holds something outside the whitelist, so it was kept. */
  | 'work-dir-not-clearable'
  /** The recycle bin refused the work directory; nothing was deleted. */
  | 'work-dir-trash-failed';

/** The absolute directories the job writes into. */
export interface PatchFinishDirs {
  workDir: string;
  clipsDir: string;
  mergedDir: string;
  finishedSrcMediaDir: string;
  /** `<finished area>/finished_skip_src`: sources the user skipped (no cut or merge needed). */
  finishedSkipSrcMediaDir: string;
  detachedSrcMediaDir: string;
  finishedMergedDir: string;
  finishedClipsDir: string;
  detachedClipsDir: string;
  /** `<work area>/detached_merged`: merged results a discarded job moved aside. */
  detachedMergedDir: string;
  /** `<finished area>/finish_llc` (archived project files, flat). */
  finishLlcDir: string;
}

/** The project-file stores outside the work area. */
export interface PatchFinishProjectStores {
  /** `<userData>/llc`. */
  userDataLlcDir: string;
  /** `<installation folder>/llc`. */
  installLlcDir: string;
  /** Can the app create the installation-folder store? (best effort, re-checked by the job) */
  installLlcWritable: boolean;
}

export interface PatchFinishFileRef {
  path: string;
  size: number;
  mtimeMs: number;
}

/** A cut result of the job (the project file records where it ended up, and which segment it is). */
export interface PatchFinishClipRef extends PatchFinishFileRef {
  /** The segment the clip was cut from; `undefined` for a result of a manifest without one. */
  segId?: string | undefined;
  /**
  The clip's label and cut times, as the export record kept them: the rename rule renders
  `{label}`, `{labels}`, `{cut_from}` and `{cut_to}` from them. Absent for an old manifest, which
  then simply renames without those tokens.
  */
  label?: string | undefined;
  start?: number | undefined;
  end?: number | undefined;
}

export interface PatchFinishPreview {
  /** The mode the job runs in (`auto` resolved to one of them). */
  mode: PatchFinishMode;
  source: {
    path: string;
    size: number | undefined;
    exists: boolean;
    /** The file exists but could not be read (permissions, a lock): a problem of its own. */
    unreadable: boolean;
    insideWorkArea: boolean;
    /** The directory the merged result goes back into for the "back to the source directory" choices. */
    dir: string;
  };
  /** The project file of the source, when one exists. */
  projectFile: { path: string } | undefined;
  merged: PatchFinishFileRef | undefined;
  /**
  Is the merged result inside `merged/`? Only a result of this work area may be deleted; moving
  one that lives elsewhere (a renamed result, a manual move) stays possible.
  */
  mergedInsideWorkArea: boolean;
  /** The cut results inside the work area (the only ones the job may delete or move). */
  clips: PatchFinishClipRef[];
  /**
  The segment ids the last export selected (the manifest's `order`, fork-owned).

  It tells this job's results apart from the ones earlier passes left in the work area: see
  `splitClipsByExportSelection`. Missing on a manifest written before the order was recorded, in
  which case every result counts as part of this export (nothing is treated as stale).
  */
  selectedSegIds?: string[] | undefined;
  /**
  Cut results of this source that are already in `finished_clips` (fork-owned).

  Context for the counts only: this job never moves, deletes or touches them. The list is read from
  the folder by the source's name, minus the segments this export cuts again (their old copy is
  still there, and counting it would add up to more segments than the cut list has). Missing on a
  preview built before the dialog showed it.
  */
  finishedClips?: PatchFinishFileRef[] | undefined;
  /**
  The segments of the merged result, in merge order (empty when the merge was recorded before the
  chapters were). The project file keeps them, so a later reader can tell what the file contains.
  */
  mergedSegIds?: string[] | undefined;
  clipsTotalSize: number;
  /** Manifest records whose file is outside the work area: never deleted, never moved. */
  outsideClipCount: number;
  /**
  Manifest records whose file no longer exists at its recorded path (not merely unreadable).
  They are left out of `clips`, and a job that would still move other results stays blocked: see
  `getFinishOptionProblems`.
  */
  missingClipCount: number;
  /**
  Of `missingClipCount`, the records that belong to **this export's** selection (fork-owned).

  Only these can make the job lose a record: a result of an earlier pass is never moved by this job
  (it is deleted or kept as a whole, see `splitClipsByExportSelection`), so a missing one drops
  nothing. `getFinishOptionProblems` blocks on this narrower count.
  */
  missingSelectedClipCount: number;
  /**
  Files this job would move or delete that another window currently plays (fork-owned).

  The results window is read-only, so playing is never refused; but a job must not pull a file out
  from under a running player. The paths are the job's own (`clips` and the merged result).
  */
  filesInUse: string[];
  /** Is the merged result at least as new as every cut result? (needed before deleting them) */
  mergedCoversClips: boolean;
  hasRecord: boolean;
  dirs: PatchFinishDirs;
  /** Everything currently under `dirs.workDir` (relative paths), for the empty-work-dir choice. */
  workDirEntries: PatchWorkDirEntry[];
  /** The work directory could not be scanned: the cleanup choice must stay disabled. */
  workDirScanFailed: boolean;
  /** The stores the project file can be archived into (independent of the work root). */
  projectStores: PatchFinishProjectStores;
  warnings: PatchFinishWarning[];
}

export interface PatchFinishReport {
  ok: boolean;
  moved: { from: string; to: string }[];
  /**
  What the job left on disk, with the paths the files really have now (fork-owned).

  The finish summary lists them and offers to reveal one. Deleted results are not in here, and
  neither are the source video nor the project file (`moved` carries those). The paths are final: a
  name taken by another file already got its ` (n)` suffix here, so a reader never has to guess.
  */
  results: { path: string; kind: 'clip' | 'merged' }[];
  deleted: string[];
  failed: { path: string; reason: string }[];
  warnings: PatchFinishWarning[];
  /** Where the source video ended up (only when it moved). */
  newSourcePath: string | undefined;
  projectMovedTo: string | undefined;
  /** The work directory was moved to the recycle bin (empty-stage-folders cleanup). */
  workDirTrashed: { path: string } | undefined;
  /** The recycle bin refused the work directory: it is still on disk, untouched. */
  workDirTrashFailed: { path: string; reason: string } | undefined;
  /** Directories the user may want to open after the job (only the ones that received files). */
  touchedDirs: string[];
  /**
  Project files (`<video>-proj.llc`) that lost their video and were cleaned out of `clips/` /
  `merged/` after a successful job (fork-owned). Leftovers used to keep a work area from ever
  being cleanable.
  */
  orphanProjectsDeleted: string[];
}

/** What the cutting window asks the main process before showing the dialog. */
export interface PatchFinishPreviewParams {
  sourcePath: string;
  /** The work root in effect for that source (the renderer resolved it). */
  workRoot: string | undefined;
  /** The project file the cutting window would load (it knows the upstream output directory). */
  projectFilePath?: string | undefined;
  /** `auto` picks the mode from the source's merged result (a fallback only: the windows resolve it). */
  mode: PatchFinishModeRequest;
}

/** What the cutting window asks the main process to do. */
export interface PatchFinishJobParams {
  sourcePath: string;
  workRoot: string | undefined;
  projectFilePath?: string | undefined;
  /** The mode the dialog showed (already resolved, never `auto`). */
  mode: PatchFinishMode;
  /** The chosen options, validated again by the main process. */
  options: unknown;
  /**
  The names the cut results are moved to (see `features/patchFinish/cutRename`), rendered by the
  dialog from the results the job starts with.

  Sent with the job instead of being rendered again: a retry after a half-finished attempt sees
  fewer results in its preview, and renumbering them would give the same source two name schemes.
  Every entry is re-checked by the executor (a result of this work area, a plain file name).
  */
  renamePlan?: readonly CutRenamePlanEntry[] | undefined;
  /**
  ISO time the dialog resolved its date folders with, so the folder the summary showed and the
  folder the job writes into agree even when the dialog stays open over midnight.
  */
  now?: string | undefined;
}
