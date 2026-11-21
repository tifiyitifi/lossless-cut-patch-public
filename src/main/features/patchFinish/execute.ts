import JSON5 from 'json5';
import { t as i18nextT } from 'i18next';
import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { buildFinishSteps, buildPatchExportRecord, findOrphanProjectFileNames, freeNameCandidates, getFinishTouchedPaths, getMovedProjectName, getParentPath, getPathExtension, getPathFileName, getPathStem, getProjectFileName, isPathInside, isSamePath, keepsCutResults, leavesCutResultsInWorkArea, normalizePath, parsePatchFinishCutOptions, parsePatchFinishDiscardOptions, parsePatchFinishMergeOptions, resolveCutRenameFileName, resolveProjectTargetDir } from '../../../common/features/patchFinish/index.js';
import type { PatchExportRecord, PatchFinishJobParams, PatchFinishMergeOptions, PatchFinishCutOptions, PatchFinishOptions, PatchFinishPreview, PatchFinishReport } from '../../../common/features/patchFinish/index.js';
import { patchFinishFilesInUseMarker } from '../../../common/features/patchFinish/busy.js';
import type { LlcTranslate } from '../../../common/features/patchData/llcProjectText.js';
import { renderLlcProjectText } from '../../../common/features/patchData/llcProjectText.js';
import { buildProjectData, projectExtrasOf } from '../../../common/features/patchData/projectExtras.js';
import { isFileLockError } from '../../../common/features/patchPlayer/renameResult.js';
import { defaultPatchDirNames, getWorkDirClearDecision, isClearableWorkDirPath } from '../../../common/features/patchWork/index.js';
import type { PatchDirNames, PatchWorkDirEntry } from '../../../common/features/patchWork/index.js';

/**
The finish job (main process).

The renderer only chooses; this module moves and deletes files. Its rules are deliberately narrow:

- the source video is only ever *moved*; the merged result is moved or deleted as the options ask;
- only files inside this work area's `clips/` / `merged/` may be deleted, and the cut results only
  when the merged result covers them;
- an existing file is never overwritten on purpose (a free ` (n)` name is used; a file created
  between that check and the move is still a race the file system has to win);
- a failure stops the job, so a dangerous step (the merged result taking the source's name) never
  runs after the source could not be moved.

File-system access is injected so the logic can be unit tested without touching disk.
*/

export interface PatchFinishExecuteDeps {
  exists: (path: string) => Promise<boolean>;
  mkdir: (path: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  copyFile: (from: string, to: string) => Promise<void>;
  unlink: (path: string) => Promise<void>;
  readText: (path: string) => Promise<string>;
  writeText: (path: string, text: string) => Promise<void>;
  /** Forget the source's export-manifest record (the job is over). */
  removeManifestRecord: (sourcePath: string) => Promise<void>;
  /** Scan the work directory into relative entries (no symlink following). */
  scanWorkDir: (dir: string) => Promise<PatchWorkDirEntry[]>;
  /** Move a whole directory to the OS recycle bin. Never falls back to a permanent delete. */
  trashDir: (dir: string) => Promise<void>;
  /** Translates the comment lines of a rewritten project file (injected so tests stay offline). */
  translate: LlcTranslate;
  /**
  One line per file operation (fork-owned). Injected because this module must stay importable
  without electron: the main process passes its logger, tests pass nothing.
  */
  log?: ((message: string) => void) | undefined;
  caseInsensitive: boolean;
  sleep: (ms: number) => Promise<void>;
  /** The configured folder names (the cleanup gate must recognize the configured work area). */
  dirNames?: PatchDirNames | undefined;
}

const lockRetryDelays = [100, 200, 400, 800];

function errorCode(err: unknown) {
  const code = (err as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

function errorReason(err: unknown) {
  return errorCode(err) ?? (err instanceof Error ? err.message : String(err));
}

function isCrossDeviceError(err: unknown) {
  return errorCode(err) === 'EXDEV';
}

async function withLockRetry<T>(operation: () => Promise<T>, sleep: (ms: number) => Promise<void>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await operation();
    } catch (err) {
      const delay = lockRetryDelays[attempt];
      if (!isFileLockError(err) || delay == null) throw err;
      // eslint-disable-next-line no-await-in-loop
      await sleep(delay);
    }
  }
}

/**
Best effort removal of a half-made target. The original error is what the caller reports; the
cleanup only keeps a failed move from leaving two copies (and ` (n)` duplicates on the retry).
*/
async function removeTargetQuietly(path: string, deps: PatchFinishExecuteDeps) {
  try {
    await deps.unlink(path);
  } catch {
    // The move failed anyway; a leftover file is not worth a second error.
  }
}

/** Move a file, falling back to copy + delete when the target is on another volume. */
async function movePath(from: string, to: string, deps: PatchFinishExecuteDeps) {
  await deps.mkdir(dirname(to));
  try {
    await withLockRetry(() => deps.rename(from, to), deps.sleep);
  } catch (err) {
    if (!isCrossDeviceError(err)) throw err;
    try {
      await deps.copyFile(from, to);
    } catch (copyErr) {
      await removeTargetQuietly(to, deps);
      throw copyErr;
    }
    try {
      await withLockRetry(() => deps.unlink(from), deps.sleep);
    } catch (unlinkErr) {
      // The copy is complete and the source is intact: drop the copy so the next attempt does not
      // find a phantom ` (n)` file next to a source that never left.
      await removeTargetQuietly(to, deps);
      throw unlinkErr;
    }
  }
  deps.log?.(`patch finish: moved ${from} -> ${to}`);
}

function pathKey(path: string, caseInsensitive: boolean) {
  const normalized = normalizePath(path);
  return caseInsensitive ? normalized.toLowerCase() : normalized;
}

interface ReservedTarget {
  path: string;
}

/**
The project file (`.llc`) that sits next to a video (`clips/a.mp4` -> `clips/a-proj.llc`).

The results windows used to write one next to every result. A leftover keeps the whole work area
from being cleaned (`getWorkDirClearDecision` allows nothing inside `clips/`), so a move or a
delete of a result has to take it along.
*/
function getVideoProjectPath(videoPath: string) {
  return join(dirname(videoPath), getProjectFileName(videoPath));
}

/** The project file's name once its video has been given a free ` (n)` name. */
function getTargetProjectPath({ fromVideoPath, toVideoPath }: { fromVideoPath: string; toVideoPath: string }) {
  return join(dirname(toVideoPath), getMovedProjectName({ fromVideoPath, toVideoPath }));
}

/**
A free target name in `dir`.

Both the video and its `.llc` are checked when the project file travels with it, so the pair keeps
the same stem (an existing orphan `.llc` would otherwise make the video's project unloadable).
The check is a snapshot: a file created by someone else before the move can still collide (the
file system wins that race).
*/
async function reserveTarget({ dir, fileName, alsoReserve, deps, reserved }: {
  dir: string;
  fileName: string;
  alsoReserve?: (target: string) => readonly string[];
  deps: PatchFinishExecuteDeps;
  reserved: Set<string>;
}): Promise<ReservedTarget> {
  const isFree = async (candidate: string) => {
    const target = join(dir, candidate);
    if (reserved.has(pathKey(target, deps.caseInsensitive)) || (await deps.exists(target))) return undefined;
    const extra = alsoReserve?.(target) ?? [];
    for (const extraTarget of extra) {
      // eslint-disable-next-line no-await-in-loop
      if (reserved.has(pathKey(extraTarget, deps.caseInsensitive)) || await deps.exists(extraTarget)) return undefined;
    }
    reserved.add(pathKey(target, deps.caseInsensitive));
    for (const extraTarget of extra) reserved.add(pathKey(extraTarget, deps.caseInsensitive));
    return { path: target };
  };

  for (const candidate of freeNameCandidates(fileName)) {
    // eslint-disable-next-line no-await-in-loop
    const target = await isFree(candidate);
    if (target != null) return target;
  }
  throw new Error(`Could not find a free file name in ${dir}`);
}

/**
Rewrite a project file in place: the video's new name, and/or the outputs of the finished job.

Both writers (this one and the renderer's save path) render through `buildProjectData`, so the
fields the app does not know keep their place and the file reads the same whichever process wrote
it last. A project file that cannot be read or parsed is left alone: it is a note, not a result.
*/
async function rewriteProjectFile({ projectPath, mediaFileName, exportRecord, deps }: {
  projectPath: string;
  /** The video's new file name; `undefined` keeps the one the file stores. */
  mediaFileName?: string | undefined;
  /** What the job left on disk (see `buildPatchExportRecord`). */
  exportRecord?: PatchExportRecord | undefined;
  deps: PatchFinishExecuteDeps;
}) {
  try {
    const parsed: unknown = JSON5.parse(await deps.readText(projectPath));
    if (typeof parsed !== 'object' || parsed == null || Array.isArray(parsed)) return;
    const project = parsed as Record<string, unknown>;
    const extras = projectExtrasOf(project);
    if (exportRecord != null) extras['patchExport'] = exportRecord;
    await deps.writeText(projectPath, renderLlcProjectText(buildProjectData({
      version: project['version'],
      mediaFileName: mediaFileName ?? project['mediaFileName'],
      cutSegments: project['cutSegments'],
      extras,
    }), { t: deps.translate }));
  } catch {
    // The project file stays readable even with the old name; it only matters when it is opened
    // directly (the app finds it next to the video anyway).
  }
}

interface MovedSource {
  movedTo: string;
  projectMovedTo: string | undefined;
  /** The video moved but its project file did not; the caller reports it and stops the job. */
  projectError: { path: string; error: unknown } | undefined;
  /** The video was already at the target: nothing moved, nothing is reported. */
  unchanged: boolean;
}

/**
Is `from` already exactly where a move would put it?

Reopening a kept source (`losslesscut_finished/finished_src_media/a.mp4`) and finishing it again
with the same choice names the file itself as the target. Treating that as a move would rename it
to `a (1).mp4` (the target is taken - by itself), which looks like the job duplicated the file.
*/
function isAlreadyAtTarget({ from, targetDir, fileName, caseInsensitive }: {
  from: string;
  targetDir: string;
  fileName: string;
  caseInsensitive: boolean;
}) {
  return isSamePath(from, join(targetDir, fileName), { caseInsensitive });
}

async function moveSourceWithProject({ sourcePath, targetDir, projectFilePath, deps, reserved }: {
  sourcePath: string;
  targetDir: string;
  projectFilePath: string | undefined;
  deps: PatchFinishExecuteDeps;
  reserved: Set<string>;
}): Promise<MovedSource> {
  const fileName = getPathFileName(sourcePath);
  if (isAlreadyAtTarget({ from: sourcePath, targetDir, fileName, caseInsensitive: deps.caseInsensitive })) {
    // The video and the project file next to it are where they belong: leave both alone.
    return { movedTo: sourcePath, projectMovedTo: undefined, projectError: undefined, unchanged: true };
  }

  const target = await reserveTarget({
    dir: targetDir,
    fileName,
    ...((projectFilePath != null) && {
      alsoReserve: (videoTarget: string) => [join(dirname(videoTarget), getMovedProjectName({ fromVideoPath: sourcePath, toVideoPath: videoTarget }))],
    }),
    deps,
    reserved,
  });

  await movePath(sourcePath, target.path, deps);

  if (projectFilePath == null) return { movedTo: target.path, projectMovedTo: undefined, projectError: undefined, unchanged: false };
  const projectTarget = join(dirname(target.path), getMovedProjectName({ fromVideoPath: sourcePath, toVideoPath: target.path }));
  try {
    await movePath(projectFilePath, projectTarget, deps);
  } catch (error) {
    // The video is already at its new place: report the two moves apart, so the caller can record
    // the one that worked instead of claiming the video failed.
    return { movedTo: target.path, projectMovedTo: undefined, projectError: { path: projectFilePath, error }, unchanged: false };
  }
  if (getPathFileName(target.path) !== fileName) {
    await rewriteProjectFile({ projectPath: projectTarget, mediaFileName: getPathFileName(target.path), deps });
  }
  return { movedTo: target.path, projectMovedTo: projectTarget, projectError: undefined, unchanged: false };
}

/** Move the source video alone (the project file has a destination of its own). */
async function moveSourceVideo({ sourcePath, targetDir, deps, reserved }: {
  sourcePath: string;
  targetDir: string;
  deps: PatchFinishExecuteDeps;
  reserved: Set<string>;
}): Promise<{ movedTo: string; unchanged: boolean }> {
  const fileName = getPathFileName(sourcePath);
  if (isAlreadyAtTarget({ from: sourcePath, targetDir, fileName, caseInsensitive: deps.caseInsensitive })) {
    return { movedTo: sourcePath, unchanged: true };
  }

  const target = await reserveTarget({ dir: targetDir, fileName, deps, reserved });
  await movePath(sourcePath, target.path, deps);
  return { movedTo: target.path, unchanged: false };
}

/**
Move the project file into an explicit store.

The file is named after the video's final name (`<video>-proj.llc`), so the store stays readable
even though it is only a backup. When the project file is already exactly there, nothing happens.
*/
async function moveProjectToStore({ projectPath, videoPath, originalVideoPath, targetDir, deps, reserved }: {
  projectPath: string;
  /** The source video's final path (after the source step, if any). */
  videoPath: string;
  originalVideoPath: string;
  targetDir: string;
  deps: PatchFinishExecuteDeps;
  reserved: Set<string>;
}): Promise<{ movedTo: string | undefined }> {
  const desiredName = getProjectFileName(videoPath);
  const sameDir = isSamePath(getParentPath(projectPath), targetDir, { caseInsensitive: deps.caseInsensitive });
  // The file system may ignore case (Windows/macOS): `A-PROJ.llc` may already be the desired name.
  if (sameDir && isSamePath(getPathFileName(projectPath), desiredName, { caseInsensitive: deps.caseInsensitive })) {
    // Nothing to move, but the source step may have renamed the video: the stored name is what the
    // app uses to find the media, so it has to follow even when the file stays where it is.
    if (getPathFileName(videoPath) !== getPathFileName(originalVideoPath)) {
      await rewriteProjectFile({ projectPath, mediaFileName: getPathFileName(videoPath), deps });
    }
    return { movedTo: undefined };
  }

  const target = await reserveTarget({ dir: targetDir, fileName: desiredName, deps, reserved });
  await movePath(projectPath, target.path, deps);

  // The video may have been renamed by the source step; keep the stored media name in sync.
  if (getPathFileName(videoPath) !== getPathFileName(originalVideoPath)) {
    await rewriteProjectFile({ projectPath: target.path, mediaFileName: getPathFileName(videoPath), deps });
  }
  return { movedTo: target.path };
}

function uniqueDirs(paths: readonly string[]) {
  return [...new Set(paths.map((path) => normalizePath(dirname(path))))];
}

/** The directory a step moves the cut results to. */
function clipsTargetDir({ target, preview, dirs }: {
  target: 'detached' | 'finished' | 'source';
  preview: PatchFinishPreview;
  dirs: PatchFinishPreview['dirs'];
}) {
  if (target === 'detached') return dirs.detachedClipsDir;
  if (target === 'finished') return dirs.finishedClipsDir;
  return preview.source.dir;
}

export async function executePatchFinish({ params, preview, deps, now = new Date() }: {
  params: PatchFinishJobParams;
  preview: PatchFinishPreview;
  deps: PatchFinishExecuteDeps;
  /** The date the project store folders are named after (tests pass a fixed one). */
  now?: Date;
}): Promise<PatchFinishReport> {
  const options: PatchFinishOptions = params.mode === 'merge'
    ? parsePatchFinishMergeOptions(params.options)
    : (params.mode === 'discard' ? parsePatchFinishDiscardOptions(params.options) : parsePatchFinishCutOptions(params.options));

  const steps = buildFinishSteps({ mode: params.mode, options, preview });

  // patch: the caller rebuilds this preview right before the job (after closing this instance's
  // results windows), so `filesInUse` is the state at execution time. The job only touches some of
  // the preview's files, so check those: refuse before the first move instead of failing halfway
  // (and instead of pulling a file out of a running player).
  const touched = new Set(getFinishTouchedPaths({ mode: params.mode, options, preview }));
  if (preview.filesInUse.some((path) => touched.has(path))) throw new Error(patchFinishFilesInUseMarker);

  const report: PatchFinishReport = {
    ok: true,
    moved: [],
    results: [],
    deleted: [],
    failed: [],
    warnings: [...preview.warnings],
    newSourcePath: undefined,
    projectMovedTo: undefined,
    workDirTrashed: undefined,
    workDirTrashFailed: undefined,
    touchedDirs: [],
    orphanProjectsDeleted: [],
  };
  const reserved = new Set<string>();
  const { dirs } = preview;
  let finalSourcePath = params.sourcePath;

  const fail = (path: string, err: unknown) => {
    report.ok = false;
    report.failed.push({ path, reason: errorReason(err) });
    deps.log?.(`patch finish: failed ${path}: ${errorReason(err)}`);
  };

  /** Delete one result, but only inside the work area it belongs to. */
  const deleteClip = async (clipPath: string) => {
    if (!isPathInside(clipPath, dirs.clipsDir, { caseInsensitive: deps.caseInsensitive })) {
      report.warnings.push('clips-outside-work-area');
      return;
    }
    try {
      await withLockRetry(() => deps.unlink(clipPath), deps.sleep);
      report.deleted.push(clipPath);
      deps.log?.(`patch finish: deleted ${clipPath}`);
    } catch (err) {
      if (errorCode(err) === 'ENOENT') report.deleted.push(clipPath);
      else fail(clipPath, err);
    }

    // patch: the result's project file goes with it (a leftover would block the work-area cleanup).
    const projectPath = getVideoProjectPath(clipPath);
    try {
      await withLockRetry(() => deps.unlink(projectPath), deps.sleep);
      report.deleted.push(projectPath);
      deps.log?.(`patch finish: deleted ${projectPath}`);
    } catch (err) {
      if (errorCode(err) !== 'ENOENT') fail(projectPath, err);
    }
  };

  /**
  The results a clip step applies to: the ones it names, or every tracked result.

  A step names its results when the job only handles this export's clips (or only the stale ones);
  the paths come from the same preview, so they match exactly.
  */
  const stepClips = (clipPaths: readonly string[] | undefined) => {
    if (clipPaths == null) return preview.clips;
    const wanted = new Set(clipPaths);
    return preview.clips.filter((clip) => wanted.has(clip.path));
  };

  /**
  Move one video together with its project file, when it has one (fork-owned).

  Both names are reserved up front so a video never lands on a name whose project file is taken.

  `kind` records the video as a result of the job (the finish summary lists and reveals those, see
  `PatchFinishReport.results`). The source video is not passed here: its final path is
  `newSourcePath`.
  */
  const moveVideoWithProject = async ({ videoPath, targetDir, fileName = getPathFileName(videoPath), kind }: {
    videoPath: string;
    targetDir: string;
    fileName?: string;
    kind: 'clip' | 'merged';
  }) => {
    // Already exactly there (a kept merged result finished again): a "move" would only rename it to
    // `m (1).mp4`, and its project file is already its sidecar.
    if (isAlreadyAtTarget({ from: videoPath, targetDir, fileName, caseInsensitive: deps.caseInsensitive })) {
      report.results.push({ path: videoPath, kind });
      return;
    }

    const projectPath = getVideoProjectPath(videoPath);
    const hasProject = await deps.exists(projectPath);
    const target = await reserveTarget({
      dir: targetDir,
      fileName,
      ...(hasProject && {
        alsoReserve: (videoTarget: string) => [getTargetProjectPath({ fromVideoPath: videoPath, toVideoPath: videoTarget })],
      }),
      deps,
      reserved,
    });

    await movePath(videoPath, target.path, deps);
    report.moved.push({ from: videoPath, to: target.path });
    report.results.push({ path: target.path, kind });

    if (hasProject) {
      const projectTarget = getTargetProjectPath({ fromVideoPath: videoPath, toVideoPath: target.path });
      await movePath(projectPath, projectTarget, deps);
      report.moved.push({ from: projectPath, to: projectTarget });
    }
  };

  // A failure stops the job (the next step may depend on the one that failed); the flag is set by
  // the inner loops too, where a plain `break` would only leave that loop.
  let stopped = false;
  for (const step of steps) {
    if (stopped) break;
    deps.log?.(`patch finish: step ${step.kind}`);
    try {
      switch (step.kind) {
        case 'move-source': {
          const sourceTargetDirs = {
            finished: dirs.finishedSrcMediaDir,
            skip: dirs.finishedSkipSrcMediaDir,
            detached: dirs.detachedSrcMediaDir,
          } as const;
          const targetDir = sourceTargetDirs[step.target];
          if (options.projectFile === 'follow') {
            const result = await moveSourceWithProject({
              sourcePath: params.sourcePath,
              targetDir,
              projectFilePath: preview.projectFile?.path,
              deps,
              reserved,
            });
            // Record the source before the project result: the video is at its new place already,
            // even when the project move below failed. A source that was already there is not a
            // move, so it stays out of the report (and out of "Moved N file(s)").
            if (!result.unchanged) report.moved.push({ from: params.sourcePath, to: result.movedTo });
            report.newSourcePath = result.movedTo;
            finalSourcePath = result.movedTo;
            if (result.projectMovedTo != null) report.projectMovedTo = result.projectMovedTo;
            if (result.projectError != null) {
              fail(result.projectError.path, result.projectError.error);
              stopped = true;
            }
          } else {
            const result = await moveSourceVideo({ sourcePath: params.sourcePath, targetDir, deps, reserved });
            if (!result.unchanged) report.moved.push({ from: params.sourcePath, to: result.movedTo });
            report.newSourcePath = result.movedTo;
            finalSourcePath = result.movedTo;
          }
          break;
        }
        case 'move-project': {
          const projectPath = preview.projectFile?.path;
          if (projectPath != null) {
            const projectOptions = options as PatchFinishMergeOptions | PatchFinishCutOptions;
            const target = resolveProjectTargetDir({
              choice: projectOptions.projectFile,
              projectDir: projectOptions.projectDir,
              dateGrouping: projectOptions.projectDateGrouping,
              stores: {
                finishLlcDir: dirs.finishLlcDir,
                userDataLlcDir: preview.projectStores.userDataLlcDir,
                installLlcDir: preview.projectStores.installLlcDir,
              },
              now,
            });
            if (target.kind !== 'dir' || target.dir == null) throw new Error('No folder chosen for the project file');
            const result = await moveProjectToStore({
              projectPath,
              videoPath: finalSourcePath,
              originalVideoPath: params.sourcePath,
              targetDir: target.dir,
              deps,
              reserved,
            });
            if (result.movedTo != null) {
              report.moved.push({ from: projectPath, to: result.movedTo });
              report.projectMovedTo = result.movedTo;
            }
          }
          break;
        }
        case 'move-merged': {
          if (preview.merged != null) {
            const targetDir = step.target === 'finished'
              ? dirs.finishedMergedDir
              : (step.target === 'detached' ? dirs.detachedMergedDir : preview.source.dir);
            const fileName = step.target === 'source-rename'
              ? `${getPathStem(params.sourcePath)}${getPathExtension(preview.merged.path)}`
              : getPathFileName(preview.merged.path);
            // patch: a project file next to the merged result travels with it.
            await moveVideoWithProject({ videoPath: preview.merged.path, targetDir, fileName, kind: 'merged' });
          }
          break;
        }
        case 'delete-merged': {
          const { merged } = preview;
          if (merged != null) {
            // Only a result of this work area may be deleted; the source video is never a candidate.
            if (isPathInside(merged.path, dirs.mergedDir, { caseInsensitive: deps.caseInsensitive })) {
              try {
                await withLockRetry(() => deps.unlink(merged.path), deps.sleep);
                report.deleted.push(merged.path);
                deps.log?.(`patch finish: deleted ${merged.path}`);
              } catch (err) {
                // The file was there when the preview was built, but the user (or a virus scanner) may
                // have removed it since. Nothing left to delete is success, exactly like `deleteClip`.
                if (errorCode(err) === 'ENOENT') report.deleted.push(merged.path);
                else throw err;
              }
              // patch: its project file goes too (it would otherwise keep the work area uncleanable).
              const projectPath = getVideoProjectPath(merged.path);
              try {
                await withLockRetry(() => deps.unlink(projectPath), deps.sleep);
                report.deleted.push(projectPath);
                deps.log?.(`patch finish: deleted ${projectPath}`);
              } catch (err) {
                if (errorCode(err) !== 'ENOENT') throw err;
              }
            } else {
              report.warnings.push('merged-outside-work-area');
            }
          }
          break;
        }
        case 'move-clips': {
          const targetDir = clipsTargetDir({ target: step.target, preview, dirs });
          // patch: the finish step renames the results on the way out (`cutRename`). Only a cut job
          // keeps its results: a merge moves them aside to be deleted, and the discard flow parks
          // them, so both keep the names the cut step gave them.
          const renames = params.mode === 'cut' && step.target !== 'detached';
          for (const clip of stepClips(step.clipPaths)) {
            const fileName = renames
              ? resolveCutRenameFileName({
                plan: params.renamePlan,
                clipPath: clip.path,
                clipsDir: dirs.clipsDir,
                caseInsensitive: deps.caseInsensitive,
              })
              : undefined;
            try {
              // eslint-disable-next-line no-await-in-loop
              await moveVideoWithProject({ videoPath: clip.path, targetDir, ...(fileName != null && { fileName }), kind: 'clip' });
            } catch (err) {
              // Report the clip that failed, not whatever the other step kinds operate on.
              fail(clip.path, err);
              stopped = true;
              break;
            }
          }
          break;
        }
        case 'delete-clips': {
          // The preview (built for this very job) proved the merged result covers the cut results.
          // The discard flow deletes the merged result as well (or moves it aside), so coverage is
          // not a condition there.
          if (preview.mergedCoversClips || params.mode === 'discard') {
            for (const clip of stepClips(step.clipPaths)) {
              // eslint-disable-next-line no-await-in-loop
              await deleteClip(clip.path);
              // Discard promises the source stays put when a result cannot be deleted: stop before
              // the source step, so a retry works from the same paths.
              if (params.mode === 'discard' && !report.ok) {
                stopped = true;
                break;
              }
            }
          } else {
            report.warnings.push('merged-stale');
          }
          break;
        }
        case 'delete-stale-clips': {
          // Results of earlier passes, not the merge's input: no coverage proof is needed (their own
          // output already left). A failure is reported and the loop continues, like `delete-clips`.
          for (const clipPath of step.clipPaths) {
            // eslint-disable-next-line no-await-in-loop
            await deleteClip(clipPath);
          }
          break;
        }
        default: {
          break;
        }
      }
    } catch (err) {
      // A failure stops the job: the next step may depend on this one (the merged result taking the
      // source's name needs the source to be gone), so continuing could lose data.
      const failedPath = (() => {
        switch (step.kind) {
          case 'move-source': { return params.sourcePath; }
          case 'move-project': { return preview.projectFile?.path ?? ''; }
          case 'move-merged':
          case 'delete-merged': { return preview.merged?.path ?? ''; }
          default: { return ''; }
        }
      })();
      fail(failedPath, err);
      break;
    }
  }

  // patch: the project file records what the job left on disk - the only moment the outputs have
  // their final names. A failed job records nothing: what it did reach is a partial result. A
  // discarded source is not a finished job: its project file keeps the segments (it travels with
  // the video), and the parked results are not "outputs" of a finished project. A merge that keeps
  // its cut results is a pass, not a finish, and records nothing either.
  if (report.ok && !keepsCutResults(params.mode, options)) {
    const exportRecord = params.mode === 'discard' ? undefined : buildPatchExportRecord({ mode: params.mode, preview, moved: report.moved });
    const projectPath = report.projectMovedTo ?? preview.projectFile?.path;
    if (exportRecord != null && projectPath != null) {
      await rewriteProjectFile({ projectPath, exportRecord, deps });
    }
  }

  // Forget the record only when the job is over and nothing stayed behind. Results kept for a later
  // pass (`clips: keep`) - or stale results of earlier passes the user chose to keep - must stay
  // tracked: the main process then prunes what really left (`updatePatchExportManifestAfterFinish`).
  // A failed job leaves the results (and the merged / cut results it did not reach) tracked, so the
  // user can retry it from the same manifest.
  if (report.ok && !leavesCutResultsInWorkArea({ mode: params.mode, options, preview })) {
    try {
      await deps.removeManifestRecord(params.sourcePath);
    } catch {
      // The next export simply treats the results as out of date; nothing is lost.
    }

    // patch: an old build wrote a `<video>-proj.llc` next to every result. One whose video is gone
    // only keeps the work area from ever being cleaned, so the app-owned result folders are swept
    // after a successful job. Best effort: a sweep that cannot run never fails the job.
    for (const dir of [dirs.clipsDir, dirs.mergedDir]) {
      let entries: PatchWorkDirEntry[] | undefined;
      try {
        // eslint-disable-next-line no-await-in-loop
        entries = await deps.scanWorkDir(dir);
      } catch (err) {
        if (errorCode(err) !== 'ENOENT') deps.log?.(`patch finish: cannot scan ${dir}: ${errorReason(err)}`);
      }
      if (entries == null) {
        // The folder does not exist (or cannot be read): nothing to sweep.
      } else {
        // Only the direct children: the results never sit in a subfolder of these two.
        const candidates = entries
          .filter((entry) => !entry.path.includes('/'))
          .map((entry) => ({ name: entry.path, kind: entry.kind }));
        for (const name of findOrphanProjectFileNames(candidates, { caseInsensitive: deps.caseInsensitive })) {
          const orphanPath = join(dir, name);
          try {
            // eslint-disable-next-line no-await-in-loop
            await withLockRetry(() => deps.unlink(orphanPath), deps.sleep);
            report.orphanProjectsDeleted.push(orphanPath);
            deps.log?.(`patch finish: deleted orphan project ${orphanPath}`);
          } catch (err) {
            if (errorCode(err) !== 'ENOENT') deps.log?.(`patch finish: cannot delete ${orphanPath}: ${errorReason(err)}`);
          }
        }
      }
    }
  }

  // The optional work-area cleanup runs after every file step succeeded. The whitelist is checked
  // again against the real disk (not the preview): anything the user dropped in the meantime keeps
  // the folder, and a refused recycle bin never falls back to a permanent delete.
  if (report.ok && options.workDir === 'clear') {
    // The same deep gate the `cewd` command uses: only the work area itself may ever be trashed,
    // never whatever folder a future source of `dirs` happens to point at.
    if (!isClearableWorkDirPath(dirs.workDir, { dirNames: deps.dirNames ?? defaultPatchDirNames, caseInsensitive: deps.caseInsensitive })) {
      report.warnings.push('work-dir-not-clearable');
    } else {
      try {
        const entries = await deps.scanWorkDir(dirs.workDir);
        // patch: this job holds the work-area lock itself (`main/index` takes it before the job), so
        // its own `.export.lock` must not be mistaken for another window using the folder - the plan
        // it was given includes clearing the area after this job.
        const decision = getWorkDirClearDecision({ entries, caseInsensitive: deps.caseInsensitive, ignoreLock: true });
        if (!decision.clearable) {
          report.warnings.push('work-dir-not-clearable');
        } else {
          try {
            await deps.trashDir(dirs.workDir);
            report.workDirTrashed = { path: dirs.workDir };
          } catch (err) {
            if (errorCode(err) !== 'ENOENT') {
              report.warnings.push('work-dir-trash-failed');
              report.workDirTrashFailed = { path: dirs.workDir, reason: errorReason(err) };
            }
          }
        }
      } catch (err) {
        if (errorCode(err) !== 'ENOENT') {
          report.warnings.push('work-dir-not-clearable');
          report.workDirTrashFailed = { path: dirs.workDir, reason: errorReason(err) };
        }
      }
    }
  }

  report.touchedDirs = uniqueDirs(report.moved.map((entry) => entry.to)).filter((dir) => (
    report.workDirTrashed == null
    || (!isSamePath(dir, dirs.workDir, { caseInsensitive: deps.caseInsensitive })
      && !isPathInside(dir, dirs.workDir, { caseInsensitive: deps.caseInsensitive }))
  ));
  return report;
}

/** Real file-system implementation. */
export function createPatchFinishDeps({ removeManifestRecord, scanWorkDir, trashDir, log, dirNames }: {
  removeManifestRecord: (sourcePath: string) => Promise<void>;
  scanWorkDir: (dir: string) => Promise<PatchWorkDirEntry[]>;
  trashDir: (dir: string) => Promise<void>;
  log?: ((message: string) => void) | undefined;
  /** The configured folder names (the cleanup gate checks the work area by name). */
  dirNames?: PatchDirNames | undefined;
}): PatchFinishExecuteDeps {
  return {
    exists: async (path) => {
      try {
        await stat(path);
        return true;
      } catch {
        return false;
      }
    },
    mkdir: async (path) => {
      await mkdir(path, { recursive: true });
    },
    rename: async (from, to) => {
      await rename(from, to);
    },
    copyFile: async (from, to) => {
      await copyFile(from, to);
    },
    unlink: async (path) => {
      await unlink(path);
    },
    readText: async (path) => readFile(path, 'utf8'),
    writeText: async (path, text) => {
      await writeFile(path, text, 'utf8');
    },
    removeManifestRecord,
    scanWorkDir,
    trashDir,
    ...((log != null) && { log }),
    ...((dirNames != null) && { dirNames }),
    translate: (key, options) => (options == null ? i18nextT(key) : i18nextT(key, options)),
    caseInsensitive: process.platform === 'win32' || process.platform === 'darwin',
    sleep: async (ms) => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      });
    },
  };
}
