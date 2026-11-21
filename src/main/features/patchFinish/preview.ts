import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { findManifestFileKey, listTrackedClips, mergedClipsMatchInputs } from '../../../common/features/patchExport/index.js';
import type { PatchExportManifest, PatchMergeInputClip } from '../../../common/features/patchExport/index.js';
import { readProjectExtras } from '../../../common/features/patchData/projectExtras.js';
import { hasPatchMediaExtension } from '../../../common/features/patchData/videoExtensions.js';
import type { PatchFinishClipRef, PatchFinishDirs, PatchFinishFileRef, PatchFinishPreview, PatchFinishPreviewParams, PatchFinishProjectStores, PatchFinishWarning } from '../../../common/features/patchFinish/index.js';
import { getParentPath, getPathFileName, getPathStem, getProjectFileName, isInsideWorkArea, isPathInside, resolveFinishMode } from '../../../common/features/patchFinish/index.js';
import { isResultNameOfSource, parsePatchProjectClipOutputs } from '../../../common/features/patchResultsOverview/index.js';
import type { PatchWorkDirEntry } from '../../../common/features/patchWork/index.js';
import { defaultPatchDirNames } from '../../../common/features/patchWork/workDirs.js';
import type { PatchDirNames } from '../../../common/features/patchWork/workDirs.js';

/**
Everything the finish dialog shows (main process).

The export manifest is the source of truth for the merged result and the cut results; the file
system is asked for what still exists and for the sizes. Nothing here writes anything.
*/

export interface PatchFinishPreviewDeps {
  readManifest: (workRoot: string | undefined) => Promise<PatchExportManifest>;
  /** Size and modification time; throws when the file is gone. */
  stat: (path: string) => Promise<{ size: number, mtimeMs: number }>;
  /** Lists the media files of a folder; rejects when the folder does not exist. */
  listMediaFiles?: ((dir: string) => Promise<readonly string[]>) | undefined;
  /** Reads a text file (the project file's `patchExport` block); rejects when it is gone. */
  readText?: ((path: string) => Promise<string>) | undefined;
  /** The finish directories of the work root (`undefined` when there is no work root). */
  getDirs: (workRoot: string | undefined) => PatchFinishDirs | undefined;
  /** The stores the project file may be archived into (userData / the installation folder). */
  getProjectStores: () => Promise<PatchFinishProjectStores>;
  /** Scan everything under the work directory (relative entries; no symlink following). */
  scanWorkDir: (dir: string) => Promise<PatchWorkDirEntry[]>;
  /**
  Which of these files another window is playing right now? (fork-owned; the result claims)

  A job moves and deletes the results, which fails on Windows while a player holds one open and
  would otherwise be an unclear "file in use" error. Asking first lets the dialog say why. Omitted
  by callers without claims (there is nothing in use then).
  */
  findFilesInUse?: ((paths: readonly string[]) => Promise<string[]>) | undefined;
  /** Does the file system ignore case for paths? (Windows / macOS) */
  caseInsensitive: boolean;
  /** The configured folder names (the work-area check must use the same ones as the job). */
  dirNames?: PatchDirNames | undefined;
}

/**
Stat one file, telling "gone" (ENOENT) apart from "there, but unreadable" (permissions, a lock).

The difference matters: a file the user moved is simply not there, while a locked file is still
part of the job - reporting it as missing would hide the real cause.
*/
async function statFile(path: string, deps: PatchFinishPreviewDeps): Promise<{ ref?: PatchFinishFileRef, unreadable: boolean }> {
  try {
    const { size, mtimeMs } = await deps.stat(path);
    return { ref: { path, size, mtimeMs }, unreadable: false };
  } catch (error) {
    const code = typeof error === 'object' && error != null ? (error as { code?: unknown }).code : undefined;
    return { unreadable: code !== 'ENOENT' };
  }
}

async function listFolderMediaFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && hasPatchMediaExtension(entry.name))
    .map((entry) => join(dir, entry.name));
}

/**
The source's results that already left the work area (fork-owned).

Context for the finish dialog only: the job never moves, deletes or touches these files. They come
from `finished_clips`, filtered by the source's name. The project file's `patchExport` names the
segment of each result of the last finished job, so a result this export cuts again is left out -
its old copy is still on the disk, and counting it would add up to more segments than the cut list
has.
*/
async function listFinishedClips({ dir, sourcePath, projectPath, selectedSegIds, caseInsensitive, deps }: {
  dir: string | undefined;
  sourcePath: string;
  projectPath: string;
  selectedSegIds: readonly string[] | undefined;
  caseInsensitive: boolean;
  deps: PatchFinishPreviewDeps;
}): Promise<PatchFinishFileRef[]> {
  if (dir == null) return [];

  let paths: readonly string[];
  try {
    paths = await (deps.listMediaFiles ?? listFolderMediaFiles)(dir);
  } catch {
    // Not created yet, or unreadable: the dialog simply shows no finished results.
    return [];
  }

  const nameKey = (path: string) => {
    const name = getPathFileName(path);
    return caseInsensitive ? name.toLowerCase() : name;
  };

  const reCut = new Set<string>();
  if (selectedSegIds != null && selectedSegIds.length > 0) {
    try {
      const extras = readProjectExtras(await (deps.readText ?? ((path: string) => readFile(path, 'utf8')))(projectPath));
      const selected = new Set(selectedSegIds);
      for (const output of parsePatchProjectClipOutputs(extras['patchExport'])) {
        if (output.segId != null && selected.has(output.segId)) reCut.add(nameKey(output.path));
      }
    } catch {
      // No project file (or an unreadable one): there is nothing to exclude.
    }
  }

  const sourceStem = getPathStem(sourcePath);
  const refs: PatchFinishFileRef[] = [];
  for (const path of paths) {
    if (reCut.has(nameKey(path))) continue;
    if (!isResultNameOfSource(getPathStem(path), sourceStem, { caseInsensitive })) continue;
    // eslint-disable-next-line no-await-in-loop
    const { ref } = await statFile(path, deps);
    if (ref != null) refs.push(ref);
  }
  return refs;
}

export async function buildPatchFinishPreview(
  params: PatchFinishPreviewParams,
  deps: PatchFinishPreviewDeps,
): Promise<PatchFinishPreview> {
  const dirs = deps.getDirs(params.workRoot);
  if (dirs == null) throw new Error('No working directory configured');
  const projectStores = await deps.getProjectStores();

  const warnings: PatchFinishWarning[] = [];
  const { caseInsensitive } = deps;

  const source = await statFile(params.sourcePath, deps);
  const sourceRef = source.ref;
  const insideWorkArea = isInsideWorkArea(params.sourcePath, deps.dirNames ?? defaultPatchDirNames);
  if (sourceRef == null) warnings.push(source.unreadable ? 'source-unreadable' : 'source-missing');
  if (insideWorkArea) warnings.push('source-inside-work-area');

  // The project file the cutting window would load (it may live in the upstream output directory).
  const projectPath = params.projectFilePath ?? `${getParentPath(params.sourcePath)}/${getProjectFileName(params.sourcePath)}`;
  const project = await statFile(projectPath, deps);
  const projectRef = project.ref;
  // The project file is not part of the job's source of truth: when it is there but unreadable, the
  // job leaves it alone. Say so instead of showing "no project file" (which sounds like "nothing to
  // move" while a `.llc` actually sits next to the video).
  if (projectRef == null && project.unreadable) warnings.push('project-unreadable');

  const manifest = await deps.readManifest(params.workRoot);
  const recordKey = findManifestFileKey(manifest.files, params.sourcePath, { caseInsensitive });
  const record = recordKey != null ? manifest.files[recordKey] : undefined;
  if (record == null) warnings.push('no-record');

  const merged = record?.merged != null ? await statFile(record.merged.path, deps) : undefined;
  const mergedRef = merged?.ref;
  if (record?.merged != null && mergedRef == null) warnings.push(merged?.unreadable === true ? 'merged-unreadable' : 'merged-missing');
  // Only a result inside `merged/` may be deleted. A merged file that lives elsewhere (renamed by
  // hand, or left behind by a partially finished job) can still be moved, but not deleted here.
  const mergedInsideWorkArea = mergedRef != null && isPathInside(mergedRef.path, dirs.mergedDir, { caseInsensitive });
  if (mergedRef != null && !mergedInsideWorkArea) warnings.push('merged-outside-work-area');
  const clips: PatchFinishClipRef[] = [];
  /** The results as the merge saw them, so they can be compared with the merge's own record. */
  const presentClips: PatchMergeInputClip[] = [];
  let outsideClipCount = 0;
  let unreadableClipCount = 0;
  let missingClipCount = 0;
  let missingSelectedClipCount = 0;
  // The last export's selection (`order`) separates this job's results from the ones earlier passes
  // left behind. It is known before the loop below, because a missing result of this export is the
  // one that matters (see `missingSelectedClipCount`).
  const selectedSegIds = record?.order;
  const isSelectedClip = (segId: string | undefined) => {
    if (selectedSegIds == null || selectedSegIds.length === 0) return true;
    // An identity-less result cannot be proven stale, so it counts as part of this export.
    return segId == null || selectedSegIds.includes(segId);
  };
  // Every result the manifest still tracks, not only the ones of the last export: a job that kept
  // its cut results (`clips: keep`) left them in `clips/`, and a later export of other segments must
  // not hide them - they would never be moved or deleted and the work area could never be cleaned.
  for (const clip of listTrackedClips(record)) {
    // Only the results inside this work area may ever be deleted or moved: the manifest can point
    // anywhere (a renamed result, a source from another work root), so the work area is the gate.
    if (!isPathInside(clip.path, dirs.clipsDir, { caseInsensitive })) {
      outsideClipCount += 1;
      // eslint-disable-next-line no-continue
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const clipStat = await statFile(clip.path, deps);
    if (clipStat.ref != null) {
      // The rename rule (`features/patchFinish/cutRename`) renders `{label}` / `{cut_from}` /
      // `{cut_to}` from these, so the dialog can show the finished names before the move.
      clips.push({ ...clipStat.ref, segId: clip.segId, ...(clip.label !== undefined && { label: clip.label }), start: clip.start, end: clip.end });
      presentClips.push({ segId: clip.segId, start: clip.start, end: clip.end, signature: clip.signature, tail: clip.tail });
    } else if (clipStat.unreadable) unreadableClipCount += 1;
    else {
      missingClipCount += 1;
      // A result of this export that is gone is the one that can lose a record (it would have been
      // an output). The results of earlier passes are never moved, so a missing one is harmless.
      if (isSelectedClip(clip.segId)) missingSelectedClipCount += 1;
    }
  }
  if (outsideClipCount > 0) warnings.push('clips-outside-work-area');
  // An unreadable cut result is not in `clips`, so the merge coverage below cannot see it: say so
  // instead of silently planning the job without it.
  if (unreadableClipCount > 0) warnings.push('clips-unreadable');
  // A result that disappeared from its recorded path is not in `clips` either. That may be a file
  // the user deleted, but it may also be a result a previous attempt already moved: the dialog must
  // say so instead of quietly writing a project file that no longer records it.
  if (missingClipCount > 0) warnings.push('clips-missing');

  // Is another window playing one of these files? One batched question for the whole job (the claim
  // store reads only the claim files of these paths), and only if there is anything to check.
  const filesToCheck = [...clips.map((clip) => clip.path), ...(mergedRef != null ? [mergedRef.path] : [])];
  const filesInUse = filesToCheck.length > 0 && deps.findFilesInUse != null ? await deps.findFilesInUse(filesToCheck) : [];

  // Only this export's results are the merge's inputs: a stale result is deleted by its own step
  // (or kept), never as part of "did the merge cover what this job deletes".
  const selectedPresentClips = presentClips.filter((clip) => isSelectedClip(clip.segId));
  const newestSelectedClipMtime = clips
    .filter((clip) => isSelectedClip(clip.segId))
    .reduce((newest, clip) => Math.max(newest, clip.mtimeMs), 0);
  // What the merge recorded is the evidence: file timestamps cannot tell the order in which files
  // were written once the work area was copied or restored (the merge may well be the newest file
  // and still carry an older timestamp). Only a merge recorded before the inputs were kept falls
  // back to the timestamps.
  // The question is "does the merged file contain every result this job would delete?", so the
  // results of this export count - a stale result of an earlier pass is handled by its own choice.
  const mergedCoversClips = mergedRef != null && (selectedPresentClips.length === 0 || (
    record?.merged?.inputs != null
      ? mergedClipsMatchInputs({ inputs: record.merged.inputs, clips: selectedPresentClips })
      : mergedRef.mtimeMs >= newestSelectedClipMtime
  ));
  if (mergedRef != null && !mergedCoversClips) warnings.push('merged-stale');

  const mode = resolveFinishMode(params.mode, { hasMerged: mergedRef != null });

  // The work-area cleanup choice needs to know what else is inside `.losslesscut_work` (a hand-made
  // file must keep the folder). A missing directory is simply empty; any other failure disables the
  // choice instead of guessing.
  let workDirEntries: PatchWorkDirEntry[] = [];
  let workDirScanFailed = false;
  try {
    workDirEntries = await deps.scanWorkDir(dirs.workDir);
  } catch (error) {
    const code = typeof error === 'object' && error != null ? (error as { code?: unknown }).code : undefined;
    if (code !== 'ENOENT') {
      workDirScanFailed = true;
      warnings.push('work-dir-unreadable');
    }
  }

  // Results an earlier finish already moved out of the work area: shown as context, never touched.
  const finishedClips = await listFinishedClips({
    dir: dirs.finishedClipsDir,
    sourcePath: params.sourcePath,
    projectPath,
    selectedSegIds,
    caseInsensitive,
    deps,
  });

  return {
    mode,
    source: {
      path: params.sourcePath,
      size: sourceRef?.size,
      exists: sourceRef != null,
      unreadable: source.unreadable,
      insideWorkArea,
      dir: getParentPath(params.sourcePath),
    },
    projectFile: projectRef != null ? { path: projectRef.path } : undefined,
    merged: mergedRef,
    mergedSegIds: record?.merged?.chapters?.map((chapter) => chapter.segId),
    mergedInsideWorkArea,
    clips,
    selectedSegIds,
    finishedClips,
    clipsTotalSize: clips.reduce((total, clip) => total + clip.size, 0),
    outsideClipCount,
    missingClipCount,
    missingSelectedClipCount,
    filesInUse,
    mergedCoversClips,
    hasRecord: record != null,
    dirs,
    workDirEntries,
    workDirScanFailed,
    projectStores,
    warnings,
  };
}
