import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { buildResumeClipEntries, buildResumeMergedChapters, decideResumeAvailability } from '../../../../common/features/patchResume';
import { collectMergeClips, findManifestFileKey } from '../../../../common/features/patchExport';
import { buildSegmentOrderNumbers } from '../../../../common/features/patchSegmentQueue';
import { resolveWorkRootForPath } from '../../../../common/features/patchFinish';

import getSwal from '../../swal';
import { readExportManifest } from '../patchExport/manifestApi';

const { stat } = window.require('node:fs/promises');

/**
Is the result really playable?

`stat` follows a symlink (a dangling one is not a result), and an empty file is a half-written
one: the export was interrupted before FFmpeg wrote anything, so the window cannot play it.
*/
async function isPresentClip(path: string) {
  try {
    const stats = await stat(path);
    return stats.isFile() && stats.size > 0;
  } catch {
    return false;
  }
}

/**
Resume + toggle the results windows for the current source (fork-owned).

Only the cutting window runs this: results windows have no source to resume. Everything is
read-only (manifest + disk existence); opening reuses the export/merge open path, closing never
touches files or the manifest.
*/
// eslint-disable-next-line import/prefer-default-export -- the slice index re-exports the named hook
export function usePatchResumeWindows({ filePath, workRoot, playerMode, mergedMode, caseInsensitive }: {
  filePath: string | undefined,
  workRoot: string | undefined,
  playerMode: boolean,
  mergedMode: boolean,
  caseInsensitive: boolean,
}) {
  const { t } = useTranslation();

  const showEmpty = useCallback(async () => {
    await getSwal().Swal.fire({
      icon: 'info',
      title: t('No resumable videos'),
      text: t('No cut results or merged results were found for the current file.'),
    });
  }, [t]);

  const loadState = useCallback(async () => {
    if (filePath == null) return undefined;
    // patch: a video that already lives inside a work area belongs to the root that contains it,
    // otherwise reopening a finished source would invent a nested `.losslesscut_work`.
    const workRootResolved = resolveWorkRootForPath({ path: filePath, workRoot });
    const manifest = await readExportManifest(workRootResolved);
    const recordKey = findManifestFileKey(manifest.files, filePath, { caseInsensitive }) ?? filePath;
    const record = manifest.files[recordKey];
    const clips = collectMergeClips(record);
    const presentClips: typeof clips = [];
    for (const clip of clips) {
      // eslint-disable-next-line no-await-in-loop
      if (await isPresentClip(clip.path)) presentClips.push(clip);
    }
    const mergedPath = record?.merged?.path;
    const mergedExists = mergedPath != null && await isPresentClip(mergedPath);
    // patch: the merged record keeps its chapters, so the reopened window shows the same read-only
    // chapter list. A merged file from an older version has none stored: they are rebuilt from the
    // segment records. Their two numbers are always recomputed from the manifest (colored =
    // start-time rank, plain = queue position) - and the queue position follows the order the last
    // export cut, exactly what the cutting window showed for the same segments.
    const sourceNumbers = buildSegmentOrderNumbers(clips.map((clip) => ({
      segId: clip.segId,
      start: clip.start,
      end: clip.end,
      selected: true,
    })));
    const mergedChapters = buildResumeMergedChapters({
      storedChapters: record?.merged?.chapters,
      // patch: the records, not the files on disk - a merged-only record has no clips left, but its
      // chapters still describe what the merged file is made of.
      clips,
      numbers: sourceNumbers,
    });
    const entries = buildResumeClipEntries(
      Object.fromEntries(presentClips.map((clip: { segId: string, start: number, end: number, label?: string | undefined, path: string }) => [clip.segId, { start: clip.start, end: clip.end, label: clip.label, path: clip.path }])),
      filePath,
      // The queue order the last export cut in: the playlist must not silently fall back to start
      // times, or the clips window would show another order than the merge used.
      clips.map((clip) => clip.segId),
    );
    return {
      presentClips,
      entries,
      mergedPath: mergedExists ? mergedPath : undefined,
      mergedChapters: mergedExists && mergedChapters.length > 0 ? mergedChapters : undefined,
      availability: decideResumeAvailability({ clipCount: entries.length, mergedExists }),
    };
  }, [caseInsensitive, filePath, workRoot]);

  const resumeWindows = useCallback(async () => {
    if (playerMode || mergedMode) return;
    if (filePath == null) {
      await showEmpty();
      return;
    }
    const state = await loadState();
    if (state?.availability == null) {
      await showEmpty();
      return;
    }
    if (state.availability.hasClips) {
      await window.electron.patchOpenClipsResult(state.entries);
    }
    if (state.availability.hasMerged && state.mergedPath != null) {
      await window.electron.patchOpenMergedResult({
        path: state.mergedPath,
        sourcePath: filePath,
        ...((state.mergedChapters != null) && { mergedChapters: state.mergedChapters }),
      });
    }
  }, [filePath, loadState, mergedMode, playerMode, showEmpty]);

  const toggleClipsWindow = useCallback(async () => {
    if (playerMode || mergedMode) return;
    if (await window.electron.patchIsClipsWindowOpen()) {
      await window.electron.patchCloseClipsWindow();
      return;
    }
    if (filePath == null) {
      await showEmpty();
      return;
    }
    const state = await loadState();
    if (!state?.availability?.hasClips) {
      await showEmpty();
      return;
    }
    await window.electron.patchOpenClipsResult(state.entries);
  }, [filePath, loadState, mergedMode, playerMode, showEmpty]);

  const toggleMergedWindow = useCallback(async () => {
    if (playerMode || mergedMode) return;
    if (await window.electron.patchIsMergedWindowOpen()) {
      await window.electron.patchCloseMergedWindow();
      return;
    }
    if (filePath == null) {
      await showEmpty();
      return;
    }
    const state = await loadState();
    if (state == null || !state.availability?.hasMerged || state.mergedPath == null) {
      await showEmpty();
      return;
    }
    await window.electron.patchOpenMergedResult({
      path: state.mergedPath,
      sourcePath: filePath,
      ...((state.mergedChapters != null) && { mergedChapters: state.mergedChapters }),
    });
  }, [filePath, loadState, mergedMode, playerMode, showEmpty]);

  return { resumeWindows, toggleClipsWindow, toggleMergedWindow };
}
