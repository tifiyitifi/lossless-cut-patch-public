import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactEventHandler, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import screenfull from 'screenfull';

import type { PatchProject, PatchVideoFile } from '../../../../../common/features/patchData';
import { getPatchCutTemplate, patchProjectVersion, serializePatchProject, srcTxtToProject } from '../../../../../common/features/patchData';
import type { PatchPlayerView } from '../../../../../common/features/patchMerge';
import { availablePatchPlayerViews, buildClipPlaylist, stepPatchPlayerView } from '../../../../../common/features/patchMerge';
import type { PatchSourcePostAction } from '../../../../../common/features/patchData/settings';
import type { PatchSegmentOperation } from '../../../../../common/features/patchData/segmentOperations';
import type { PatchFileOperation, PatchFileOperationParams } from '../../../../../common/features/patchData/fileOperations';
import { appendNameSuffix } from '../../../../../common/features/patchData/naming';
import { exportEdlFile, askForEdlImport } from '../../../edlStore';
import type { FFprobeFormat, FFprobeStream } from '../../../../../common/ffprobe';
import ErrorDialog from '../../../components/ErrorDialog';
import GenericDialog, { useDialog } from '../../../components/GenericDialog';
import { UserSettingsContext } from '../../../contexts';
import type { UserSettingsContextType } from '../../../contexts';
import { showOpenDialog } from '../../../dialogs';
import { getDefaultOutFormat, getStreamFps, readFileFfprobeMeta } from '../../../ffmpeg';
import useErrorHandling from '../../../hooks/useErrorHandling';
import useFfmpegOperations from '../../../hooks/useFfmpegOperations';
import useFrameCapture from '../../../hooks/useFrameCapture';
import useLoading from '../../../hooks/useLoading';
import useSegments from '../../../hooks/useSegments';
import useTimecode from '../../../hooks/useTimecode';
import useUserSettingsRoot from '../../../hooks/useUserSettingsRoot';
import useVideo from '../../../hooks/useVideo';
import mainApi from '../../../mainApi';
import { isDurationValid, sortSegments, hasAnySegmentOverlap, convertSegmentsToChaptersWithGaps, getPlaybackAction, filterNonMarkers } from '../../../segments';
import getSwal, { errorToast } from '../../../swal';
import { getOutDir } from '../../../util';
import { defaultCutFileTemplate, generateCutFileNames } from '../../../util/outputNameTemplate';
import type { Chapter, PlaybackMode, SegmentToExport } from '../../../types';
import { getAudioStreams, getRealVideoStreams, isMatroska } from '../../../util/streams';
import { usePatchSettingsContext } from '../settings/patchSettingsContext';
import { PatchSessionContext } from './patchSessionContext';
import type { PatchSessionValue } from './patchSessionContext';

const { lossyMode, pathToFileURL } = window.require('@electron/remote').require('./index.js');
const { readFile, writeFile } = window.require('node:fs/promises');
const { basename, dirname, join } = window.require('node:path');

const emptyAudioStreamIndexes = new Set<number>();

export default function PatchSessionProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();

  const {
    settings: patchSettings, update: updatePatchSettings, keyBindings: patchKeyBindings,
    setKeyBinding: setPatchKeyBinding, resetKeyBindings: resetPatchKeyBindings,
  } = usePatchSettingsContext();
  const userSettings = useUserSettingsRoot();
  const { settings, setPlaybackVolume } = userSettings;
  const {
    invertCutSegments, segmentsToChaptersOnly, simpleMode, ffmpegHwaccel, safeOutputFileName,
    keyframeCut, ffmpegExperimental, enableOverwriteOutput, preserveMetadata, preserveMetadataOnMerge,
    preserveMovData, preserveChapters, movFastStart, avoidNegativeTs, outputFileNameMinZeroPadding,
    treatInputFileModifiedTimeAsStart, treatOutputFileModifiedTimeAsStart, cutFileTemplate,
    cutFromAdjustmentFrames, cutToAdjustmentFrames, captureFormat, captureFrameQuality, captureFrameMethod,
  } = settings;

  /**
   * Patch reuses the upstream settings dialog, which reads everything from `UserSettingsContext`.
   * The toggles below live in base mode's `App` component (they flip a setting and show a
   * notification); patch provides the same flips without the notifications, and no-ops for the two
   * fields only used by base-mode components patch does not render.
   */
  const userSettingsContextValue = useMemo<UserSettingsContextType>(() => {
    const { settings: rootSettings, ...rest } = userSettings;
    return {
      ...rootSettings,
      ...rest,
      toggleCaptureFormat: () => rest.setCaptureFormat((format) => (format === 'jpeg' ? 'png' : 'jpeg')),
      changeOutDir: async () => undefined,
      toggleKeyframeCut: () => rest.setKeyframeCut((value) => !value),
      toggleExportConfirmEnabled: () => rest.setExportConfirmEnabled((value) => !value),
      toggleSimpleMode: () => rest.setSimpleMode((value) => !value),
      toggleSafeOutputFileName: () => rest.setSafeOutputFileName((value) => !value),
      effectiveExportMode: rootSettings.segmentsToChaptersOnly
        ? 'segments_to_chapters'
        : (rootSettings.autoMerge ? 'merge+separate' : 'separate'),
      ensureWritableOutDirWithFilePath: async () => undefined,
    };
  }, [userSettings]);

  const [filePath, setFilePath] = useState<string>();
  const [fileDuration, setFileDuration] = useState<number>();
  const [detectedFps, setDetectedFps] = useState<number>();
  const [formatName, setFormatName] = useState<string>();
  const [ffprobeFormat, setFfprobeFormat] = useState<FFprobeFormat>();
  const [videoStreams, setVideoStreams] = useState<FFprobeStream[]>([]);
  const [audioStreams, setAudioStreams] = useState<FFprobeStream[]>([]);
  const [allStreams, setAllStreams] = useState<FFprobeStream[]>([]);
  const [progress, setProgress] = useState<number>();
  const [exportCount, setExportCount] = useState(0);
  const [exportedPaths, setExportedPaths] = useState<string[]>([]);
  const [videoFiles, setVideoFiles] = useState<PatchVideoFile[]>([]);
  const [playerView, setPlayerViewState] = useState<PatchPlayerView>('source');
  const [previewIndex, setPreviewIndex] = useState(0);
  const [mergedPath, setMergedPath] = useState<string>();
  const [scanToken, setScanToken] = useState(0);

  const { working, setWorking, workingRef, abortWorking } = useLoading();
  const { handleError, genericError, setGenericError, withErrorHandling } = useErrorHandling();
  const { showGenericDialog, genericDialog, closeGenericDialog, confirmDialog } = useDialog();
  const { formatTimecode, parseTimecode, timecodePlaceholder, getFrameCount } = useTimecode({ detectedFps, timecodeFormat: settings.timecodeFormat, showGenericDialog });

  const {
    videoRef, videoContainerRef,
    playing, playbackRate, relevantTime, getRelevantTime,
    play, pause, seekAbs, seekRel, setPlaybackRate,
    setPlaying, playingRef, setCommandedTime, commandedTimeRef,
    setPlaybackMode, playbackModeRef,
    playerTime, setPlayerTime, outputPlaybackRate,
    onStartPlaying, onStopPlaying, onVideoAbort, onSeeked,
  } = useVideo({ filePath });

  const videoStream = videoStreams[0];
  const fileDurationNonZero = isDurationValid(fileDuration) ? fileDuration : 1;
  const mainFileMeta = ffprobeFormat != null ? { format: ffprobeFormat } : undefined;

  const isFileOpened = filePath != null;
  const checkFileOpened = useCallback(() => {
    if (isFileOpened) return true;
    getSwal().toast.fire({ icon: 'info', title: t('You need to open a media file first') });
    return false;
  }, [isFileOpened, t]);

  const appendLastCommandsLog = useCallback((command: string) => {
    console.log('[patch]', command);
  }, []);

  const appendFfmpegCommandLog = useCallback((args: string[]) => {
    console.log('[patch] ffmpeg', args.join(' '));
  }, []);

  const {
    cutSegments,
    currentSegIndexSafe,
    currentCutSeg,
    setCurrentSegIndex,
    addSegment,
    setCutStart,
    setCutEnd,
    removeSegment,
    splitCurrentSegment,
    clearSegments,
    maybeCreateFullLengthSegment,
    haveInvalidSegs,
    segmentsToExport,
    segmentsOrInverse,
    selectedSegments,
    selectAllSegments,
    deselectAllSegments,
    toggleCurrentSegmentSelected,
    toggleSegmentSelected,
    invertSelectedSegments,
    findSegmentsAtCursor,
    detectBlackScenes,
    detectSilentScenes,
    detectSceneChanges,
    createSegmentsFromKeyframes,
    invertAllSegments,
    fillSegmentsGaps,
    combineOverlappingSegments,
    reorderSegsByStartTime,
    loadCutSegments,
  } = useSegments({
    filePath,
    workingRef,
    setWorking,
    setProgress,
    videoStream,
    fileDuration,
    getRelevantTime,
    maxLabelLength: safeOutputFileName ? 100 : 500,
    checkFileOpened,
    invertCutSegments,
    segmentsToChaptersOnly,
    timecodePlaceholder,
    parseTimecode,
    appendFfmpegCommandLog,
    fileDurationNonZero,
    mainFileMeta,
    seekAbs,
    activeVideoStreamIndex: videoStream?.index,
    activeAudioStreamIndexes: emptyAudioStreamIndexes,
    handleError,
    showGenericDialog,
    simpleMode,
    ffmpegHwaccel,
  });

  const {
    cutMultiple, concatCutSegments, fixInvalidDuration, extractStreams, html5ify, decimate, concatFiles,
  } = useFfmpegOperations({
    filePath,
    treatInputFileModifiedTimeAsStart,
    treatOutputFileModifiedTimeAsStart,
    isEncoding: lossyMode != null,
    lossyMode,
    enableOverwriteOutput,
    outputPlaybackRate,
    cutFromAdjustmentFrames,
    cutToAdjustmentFrames,
    appendLastCommandsLog,
    encCustomBitrate: undefined,
    appendFfmpegCommandLog,
    ffmpegHwaccel,
  });

  // Upstream's frame capture, reused verbatim. Snapshots land in the work directory (falling back
  // to the source directory) so the batch output stays together.
  const { captureFrameFromTag, captureFrameFromFfmpeg, captureFrameToClipboard } = useFrameCapture({
    appendFfmpegCommandLog, formatTimecode, treatInputFileModifiedTimeAsStart, treatOutputFileModifiedTimeAsStart, fileDuration,
  });

  const captureSnapshot = useCallback(async () => {
    if (filePath == null || workingRef.current) return;
    try {
      setWorking({ text: t('Exporting') });

      await withErrorHandling(async () => {
        const currentTime = getRelevantTime();
        const video = videoRef.current;
        if (video == null) throw new Error('No video element');
        const outPath = captureFrameMethod === 'ffmpeg'
          ? await captureFrameFromFfmpeg({ customOutDir: patchSettings.workDir, filePath, time: currentTime, captureFormat, quality: captureFrameQuality })
          : await captureFrameFromTag({ customOutDir: patchSettings.workDir, filePath, time: currentTime, captureFormat, quality: captureFrameQuality, video });

        getSwal().toast.fire({ icon: 'success', text: t('Screenshot captured to: {{path}}', { path: outPath }) });
      }, t('Failed to capture frame'));
    } finally {
      setWorking(undefined);
    }
  }, [captureFormat, captureFrameFromFfmpeg, captureFrameFromTag, captureFrameMethod, captureFrameQuality, filePath, getRelevantTime, patchSettings.workDir, setWorking, t, videoRef, withErrorHandling, workingRef]);

  const captureSnapshotToClipboard = useCallback(async () => {
    if (filePath == null || workingRef.current) return;
    try {
      setWorking({ text: t('Exporting') });

      await withErrorHandling(async () => {
        await captureFrameToClipboard({ filePath, time: getRelevantTime(), quality: captureFrameQuality });
        getSwal().toast.fire({ icon: 'info', title: t('Screenshot captured clipboard') });
      }, t('Failed to capture frame'));
    } finally {
      setWorking(undefined);
    }
  }, [captureFrameQuality, captureFrameToClipboard, filePath, getRelevantTime, setWorking, t, withErrorHandling, workingRef]);

  const cut = useCallback(async (): Promise<string[]> => {
    if (filePath == null || fileDuration == null || ffprobeFormat == null || formatName == null) {
      errorToast(t('You need to open a media file first'));
      return [];
    }
    if (segmentsToExport.length === 0 && !segmentsToChaptersOnly) {
      getSwal().toast.fire({ icon: 'info', text: t('No segments to export') });
      return [];
    }
    if (haveInvalidSegs) {
      errorToast(t('Start time must be before end time'));
      return [];
    }
    if (workingRef.current) return [];

    // Chapters-only mode: copy the whole file once and write the marked segments as chapter
    // metadata instead of cutting (upstream's "chapters only" export mode). `cutMultiple` turns the
    // empty segment list into a single whole-file segment.
    let chapters: Chapter[] | undefined;
    let segmentsForCut: SegmentToExport[] = segmentsToExport;
    let projectSegments: { start: number, end: number }[] = segmentsToExport;
    if (segmentsToChaptersOnly) {
      const sortedSegments = sortSegments(segmentsOrInverse.selected);
      if (hasAnySegmentOverlap(sortedSegments)) {
        errorToast(t('Make sure you have no overlapping segments.'));
        return [];
      }
      // Matroska supports gaps, so the segments can be used as-is; other containers need the gaps
      // filled in with generated chapters.
      chapters = isMatroska(formatName) ? sortedSegments : convertSegmentsToChaptersWithGaps(sortedSegments);
      segmentsForCut = [];
      projectSegments = sortedSegments;
    }

    const outputDir = getOutDir(patchSettings.workDir, filePath) ?? dirname(filePath);
    const template = getPatchCutTemplate(patchSettings.namingPreset, cutFileTemplate ?? defaultCutFileTemplate);
    const maxLabelLength = safeOutputFileName ? 100 : 500;

    try {
      setWorking({ text: t('Exporting') });
      setExportedPaths([]);

      const { fileNames, problems } = await generateCutFileNames({
        fileDuration,
        segmentsToExport,
        template,
        formatTimecode,
        isCustomFormatSelected: false,
        fileFormat: formatName,
        sourceFile: { path: filePath },
        outputDir,
        safeOutputFileName,
        maxLabelLength,
        outputFileNameMinZeroPadding,
        exportCount,
        currentFileExportCount: 0,
      });
      if (problems.error != null) console.warn('Output file name invalid', problems.error);

      const outFiles = await cutMultiple({
        outputDir,
        customOutDir: undefined,
        outFormat: formatName,
        fileDuration,
        rotation: undefined,
        copyFileStreams: [{ path: filePath, streamIds: allStreams.map((stream) => stream.index) }],
        allFilesMeta: { [filePath]: { streams: allStreams, format: ffprobeFormat, chapters: [] } },
        keyframeCut,
        segments: segmentsForCut,
        cutFileNames: fileNames,
        onProgress: setProgress,
        shortestFlag: false,
        ffmpegExperimental,
        preserveMetadata,
        preserveMetadataOnMerge,
        preserveMovData,
        preserveChapters,
        movFastStart,
        avoidNegativeTs,
        paramsByFile: new Map(),
        chapters,
        detectedFps,
      });

      const paths = outFiles.map((file) => file.path);
      setExportedPaths(paths);
      setMergedPath(undefined);

      // Write the patch data file (JSON) next to the outputs.
      const now = new Date().toISOString();
      const project: PatchProject = {
        version: patchProjectVersion,
        createdAt: now,
        updatedAt: now,
        groups: [{
          merge: false,
          segments: projectSegments.map((segment) => ({ file: basename(filePath), start: segment.start, end: segment.end })),
        }],
      };
      const projectPath = join(outputDir, `${basename(filePath).replace(/\.[^.]+$/, '')}.patch.json`);
      await writeFile(projectPath, serializePatchProject(project), 'utf8');

      getSwal().toast.fire({ icon: 'success', text: t('Exported {{n}} files', { n: paths.length }) });
      return paths;
    } catch (err) {
      handleError({ title: t('The operation failed'), err });
      return [];
    } finally {
      setWorking(undefined);
      setProgress(undefined);
      setExportCount((count) => count + 1);
    }
  }, [allStreams, avoidNegativeTs, cutFileTemplate, cutMultiple, detectedFps, exportCount, ffmpegExperimental, ffprobeFormat, fileDuration, filePath, formatName, formatTimecode, handleError, haveInvalidSegs, keyframeCut, movFastStart, outputFileNameMinZeroPadding, patchSettings.namingPreset, patchSettings.workDir, preserveChapters, preserveMetadata, preserveMetadataOnMerge, preserveMovData, safeOutputFileName, segmentsOrInverse, segmentsToChaptersOnly, segmentsToExport, setProgress, setWorking, t, workingRef]);

  const removeCurrentSegment = useCallback(() => removeSegment(currentSegIndexSafe), [currentSegIndexSafe, removeSegment]);

  /**
   * Run one of the upstream segment operations patch exposes in its console / palette. The
   * operations themselves are upstream's; patch only adds the keyboard-driven entry point.
   */
  const runSegmentOperation = useCallback(async (operation: PatchSegmentOperation) => {
    try {
      switch (operation) {
        case 'detect-black-scenes': { await detectBlackScenes(); break; }
        case 'detect-silent-scenes': { await detectSilentScenes(); break; }
        case 'detect-scene-changes': { await detectSceneChanges(); break; }
        case 'segments-from-keyframes': { await createSegmentsFromKeyframes(); break; }
        case 'invert-segments': { invertAllSegments(); break; }
        case 'fill-segment-gaps': { fillSegmentsGaps(); break; }
        case 'combine-overlapping-segments': { combineOverlappingSegments(); break; }
        case 'reorder-segments': { reorderSegsByStartTime(); break; }
        default: { break; }
      }
    } catch (err) {
      handleError({ title: t('The operation failed'), err });
    }
  }, [combineOverlappingSegments, createSegmentsFromKeyframes, detectBlackScenes, detectSceneChanges, detectSilentScenes, fillSegmentsGaps, handleError, invertAllSegments, reorderSegsByStartTime, t]);

  /**
   * Run one of the upstream file operations patch exposes in its console / palette. Outputs are
   * written like the rest of patch (work directory, predictable suffixes).
   */
  const runFileOperation = useCallback(async (operation: PatchFileOperation, params: PatchFileOperationParams = {}) => {
    // The two batch operations work on the media files of the work directory instead of the open file.
    const isBatch = operation === 'concat-batch' || operation === 'convert-batch';
    if (!isBatch && filePath == null) {
      errorToast(t('You need to open a media file first'));
      return;
    }

    const batchPaths = isBatch ? videoFiles.map((file) => file.path) : [];
    const outputDir = filePath != null ? (getOutDir(patchSettings.workDir, filePath) ?? dirname(filePath)) : undefined;
    const batchOutDir = patchSettings.workDir ?? (batchPaths[0] != null ? dirname(batchPaths[0]) : undefined);

    try {
      switch (operation) {
        case 'fix-invalid-duration': {
          if (filePath == null || outputDir == null) return;
          setWorking({ text: t('Fixing file') });
          setProgress(0);
          const outPath = join(outputDir, appendNameSuffix(basename(filePath), '_fixed'));
          await fixInvalidDuration({ filePath, outPath, onProgress: setProgress });
          getSwal().toast.fire({ icon: 'success', text: t('Wrote {{path}}', { path: outPath }) });
          break;
        }
        case 'extract-all-streams': {
          setWorking({ text: t('Extracting all streams') });
          setProgress(0);
          const paths = await extractStreams({ customOutDir: patchSettings.workDir, streams: allStreams });
          getSwal().toast.fire({ icon: 'success', text: t('Extracted {{n}} files', { n: paths.length }) });
          break;
        }
        case 'html5ify': {
          if (filePath == null) return;
          setWorking({ text: t('Converting to supported format') });
          setProgress(0);
          const outPath = await html5ify({
            customOutDir: patchSettings.workDir,
            filePath,
            speed: params.speed ?? 'fast-audio-remux',
            hasAudio: audioStreams.length > 0,
            hasVideo: videoStreams.length > 0,
            onProgress: setProgress,
          });
          getSwal().toast.fire({ icon: 'success', text: t('Wrote {{path}}', { path: outPath }) });
          break;
        }
        case 'decimate': {
          if (filePath == null || outputDir == null) return;
          setWorking({ text: t('Decimating video') });
          setProgress(0);
          const outPath = join(outputDir, appendNameSuffix(basename(filePath), '_decimated'));
          await decimate({ filePath, outPath, n: params.n ?? 1, fps: params.fps ?? (detectedFps ?? 20) });
          getSwal().toast.fire({ icon: 'success', text: t('Wrote {{path}}', { path: outPath }) });
          break;
        }
        case 'export-cut-list': {
          if (filePath == null) return;
          const markedSegments = cutSegments.filter((segment) => !segment.initial);
          if (markedSegments.length === 0) {
            getSwal().toast.fire({ icon: 'info', text: t('No segments to export') });
            return;
          }
          setWorking({ text: t('Exporting') });
          // Upstream's exporter asks for the destination file itself.
          await exportEdlFile({
            type: params.format ?? 'csv',
            cutSegments: markedSegments,
            customOutDir: patchSettings.workDir,
            filePath,
            getFrameCount,
          });
          break;
        }
        case 'import-cut-list': {
          if (filePath == null || fileDuration == null) return;
          const segments = await askForEdlImport({
            type: params.importFormat ?? 'csv',
            fps: detectedFps,
            fileDuration,
          });
          if (segments.length === 0) return;
          // Imported markers have no end time; they cannot be loaded as segments.
          const loadable = segments.flatMap((segment) => (
            'end' in segment && typeof segment.end === 'number' ? [{ start: segment.start, end: segment.end }] : []
          ));
          if (loadable.length === 0) return;
          loadCutSegments({ segments: loadable, append: false, clampDuration: fileDuration });
          getSwal().toast.fire({ icon: 'success', text: t('Imported {{n}} segments', { n: loadable.length }) });
          break;
        }
        case 'concat-batch': {
          if (batchPaths.length < 2) {
            getSwal().toast.fire({ icon: 'info', text: t('The work directory needs at least two media files') });
            return;
          }
          const [first] = batchPaths;
          if (first == null || batchOutDir == null) return;
          const outPath = join(batchOutDir, appendNameSuffix(basename(first), '_concat'));
          const confirmed = await confirmDialog({
            focusConfirm: true,
            description: t('Concatenate {{n}} files from the work directory into one?', { n: batchPaths.length }),
            confirmButtonText: t('Confirm'),
          });
          if (!confirmed) return;

          const firstMeta = await readFileFfprobeMeta(first);
          const outFormat = await getDefaultOutFormat({ filePath: first, fileMeta: firstMeta });

          setWorking({ text: t('Merging') });
          setProgress(0);
          await concatFiles({
            paths: batchPaths,
            outDir: batchOutDir,
            outPath,
            metadataFromPath: first,
            includeAllStreams: true,
            streams: firstMeta.streams,
            outFormat,
            ffmpegExperimental,
            onProgress: setProgress,
            preserveMovData,
            movFastStart,
            chapters: undefined,
            preserveMetadataOnMerge,
            videoTimebase: undefined,
          });
          getSwal().toast.fire({ icon: 'success', text: t('Wrote {{path}}', { path: outPath }) });
          break;
        }
        case 'convert-batch': {
          if (batchPaths.length === 0) {
            getSwal().toast.fire({ icon: 'info', text: t('The work directory has no media files') });
            return;
          }
          setWorking({ text: t('Converting to supported format') });
          setProgress(0);
          const speed = params.speed ?? 'fast-audio-remux';
          // Probe each file so html5ify knows whether it has audio / video to convert.
          for (const [index, batchPath] of batchPaths.entries()) {
            // eslint-disable-next-line no-await-in-loop
            const meta = await readFileFfprobeMeta(batchPath);
            // eslint-disable-next-line no-await-in-loop
            await html5ify({
              customOutDir: patchSettings.workDir,
              filePath: batchPath,
              speed,
              hasAudio: getAudioStreams(meta.streams).length > 0,
              hasVideo: getRealVideoStreams(meta.streams).length > 0,
              onProgress: (fileProgress) => setProgress((index + fileProgress) / batchPaths.length),
            });
          }
          getSwal().toast.fire({ icon: 'success', text: t('Converted {{n}} files', { n: batchPaths.length }) });
          break;
        }
        default: { break; }
      }
    } catch (err) {
      handleError({ title: t('The operation failed'), err });
    } finally {
      setWorking(undefined);
      setProgress(undefined);
    }
  }, [allStreams, audioStreams.length, concatFiles, confirmDialog, cutSegments, decimate, detectedFps, extractStreams, ffmpegExperimental, fileDuration, filePath, fixInvalidDuration, getFrameCount, handleError, html5ify, loadCutSegments, movFastStart, patchSettings.workDir, preserveMetadataOnMerge, preserveMovData, setProgress, setWorking, t, videoFiles, videoStreams.length]);

  const importSrcTxtDialog = useCallback(async () => {
    if (filePath == null || fileDuration == null) {
      errorToast(t('You need to open a media file first'));
      return;
    }
    const { filePaths } = await showOpenDialog({
      title: t('Import src txt'),
      properties: ['openFile'],
      filters: [{ name: t('Text files'), extensions: ['txt'] }],
    });
    const [srcPath] = filePaths;
    if (srcPath == null) return;

    try {
      const text = await readFile(srcPath, 'utf8');
      const project = srcTxtToProject(text, { sourceTxt: basename(srcPath) });
      const allSegments = project.groups.flatMap((group) => group.segments);
      const targetName = basename(filePath).toLowerCase();
      const matching = allSegments.filter((segment) => segment.file.toLowerCase() === targetName);
      // Prefer segments that reference the current file; fall back to all of them for single-file specs.
      const segments = matching.length > 0 ? matching : allSegments;
      if (segments.length === 0) {
        errorToast(t('No segments found'));
        return;
      }
      loadCutSegments({
        segments: segments.map((segment) => ({ start: segment.start, end: segment.end })),
        append: false,
        clampDuration: fileDuration,
      });
      getSwal().toast.fire({ icon: 'success', text: t('Imported {{n}} segments', { n: segments.length }) });
    } catch (err) {
      handleError({ title: t('Failed to import src txt'), err });
    }
  }, [fileDuration, filePath, handleError, loadCutSegments, t]);

  const openFile = useCallback(async (nextFilePath: string) => {
    // Don't switch files while an operation (e.g. a cut) is running.
    if (workingRef.current) return;
    setWorking({ text: t('Loading') });
    try {
      if (!(await mainApi.pathExists(nextFilePath))) {
        errorToast(t('The media you tried to open does not exist'));
        return;
      }

      const ffprobeMeta = await readFileFfprobeMeta(nextFilePath);
      const nextFormatName = await getDefaultOutFormat({ filePath: nextFilePath, fileMeta: ffprobeMeta });
      if (!nextFormatName) throw new Error('Unable to determine file format');

      const nextVideoStreams = getRealVideoStreams(ffprobeMeta.streams);
      const nextAudioStreams = getAudioStreams(ffprobeMeta.streams);
      const [firstVideoStream] = nextVideoStreams;
      const [firstAudioStream] = nextAudioStreams;
      const nextDuration = parseFloat(ffprobeMeta.format.duration);
      const durationIsValid = isDurationValid(nextDuration);

      // Reset session state before loading the new file.
      setCommandedTime(0);
      setPlaying(false);
      playingRef.current = false;
      setPlaybackRate(1);
      setProgress(undefined);
      setFileDuration(undefined);
      setDetectedFps(undefined);
      setFfprobeFormat(undefined);
      setVideoStreams([]);
      setAudioStreams([]);
      setAllStreams([]);
      setFormatName(undefined);
      // Reset cut segments so the previous file's marks don't leak into the new file.
      clearSegments();
      setCurrentSegIndex(0);
      setFilePath(undefined);
      setPlayerViewState('source');
      setPreviewIndex(0);
      setMergedPath(undefined);

      if (durationIsValid) {
        setFileDuration(nextDuration);
        maybeCreateFullLengthSegment(nextDuration);
      }
      const fpsStream = firstVideoStream ?? firstAudioStream;
      if (fpsStream != null) setDetectedFps(getStreamFps(fpsStream));
      setFfprobeFormat(ffprobeMeta.format);
      setVideoStreams(nextVideoStreams);
      setAudioStreams(nextAudioStreams);
      setAllStreams(ffprobeMeta.streams);
      setFormatName(nextFormatName);

      // This needs to be last, because it triggers <video> to load the video.
      setFilePath(nextFilePath);
      // Remember the file so patch can restore the session next time.
      updatePatchSettings({ lastFilePath: nextFilePath });
    } catch (err) {
      handleError({ title: t('Failed to open file'), err });
    } finally {
      setWorking(undefined);
    }
  }, [clearSegments, handleError, maybeCreateFullLengthSegment, playingRef, setCommandedTime, setCurrentSegIndex, setPlaybackRate, setPlaying, setWorking, t, updatePatchSettings, workingRef]);

  const openFileDialog = useCallback(async () => {
    const { filePaths } = await showOpenDialog({ title: t('Open file'), properties: ['openFile'] });
    const [nextFilePath] = filePaths;
    if (nextFilePath != null) await openFile(nextFilePath);
  }, [openFile, t]);

  const closeFile = useCallback(() => {
    setCommandedTime(0);
    setPlaying(false);
    playingRef.current = false;
    setPlaybackRate(1);
    setProgress(undefined);
    setFileDuration(undefined);
    setDetectedFps(undefined);
    setFfprobeFormat(undefined);
    setVideoStreams([]);
    setAudioStreams([]);
    setAllStreams([]);
    setFormatName(undefined);
    // Reset cut segments as well, otherwise they would leak into the next opened file.
    clearSegments();
    setCurrentSegIndex(0);
    setPlaybackMode(undefined);
    setPlayerViewState('source');
    setPreviewIndex(0);
    setMergedPath(undefined);
    // The video src is driven by JSX, so clearing the path unloads it automatically.
    setFilePath(undefined);
    // Closing the file explicitly ends the remembered session.
    updatePatchSettings({ lastFilePath: undefined });
  }, [clearSegments, playingRef, setCommandedTime, setCurrentSegIndex, setPlaybackMode, setPlaybackRate, setPlaying, updatePatchSettings]);

  // Restore the file that was open the last time patch mode was used (once per app start).
  const restoreAttemptedRef = useRef(false);
  useEffect(() => {
    if (restoreAttemptedRef.current) return;
    restoreAttemptedRef.current = true;
    const { lastFilePath } = patchSettings;
    if (lastFilePath == null) return;
    mainApi.pathExists(lastFilePath)
      .then((exists) => (exists ? openFile(lastFilePath) : undefined))
      .catch((err: unknown) => { console.error('Failed to restore the last file', err); });
  }, [openFile, patchSettings]);

  const refreshVideoFiles = useCallback(() => setScanToken((token) => token + 1), []);

  const currentFileIndex = useMemo(() => videoFiles.findIndex((file) => file.path === filePath), [filePath, videoFiles]);

  const openRelativeFile = useCallback((delta: number) => {
    if (videoFiles.length === 0) return;
    const from = currentFileIndex === -1 ? (delta > 0 ? -1 : 0) : currentFileIndex;
    const nextIndex = (from + delta + videoFiles.length) % videoFiles.length;
    const nextFile = videoFiles[nextIndex];
    if (nextFile != null) openFile(nextFile.path).catch((err: unknown) => { console.error(err); });
  }, [currentFileIndex, openFile, videoFiles]);

  const mergePaths = useCallback(async (segmentPaths: string[]) => {
    if (filePath == null || formatName == null) {
      errorToast(t('You need to open a media file first'));
      return;
    }
    if (segmentPaths.length === 0) {
      getSwal().toast.fire({ icon: 'info', text: t('No clips to merge') });
      return;
    }
    if (workingRef.current) return;

    const outputDir = getOutDir(patchSettings.workDir, filePath) ?? dirname(filePath);
    const mergedOutFilePath = join(outputDir, appendNameSuffix(basename(filePath), '_merged'));

    try {
      setWorking({ text: t('Merging') });
      setProgress(0);
      await concatCutSegments({
        customOutDir: outputDir,
        outFormat: formatName,
        segmentPaths,
        ffmpegExperimental,
        preserveMovData,
        movFastStart,
        onProgress: setProgress,
        chapterNames: undefined,
        preserveMetadataOnMerge,
        mergedOutFilePath,
      });
      setMergedPath(mergedOutFilePath);
      getSwal().toast.fire({ icon: 'success', text: t('Merged {{n}} clips', { n: segmentPaths.length }) });
    } catch (err) {
      handleError({ title: t('The operation failed'), err });
    } finally {
      setWorking(undefined);
      setProgress(undefined);
    }
  }, [concatCutSegments, ffmpegExperimental, filePath, formatName, handleError, movFastStart, patchSettings.workDir, preserveMetadataOnMerge, preserveMovData, setProgress, setWorking, t, workingRef]);

  const merge = useCallback(() => mergePaths(exportedPaths), [exportedPaths, mergePaths]);

  const cutAndMerge = useCallback(async () => {
    const paths = await cut();
    await mergePaths(paths);
  }, [cut, mergePaths]);

  const setSourcePostAction = useCallback((action: PatchSourcePostAction) => {
    updatePatchSettings({ sourcePostAction: action });
  }, [updatePatchSettings]);

  const applySourcePostAction = useCallback(async () => {
    if (filePath == null) return;
    const { sourcePostAction } = patchSettings;
    // `keep` / `skip` do not touch the file.
    if (sourcePostAction === 'keep' || sourcePostAction === 'skip') return;

    try {
      setWorking({ text: t('Processing source file') });
      const result = await mainApi.patchPostProcessSource({
        sourcePath: filePath,
        action: sourcePostAction,
        destDir: patchSettings.workDir,
      });
      if (result.movedTo != null) {
        getSwal().toast.fire({ icon: 'success', text: t('Moved the source file to {{path}}', { path: result.movedTo }) });
      } else {
        getSwal().toast.fire({ icon: 'success', text: t('Removed the source file') });
      }
    } catch (err) {
      handleError({ title: t('The operation failed'), err });
    } finally {
      setWorking(undefined);
    }
  }, [filePath, handleError, patchSettings, setWorking, t]);

  const finishCurrentFile = useCallback(async () => {
    await applySourcePostAction();
    openRelativeFile(1);
  }, [applySourcePostAction, openRelativeFile]);

  // Preview source / view switching. The active view falls back to `source` when it is not
  // available (e.g. after the clips were re-cut), so no effect is needed to keep them in sync.
  const availableViews = useMemo(() => availablePatchPlayerViews({ filePath, exportedPaths }), [exportedPaths, filePath]);
  const activeView = availableViews.includes(playerView) ? playerView : 'source';
  const isSourceView = activeView === 'source';
  const previewPlaylist = useMemo(() => (isSourceView ? [] : buildClipPlaylist(exportedPaths)), [exportedPaths, isSourceView]);
  const previewEntry = previewPlaylist[previewIndex];
  const activeVideoPath = isSourceView ? filePath : previewEntry?.path;

  // The <video> src is driven by JSX (see PlayerPanel) so that the player survives the panel being
  // unmounted/remounted (dockview), instead of relying on an effect that runs only on filePath change.
  const videoUrl = activeVideoPath != null ? pathToFileURL(activeVideoPath).href : undefined;

  const setPlayerView = useCallback((view: PatchPlayerView) => {
    // A selected-segments playback only makes sense on the source timeline.
    setPlaybackMode(undefined);
    setPlayerViewState(view);
    setPreviewIndex(0);
    setCommandedTime(0);
    pause();
  }, [pause, setCommandedTime, setPlaybackMode]);

  const stepPlayerView = useCallback((direction: number) => {
    setPlayerView(stepPatchPlayerView(availableViews, activeView, direction));
  }, [activeView, availableViews, setPlayerView]);

  const onPreviewEnded = useCallback(() => {
    if (isSourceView) return;
    const nextIndex = previewIndex + 1;
    if (nextIndex >= previewPlaylist.length) {
      setPreviewIndex(0);
      pause();
      return;
    }
    setPreviewIndex(nextIndex);
  }, [isSourceView, pause, previewIndex, previewPlaylist.length]);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (videoElement != null) videoElement.volume = settings.playbackVolume;
  }, [settings.playbackVolume, videoRef]);

  // Scan the work directory for media files (used by the video list and prev/next file).
  useEffect(() => {
    const dir = patchSettings.workDir;
    if (dir == null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVideoFiles([]);
      return undefined;
    }
    let cancelled = false;
    mainApi.patchListVideoFiles({ dir })
      .then((files) => { if (!cancelled) setVideoFiles(files); })
      .catch((err: unknown) => { console.error('Failed to scan work directory', err); });
    return () => { cancelled = true; };
  }, [patchSettings.workDir, scanToken]);

  const onDurationChange = useCallback<ReactEventHandler<HTMLVideoElement>>((event) => {
    // Only the source view drives the session's duration / full-length segment; the clip playlist
    // must not overwrite the source file's duration.
    if (!isSourceView) return;
    const { duration } = event.currentTarget;
    if (isDurationValid(duration)) {
      setFileDuration(duration);
      maybeCreateFullLengthSegment(duration);
    }
  }, [isSourceView, maybeCreateFullLengthSegment]);

  const onTimeUpdate = useCallback<ReactEventHandler<HTMLVideoElement>>((event) => {
    const { currentTime } = event.currentTarget;
    if (playerTime === currentTime) return;
    setPlayerTime(currentTime);

    // Special playback modes (e.g. play-selected-segments) jump between segments instead of
    // playing straight through. Ported from base mode's `App` (`onTimeUpdate`); the decision of
    // what to do at a segment boundary is upstream's pure `getPlaybackAction`.
    const segmentsAtCursorIndexes = findSegmentsAtCursor(commandedTimeRef.current);
    const firstSegmentAtCursorIndex = segmentsAtCursorIndexes[0];
    const playingSegment = firstSegmentAtCursorIndex != null ? cutSegments[firstSegmentAtCursorIndex] : undefined;

    if (playbackModeRef.current != null && playingRef.current && playingSegment && playingSegment.end != null) {
      const nextAction = getPlaybackAction({ playbackMode: playbackModeRef.current, currentTime, playingSegment: { start: playingSegment.start, end: playingSegment.end } });

      const exit = () => {
        setPlaybackMode(undefined);
        pause();
      };

      if (nextAction != null) {
        if (nextAction.nextSegment) {
          const selectedSegmentsWithoutMarkers = filterNonMarkers(selectedSegments);

          const index = selectedSegmentsWithoutMarkers.findIndex((selectedSegment) => selectedSegment.segId === playingSegment.segId);
          let newSelectedSegmentIndex = Math.max((index !== -1 ? index : 0) + 1, 0);
          if (newSelectedSegmentIndex > selectedSegmentsWithoutMarkers.length - 1) {
            // have reached end of last segment
            if (playbackModeRef.current === 'loop-selected-segments') newSelectedSegmentIndex = 0; // start over
            else if (playbackModeRef.current === 'play-selected-segments') exit();
          }
          const nextSelectedSegment = selectedSegmentsWithoutMarkers[newSelectedSegmentIndex];
          if (nextSelectedSegment != null) {
            seekAbs(nextSelectedSegment.start);
            const newIndex = cutSegments.findIndex((segment) => segment.segId === nextSelectedSegment.segId);
            if (newIndex !== -1) setCurrentSegIndex(newIndex);
          }
        }
        if (nextAction.seekTo != null) {
          seekAbs(nextAction.seekTo);
        }
        if (nextAction.exit) {
          exit();
        }
      }
    }
  }, [commandedTimeRef, cutSegments, findSegmentsAtCursor, pause, playbackModeRef, playerTime, playingRef, seekAbs, selectedSegments, setCurrentSegIndex, setPlaybackMode, setPlayerTime]);

  const togglePlay = useCallback(({ resetPlaybackRate, requestPlaybackMode }: { resetPlaybackRate?: boolean, requestPlaybackMode?: PlaybackMode } | undefined = {}) => {
    if (activeVideoPath == null) return;
    setPlaybackMode(requestPlaybackMode);

    if (playingRef.current) {
      pause();
      return;
    }

    // If we are using a special playback mode, we might need to do more (ported from base mode):
    if (playbackModeRef.current != null) {
      const selectedSegmentsWithoutMarkers = filterNonMarkers(selectedSegments);
      const atCursor = findSegmentsAtCursor(commandedTimeRef.current ?? getRelevantTime());
      const firstAtCursor = atCursor[0];
      const cursorSegId = firstAtCursor != null ? cutSegments[firstAtCursor]?.segId : undefined;
      const selectedSegmentAtCursor = selectedSegmentsWithoutMarkers.find((selectedSegment) => selectedSegment.segId === cursorSegId);
      const isSomeSegmentAtCursor = selectedSegmentAtCursor != null && commandedTimeRef.current != null && selectedSegmentAtCursor.end != null && selectedSegmentAtCursor.end - commandedTimeRef.current > 0.1;
      if (!isSomeSegmentAtCursor) { // if a segment is already at cursor, don't do anything
        // if no segment at cursor, and looping playback mode, continue looping
        if (playbackModeRef.current === 'play-selected-segments' || playbackModeRef.current === 'loop-selected-segments') {
          const firstSelectedSegment = selectedSegmentsWithoutMarkers[0];
          if (firstSelectedSegment != null) {
            const index = cutSegments.findIndex((segment) => segment.segId === firstSelectedSegment.segId);
            if (index !== -1) setCurrentSegIndex(index);
            seekAbs(firstSelectedSegment.start);
          }
        } else if (currentCutSeg != null) {
          // for all other playback modes, seek to start of current segment
          seekAbs(currentCutSeg.start);
        }
      }
    }
    play(resetPlaybackRate);
  }, [activeVideoPath, currentCutSeg, cutSegments, findSegmentsAtCursor, getRelevantTime, pause, play, playbackModeRef, playingRef, seekAbs, selectedSegments, setCurrentSegIndex, setPlaybackMode, commandedTimeRef]);

  const togglePlaySelectedSegments = useCallback(() => togglePlay({ resetPlaybackRate: false, requestPlaybackMode: 'play-selected-segments' }), [togglePlay]);

  const frameStep = useCallback((direction: number) => {
    const element = videoRef.current;
    if (element == null) return;
    const step = detectedFps != null && detectedFps > 0 ? 1 / detectedFps : 0.1;
    seekAbs(element.currentTime + (direction * step));
  }, [detectedFps, seekAbs, videoRef]);

  const adjustPlaybackRate = useCallback((delta: number) => {
    const current = videoRef.current?.playbackRate ?? 1;
    setPlaybackRate(Math.min(16, Math.max(0.1, Math.round((current + delta) * 100) / 100)));
  }, [setPlaybackRate, videoRef]);

  const adjustVolume = useCallback((delta: number) => {
    setPlaybackVolume(Math.min(1, Math.max(0, Math.round((settings.playbackVolume + delta) * 100) / 100)));
  }, [setPlaybackVolume, settings.playbackVolume]);

  const toggleMute = useCallback(() => {
    setPlaybackVolume(settings.playbackVolume === 0 ? 1 : 0);
  }, [setPlaybackVolume, settings.playbackVolume]);

  const toggleFullscreen = useCallback(() => {
    if (!screenfull.isEnabled || videoContainerRef.current == null) return;
    screenfull.toggle(videoContainerRef.current, { navigationUI: 'hide' }).catch((err: unknown) => {
      console.error('Failed to toggle fullscreen', err);
    });
  }, [videoContainerRef]);

  const jumpSegment = useCallback((direction: number) => {
    if (cutSegments.length === 0) return;
    const next = Math.min(cutSegments.length - 1, Math.max(0, currentSegIndexSafe + direction));
    setCurrentSegIndex(next);
    const segment = cutSegments[next];
    if (segment != null) seekAbs(segment.start);
  }, [currentSegIndexSafe, cutSegments, seekAbs, setCurrentSegIndex]);

  const value = useMemo<PatchSessionValue>(() => ({
    filePath,
    openFile,
    openFileDialog,
    closeFile,
    videoRef,
    videoContainerRef,
    videoUrl,
    playing,
    playbackRate,
    relevantTime,
    togglePlay,
    togglePlaySelectedSegments,
    play,
    pause,
    seekAbs,
    seekRel,
    setPlaybackRate,
    frameStep,
    adjustPlaybackRate,
    adjustVolume,
    toggleMute,
    toggleFullscreen,
    jumpSegment,
    captureSnapshot,
    captureSnapshotToClipboard,
    playerView: activeView,
    availableViews,
    setPlayerView,
    stepPlayerView,
    previewPlaylist,
    previewIndex,
    onPreviewEnded,
    viewSwitchStyle: patchSettings.viewSwitchStyle,
    onStartPlaying,
    onStopPlaying,
    onVideoAbort,
    onSeeked,
    onTimeUpdate,
    onDurationChange,
    formatTimecode,
    fileDuration,
    setFileDuration,
    detectedFps,
    formatName,
    videoStreams,
    audioStreams,
    videoStream,
    videoFiles,
    currentFileIndex,
    openRelativeFile,
    refreshVideoFiles,
    cutSegments,
    currentSegIndex: currentSegIndexSafe,
    setCurrentSegIndex,
    currentCutSeg,
    addSegment,
    setCutStart,
    setCutEnd,
    removeCurrentSegment,
    splitCurrentSegment,
    clearSegments,
    selectedSegments,
    selectAllSegments,
    deselectAllSegments,
    invertSelectedSegments,
    toggleCurrentSegmentSelected,
    toggleSegmentSelected,
    cut,
    importSrcTxtDialog,
    haveInvalidSegs,
    exportedPaths,
    runSegmentOperation,
    runFileOperation,
    merge,
    cutAndMerge,
    mergedPath,
    sourcePostAction: patchSettings.sourcePostAction,
    autoMerge: patchSettings.autoMerge,
    setSourcePostAction,
    applySourcePostAction,
    finishCurrentFile,
    progress,
    setProgress,
    working,
    abortWorking,
    handleError,
    playbackVolume: settings.playbackVolume,
    setPlaybackVolume,
    patchKeyBindings,
    setPatchKeyBinding,
    resetPatchKeyBindings,
  }), [
    abortWorking, addSegment, adjustPlaybackRate, adjustVolume, audioStreams, clearSegments, closeFile, currentCutSeg, currentSegIndexSafe, cutSegments, cut,
    detectedFps, exportedPaths, fileDuration, filePath, formatName, formatTimecode, frameStep, handleError, haveInvalidSegs, importSrcTxtDialog, jumpSegment, onDurationChange, onSeeked,
    onStartPlaying, onStopPlaying, onTimeUpdate, onVideoAbort, openFile, openFileDialog, pause, play, playbackRate,
    playing, progress, relevantTime, removeCurrentSegment, seekAbs, seekRel, setCurrentSegIndex, setCutEnd,
    setCutStart, setFileDuration, setPlaybackRate, setPlaybackVolume, setProgress, settings.playbackVolume,
    splitCurrentSegment, toggleFullscreen, toggleMute, togglePlay, togglePlaySelectedSegments, videoContainerRef, videoRef, videoStream, videoStreams, videoUrl, videoFiles, currentFileIndex, openRelativeFile, refreshVideoFiles, working,
    selectedSegments, selectAllSegments, deselectAllSegments, invertSelectedSegments, toggleCurrentSegmentSelected, toggleSegmentSelected,
    captureSnapshot, captureSnapshotToClipboard,
    patchKeyBindings, setPatchKeyBinding, resetPatchKeyBindings,
    activeView, availableViews, onPreviewEnded, previewIndex, previewPlaylist, setPlayerView, stepPlayerView, patchSettings.viewSwitchStyle,
    merge, cutAndMerge, mergedPath, setSourcePostAction, applySourcePostAction, finishCurrentFile, patchSettings.sourcePostAction, patchSettings.autoMerge,
    runSegmentOperation,
    runFileOperation,
  ]);

  return (
    <UserSettingsContext.Provider value={userSettingsContextValue}>
      <PatchSessionContext.Provider value={value}>
        {children}
        <GenericDialog dialog={genericDialog} onOpenChange={closeGenericDialog} />
        <ErrorDialog error={genericError} onOpenChange={(open) => !open && setGenericError(undefined)} />
      </PatchSessionContext.Provider>
    </UserSettingsContext.Provider>
  );
}
