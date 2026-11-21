import type { PatchFinishCutOptions, PatchFinishDiscardOptions, PatchFinishMergeOptions, PatchFinishMode } from './options.js';
import type { PatchFinishPreview } from './preview.js';
import { resolveSourceChoice } from './plan.js';
import {
  getMovedProjectName, getParentPath, getPathFileName, getProjectFileName, joinPaths, normalizePath, resolveProjectTargetDir,
} from './paths.js';
import type { PatchWorkDirEntry } from '../patchWork/index.js';
import { getWorkDirClearDecision } from '../patchWork/emptyWorkDirs.js';

/**
Will the work directory be cleanable after this finish job? (pure)

The executor only trashes the work area when it holds nothing but whitelisted entries
(`getWorkDirClearDecision`). This function predicts the same state from the preview before the
job runs, so the finish dialog can enable the choice (and the summary stays honest).

The prediction starts from every entry actually on disk and applies the same moves the executor
will make. Anything the preview does not know about stays in the map and blocks the cleanup - a
conservative choice: a hand-made file must keep the folder even when this job would not touch it.
*/

export interface PatchFinishWorkDirClearView {
  clearable: boolean;
  /** Predicted entries outside the whitelist (relative to the work directory). */
  blockers: string[];
}

interface WorkEntry {
  path: string;
  kind: PatchWorkDirEntry['kind'];
}

function pathKey(path: string, caseInsensitive: boolean) {
  const normalized = normalizePath(path);
  return caseInsensitive ? normalized.toLowerCase() : normalized;
}

/**
The path relative to the work directory (`clips/a.mp4`), or `undefined` when it is outside.
A file is never the work directory itself, so only a strict prefix counts.
*/
function relativeToWorkDir(path: string, workDir: string, caseInsensitive: boolean) {
  const normalizedWorkDir = normalizePath(workDir);
  const normalizedPath = normalizePath(path);
  const prefix = normalizedWorkDir.endsWith('/') ? normalizedWorkDir : `${normalizedWorkDir}/`;
  const target = caseInsensitive ? normalizedPath.toLowerCase() : normalizedPath;
  const parent = caseInsensitive ? prefix.toLowerCase() : prefix;
  if (!target.startsWith(parent)) return undefined;
  // Slicing the original path keeps the spelling the file system used.
  return normalizedPath.slice(prefix.length);
}

/** Simulate one file move; only the work-area side of it matters here. */
function applyMove({ from, to, workDir, entries, caseInsensitive }: {
  from: string;
  to: string;
  workDir: string;
  entries: Map<string, WorkEntry>;
  caseInsensitive: boolean;
}) {
  const fromRelative = relativeToWorkDir(from, workDir, caseInsensitive);
  if (fromRelative != null) entries.delete(pathKey(fromRelative, caseInsensitive));
  const toRelative = relativeToWorkDir(to, workDir, caseInsensitive);
  if (toRelative != null) entries.set(pathKey(toRelative, caseInsensitive), { path: toRelative, kind: 'file' });
}

export function getFinishWorkDirClearView({ mode, options, preview, now = new Date(), caseInsensitive }: {
  mode: PatchFinishMode;
  options: PatchFinishMergeOptions | PatchFinishCutOptions | PatchFinishDiscardOptions;
  preview: PatchFinishPreview;
  /** The dialog's fixed time, so the predicted project-store folders match the executor's. */
  now?: Date;
  caseInsensitive: boolean;
}): PatchFinishWorkDirClearView {
  if (preview.workDirScanFailed) return { clearable: false, blockers: [] };

  const { dirs } = preview;
  const entries = new Map<string, WorkEntry>();
  for (const entry of preview.workDirEntries) {
    entries.set(pathKey(entry.path, caseInsensitive), { path: entry.path, kind: entry.kind });
  }

  const remove = (path: string) => {
    const relative = relativeToWorkDir(path, dirs.workDir, caseInsensitive);
    if (relative != null) entries.delete(pathKey(relative, caseInsensitive));
  };
  const move = (from: string, to: string) => applyMove({ from, to, workDir: dirs.workDir, entries, caseInsensitive });

  // Cut results.
  // A result may still have the project file an older version wrote next to it. The executor moves
  // or deletes it with the video, so the prediction has to as well - but only when the scan really
  // saw it (moving a phantom entry would add a blocker of its own).
  const projectOf = (videoPath: string) => joinPaths(getParentPath(videoPath), getProjectFileName(videoPath));
  const hasEntry = (path: string) => {
    const relative = relativeToWorkDir(path, dirs.workDir, caseInsensitive);
    return relative != null && entries.has(pathKey(relative, caseInsensitive));
  };
  const moveWithProject = (videoPath: string, targetDir: string) => {
    const target = joinPaths(targetDir, getPathFileName(videoPath));
    move(videoPath, target);
    const projectPath = projectOf(videoPath);
    if (hasEntry(projectPath)) move(projectPath, joinPaths(targetDir, getMovedProjectName({ fromVideoPath: videoPath, toVideoPath: target })));
  };
  const removeWithProject = (videoPath: string) => {
    remove(videoPath);
    const projectPath = projectOf(videoPath);
    if (hasEntry(projectPath)) remove(projectPath);
  };

  if (preview.clips.length > 0) {
    if (mode === 'discard') {
      const discardOptions = options as PatchFinishDiscardOptions;
      if (discardOptions.results === 'delete') {
        for (const clip of preview.clips) removeWithProject(clip.path);
      } else {
        for (const clip of preview.clips) moveWithProject(clip.path, dirs.detachedClipsDir);
      }
    } else if (mode === 'merge') {
      const mergeOptions = options as PatchFinishMergeOptions;
      if (mergeOptions.clips === 'delete' && preview.mergedCoversClips) {
        for (const clip of preview.clips) removeWithProject(clip.path);
      } else if (mergeOptions.clips !== 'keep') {
        for (const clip of preview.clips) moveWithProject(clip.path, dirs.detachedClipsDir);
      }
    } else {
      const cutOptions = options as PatchFinishCutOptions;
      // `keep` leaves the results in `clips/`, so the folder cannot be cleaned after this job.
      if (cutOptions.clips !== 'keep') {
        for (const clip of preview.clips) {
          if (cutOptions.clips === 'finished') moveWithProject(clip.path, dirs.finishedClipsDir);
          else removeWithProject(clip.path);
        }
      }
    }
  }

  // The merged result.
  if (mode === 'discard') {
    if (preview.merged != null) {
      if ((options as PatchFinishDiscardOptions).results === 'delete') {
        if (preview.mergedInsideWorkArea) removeWithProject(preview.merged.path);
      } else {
        moveWithProject(preview.merged.path, dirs.detachedMergedDir);
      }
    }
  } else if (mode === 'merge') {
    const mergeOptions = options as PatchFinishMergeOptions;
    if (preview.merged != null) {
      if (mergeOptions.merged === 'finished') moveWithProject(preview.merged.path, dirs.finishedMergedDir);
      else removeWithProject(preview.merged.path);
    }
  } else {
    const cutOptions = options as PatchFinishCutOptions;
    if (preview.merged != null) {
      if (cutOptions.mergedResult === 'finished') moveWithProject(preview.merged.path, dirs.finishedMergedDir);
      else if (cutOptions.mergedResult === 'delete' && preview.mergedInsideWorkArea) removeWithProject(preview.merged.path);
    }
  }

  // The source video: `keep` leaves it where it is (normally outside the work area).
  const sourceChoice = resolveSourceChoice(mode, options);
  const sourceTargetDirs = {
    finished: dirs.finishedSrcMediaDir,
    skip: dirs.finishedSkipSrcMediaDir,
    detached: dirs.detachedSrcMediaDir,
    keep: undefined,
  } as const;
  const sourceTargetDir = sourceTargetDirs[sourceChoice];
  const sourceTarget = sourceTargetDir != null
    ? joinPaths(sourceTargetDir, getPathFileName(preview.source.path))
    : preview.source.path;
  if (sourceTargetDir != null) move(preview.source.path, sourceTarget);

  // The project file.
  if (preview.projectFile != null) {
    const projectPath = preview.projectFile.path;
    if (options.projectFile === 'follow') {
      // It travels with the video, unless the video stays put.
      if (sourceTargetDir != null) {
        move(projectPath, joinPaths(sourceTargetDir, getMovedProjectName({ fromVideoPath: preview.source.path, toVideoPath: sourceTarget })));
      }
    } else if (options.projectFile === 'finish-llc') {
      move(projectPath, joinPaths(dirs.finishLlcDir, getProjectFileName(sourceTarget)));
    } else if (options.projectFile !== 'keep') {
      const target = resolveProjectTargetDir({
        choice: options.projectFile,
        projectDir: options.projectDir,
        dateGrouping: options.projectDateGrouping,
        stores: {
          finishLlcDir: dirs.finishLlcDir,
          userDataLlcDir: preview.projectStores.userDataLlcDir,
          installLlcDir: preview.projectStores.installLlcDir,
        },
        now,
      });
      if (target.kind === 'dir' && target.dir != null) {
        move(projectPath, joinPaths(target.dir, getProjectFileName(sourceTarget)));
      }
    }
  }

  return getWorkDirClearDecision({ entries: [...entries.values()], caseInsensitive });
}
