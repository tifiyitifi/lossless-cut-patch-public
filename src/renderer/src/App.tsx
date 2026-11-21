import type { CSSProperties, ReactEventHandler, FocusEventHandler, DragEventHandler } from 'react';
import { memo, useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { flushSync } from 'react-dom';
import { FaRegTimesCircle } from 'react-icons/fa';
import { MdRotate90DegreesCcw } from 'react-icons/md';
import { AnimatePresence, MotionConfig } from 'motion/react';
import i18n from 'i18next';
import { useTranslation } from 'react-i18next';
import { produce } from 'immer';
import screenfull from 'screenfull';
import type { IpcRendererEvent, MenuItemConstructorOptions } from 'electron';
import { IoMdMenu } from 'react-icons/io';
import fromPairs from 'lodash/fromPairs';
import sum from 'lodash/sum';
import invariant from 'tiny-invariant';
import type { SweetAlertOptions } from 'sweetalert2';
import { Theme } from '@radix-ui/themes';

import useTimelineScroll from './hooks/useTimelineScroll';
import useUserSettingsRoot from './hooks/useUserSettingsRoot';
import useFfmpegOperations, { maybeMkDeepOutDir, OutputNotWritableError } from './hooks/useFfmpegOperations';
import useKeyframes from './hooks/useKeyframes';
import useWaveform from './hooks/useWaveform';
import useKeyboard from './hooks/useKeyboard';
import useFileFormatState from './hooks/useFileFormatState';
import useFrameCapture from './hooks/useFrameCapture';
import useSegments from './hooks/useSegments';
import useDirectoryAccess from './hooks/useDirectoryAccess';

import type { UserSettingsContextType, AppContextType, SegColorsContextType } from './contexts';
import { UserSettingsContext, SegColorsContext, AppContext } from './contexts';

import NoFileLoaded from './NoFileLoaded';
import MediaSourcePlayer from './MediaSourcePlayer';
import TopMenu from './TopMenu';
import LastCommands from './LastCommands';
import StreamsSelector from './StreamsSelector';
import SegmentList from './SegmentList';
import Settings from './components/Settings';
import Timeline from './Timeline';
import BottomBar from './BottomBar';
import ExportConfirm from './components/ExportConfirm';
import ValueTuners from './components/ValueTuners';
import VolumeControl from './components/VolumeControl';
import PlaybackStreamSelector from './components/PlaybackStreamSelector';
import BatchFilesList from './components/BatchFilesList';
import ConcatDialog from './components/ConcatDialog';
import KeyboardShortcuts from './components/KeyboardShortcuts';
import Working from './components/Working';
import OutputFormatSelect from './components/OutputFormatSelect';
import * as Dialog from './components/Dialog';

import { loadMifiLink, runStartupCheck } from './mifi';
import { darkModeTransition } from './colors';
import { getSegColor } from './util/colors';
import type {
  FileFfprobeMeta } from './ffmpeg';
import {
  getStreamFps, isCuttingStart, isCuttingEnd,
  readFileFfprobeMeta, getDefaultOutFormat,
  setCustomFfPath as ffmpegSetCustomFfPath,
  isIphoneHevc, isProblematicAvc1, tryMapChaptersToEdl,
  getTimecodeFromStreams, createChaptersFromSegments,
  RefuseOverwriteError, extractSubtitleTrackToSegments,
  mapRecommendedDefaultFormat,
  getFfCommandLine,
  getDuration,
} from './ffmpeg';
import { shouldCopyStreamByDefault, getAudioStreams, getRealVideoStreams, isAudioDefinitelyNotSupported, willPlayerProperlyHandleVideo, doesPlayerSupportHevcPlayback, getSubtitleStreams, enableVideoTrack, enableAudioTrack, canHtml5PlayerPlayStreams, isMatroska } from './util/streams';
import { needsHvc1Tag } from './util/metadata';
import { exportEdlFile, readEdlFile, loadLlcProject, askForEdlImport } from './edlStore';
import { formatYouTube, getFrameCountRaw, formatTsvHuman } from './edlFormats';
import {
  getOutPath, getOutDir,
  isStoreBuild, dragPreventer,
  havePermissionToReadFile, resolvePathIfNeeded, getPathReadAccessError, findExistingHtml5FriendlyFile,
  isOutOfSpaceError, readFileSize, readFileSizes, checkFileSizes, setDocumentTitle, readVideoTs, readDirRecursively, getImportProjectType,
  calcShouldShowWaveform, calcShouldShowKeyframes, mediaSourceQualities, isExecaError, getStdioString,
  isMuxNotSupported,
  getDownloadMediaOutPath,
  isAbortedError,
  shootConfetti,
  isMasBuild,
  readFileStats,
  makeSourceFileAccessError,
  transferTimestamps,
  getOutFileExtension,
  getSuffixedFileName,
  calculateTimelinePercent,
  isWindows,
  isMac,
  getFrameDuration,
  getFileDir,
} from './util';
import getSwal, { errorToast, showPlaybackFailedMessage } from './swal';
import { adjustRate } from './util/rate-calculator';
import { askExtractFramesAsImages } from './dialogs/extractFrames';
import type { CleanupChoicesType, OpenFileResponse } from './dialogs';
import { askForOutDir, askForImportChapters, askForFileOpenAction, showDiskFull, showExportFailedDialog, showConcatFailedDialog, openYouTubeChaptersDialog, showRefuseToOverwrite, showOpenDialog, showMuxNotSupported, promptDownloadMediaUrl, showOutputNotWritable, deleteFiles, mustDisallowVob, toastError } from './dialogs';
import { openSendReportDialog } from './reporting';
import { sortSegments, convertSegmentsToChaptersWithGaps, hasAnySegmentOverlap, isDurationValid, getPlaybackAction, getSegmentTags, filterNonMarkers, isInitialSegment, getGuaranteedSegments } from './segments';
import type { GenerateMergedOutFileNamesParams, GeneratedNameContext, GeneratedOutFileNames } from './util/outputNameTemplate';
import { generateCutFileNames as generateCutFileNamesRaw, generateCutMergedFileNames as generateCutMergedFileNamesRaw, generateMergedFileNames as generateMergedFileNamesRaw, defaultCutFileTemplate, defaultCutMergedFileTemplate, defaultMergedFileTemplate, selectedSegNumVariable } from './util/outputNameTemplate';
import { rightBarWidth, leftBarWidth, ffmpegExtractWindow, zoomMax } from './util/constants';
import BigWaveform from './components/BigWaveform';

import type { BatchFile, Chapter, EdlExportType, EdlFileType, EdlImportType, FfmpegCommandLog, FilesMeta, FileStats, ParamsByFile, PlaybackMode, SegmentBase, SegmentColorIndex, SegmentTags, StateSegment, TunerType } from './types';
import { goToTimecodeDirectArgsSchema } from './types';
import type { CaptureFormat, KeyboardAction, ApiActionRequest } from '../../common/types.js';
import { openFilesActionArgsSchema } from '../../common/types.js';
import type { FFprobeChapter, FFprobeStream } from '../../common/ffprobe.js';
import { parseFfprobeDuration } from '../../common/util.js';

import useLoading from './hooks/useLoading';
import useVideo from './hooks/useVideo';
import useTimecode from './hooks/useTimecode';
import useSegmentsAutoSave from './hooks/useSegmentsAutoSave';
import useThumbnails from './hooks/useThumbnails';
import useSubtitles from './hooks/useSubtitles';
import useStreamsMeta from './hooks/useStreamsMeta';
import { bottomStyle, videoStyle } from './styles';
import styles from './App.module.css';
import { DirectoryAccessDeclinedError, UserFacingError } from '../errors';
import SwalContainer from './components/SwalContainer';
import ErrorDialog from './components/ErrorDialog';
import useErrorHandling from './hooks/useErrorHandling';
import GenericDialog, { useDialog } from './components/GenericDialog';
import useHtml5ify from './hooks/useHtml5ify';
import WhatsNew from './components/WhatsNew';
import mainApi from './mainApi.js';
import type { AppEvent } from '../../main/index.js';
import { appName } from '../../main/common.js';
// patch: patch-mode command console + panel state (base mode has no provider, see the seam below).
import PatchCommandLayer from './features/patchConsole/PatchCommandLayer';
import KeyboardPracticeLayer from './features/patchPractice/KeyboardPracticeLayer';
import { useKeyframeStep } from './features/patchSeek/useKeyframeStep';
// patch: frame stepping that pauses for the seek and puts playback back afterwards.
import useFrameStep from './features/patchFrameStep/useFrameStep';
// patch: the patch-mode seek dialog (format help + the compact/plain swap), base keeps upstream's.
import promptPatchTimecode from './features/timecodeInput/promptPatchTimecode';
import type { PracticePreviewControl } from './features/patchPractice/practicePreview';
import { buildActionLabels } from './features/patchPractice/practiceCopy';
import ActionKeys from './features/patch/ActionKeys';
// patch: the `Help` → `Known issues` dialog shows the same list as the landing page notes.
import PatchKnownIssues from './features/patch/landing/PatchKnownIssues';
import getSegmentEndPreviewTime, { resolveSegmentEndPreviewRange } from '../../common/features/patchTransport/segmentEndPreview';
import { patchFlushBeforeUpdateChannel, patchFlushBeforeUpdateDoneChannel } from '../../common/features/updater/ipc';
import { shouldAutoPlayAfterOpen, stepPlaybackRate } from '../../common/features/patchTransport';
import usePlaybackRateMemory from './features/patchPlaybackRate/usePlaybackRateMemory';
import { findBlockingConflicts, patchModeOnlyActions, resolveKeyBindings } from '../../common/features/patchKeys';
import { defaultPatchSettings } from '../../common/features/patchData/settings';
import { patchMergedFileTemplate, resolveMergeFileName } from '../../common/features/patchData/naming';
import { mergedNamePresets, ruleHasUniqueToken } from '../../common/features/patchData/mergedName';
import { usePatchConsole } from './features/patchConsole/PatchConsoleProvider';
// patch: the patch working directory decides where the cut output goes (features/patchWork).
import { usePatchWork } from './features/patchWork/PatchWorkProvider';
import { usePatchExportRun } from './features/patchExportRun/PatchExportRunProvider';
import guardPatchExportActions from './features/patchExportLock/guardPatchExportActions';
import { detectPatchExportListChange, planPatchExportListSnapshot } from '../../common/features/patchExportLock';
import type { PatchExportListEntry } from '../../common/features/patchExportLock';
import { usePatchResumeWindows } from './features/patchResume/usePatchResumeWindows';
import { usePatchResultsOthers } from './features/patchResume/usePatchResultsOthers';
// patch: `E` presses the confirm button of the fork's dialogs that are reached with `E`.
import { withConfirmKeys } from './features/patchFinish/swalDialogs';
import { usePatchFinish } from './features/patchFinish/usePatchFinish';
import PatchFinishDialog from './features/patchFinish/PatchFinishDialog';
import DiscardSourceDialog from './features/patchDiscard/DiscardSourceDialog';
import { useDiscardSource } from './features/patchDiscard/useDiscardSource';
import MergeNameDialog from './features/patchMergeName/MergeNameDialog';
import usePatchMergeName from './features/patchMergeName/usePatchMergeName';
import type { MergeNamePreview } from './features/patchMergeName/usePatchMergeName';
import useMergedNameRule from './features/patchMergeName/useMergedNameRule';
import { mergedNameProblemMessage, resolvePatchMergedName } from './features/patchMergeName/resolvePatchMergedName';
import NameRuleEditor from './features/patchNameRule/NameRuleEditor';
// patch: the cut results are named by their own `{token}` rule (features/patchCutName).
import useCutNameRule from './features/patchCutName/useCutNameRule';
import { cutNameProblemMessage, resolvePatchCutNames } from './features/patchCutName/resolvePatchCutName';
import showPathTooLong from './features/patchCutName/showPathTooLong';
import type { CutNameClip, RuleCutNameContext } from '../../common/features/patchData/cutName';
import { cutNamePresets, cutRuleSeparatesClips } from '../../common/features/patchData/cutName';
// patch: the time converter turns written time pairs into cut rows and back (features/patchTimeConvert).
import usePatchTimeConvert from './features/patchTimeConvert/usePatchTimeConvert';
import PatchTimeConvertDialog from './features/patchTimeConvert/PatchTimeConvertDialog';
import type { TimePairRow } from '../../common/features/patchTimeConvert';
// patch: the player window is a viewer, so it does not run the cutting actions (features/patchPlayer).
import { disablePatchPlayerActions, getShownResultPaths, patchPlayerDisabledActions, patchPlayerPlaybackChannel, patchPlayerReleaseChannel, patchResultsPauseChannel, patchSourcePauseChannel, patchSourcePlaybackChannel, resolvePlayKeyIntent } from '../../common/features/patchPlayer';
import type { PatchCutResultEntry, PatchNameContext } from '../../common/features/patchPlayer';
import PatchCutResultsList from './features/patchPlayer/PatchCutResultsList';
import PatchRenameDialog from './features/patchPlayer/PatchRenameDialog';
import usePatchPlayerPlaylist from './features/patchPlayer/usePatchPlayerPlaylist';
import useResultFilesExist from './features/patchPlayer/useResultFilesExist';
import { usePatchResultRename } from './features/patchPlayer/usePatchResultRename';
// patch: the result windows do not import a file's embedded chapters (features/patchChapterImport).
import { planEmbeddedChapterImport, resolveChapterImportWindow } from '../../common/features/patchChapterImport/chapterImport';
// patch: right-click "locate this file on disk" menus (features/patchFileActions).
import usePatchFileActions from './features/patchFileActions/usePatchFileActions';
import usePatchFileContextMenu from './features/patchFileActions/usePatchFileContextMenu';
// patch: the "show/hide the app menu bar" entry in the video's right-click menu (features/patchMenuBar).
import usePatchMenuBarMenuItem from './features/patchMenuBar/usePatchMenuBarMenuItem';
// patch: a bare wheel over the video steps the preview volume (features/patchWheelVolume).
import usePatchWheelVolume from './features/patchWheelVolume/usePatchWheelVolume';
// patch: the "do not ask again" box of the clear-file-list confirmation (features/patchWork).
import PatchConfirmClearFileListCheckbox from './features/patchWork/PatchConfirmClearFileListCheckbox';
import hashExportSignature from './features/patchExport/exportSignature';
import serializeParamsByFile from './features/patchExport/paramsSignature';
import { readExportManifest, updateExportManifest } from './features/patchExport/manifestApi';
import { applyResultRenames, deleteOrphanProjectFiles, deleteResultFiles, pathExistsSync, renameResultFile } from './features/patchExport/resultFiles';
import { buildMergedInputs, buildMergedSignatureInput, collectMergeClips, collectOwnedClipPaths, isNoOpExport, isSameOrder, mayReplaceMergedFile, mergeExportRecords, normalizeManifestPath, planIncrementalExport, planMergedExport, findManifestFileKey, pruneDeletedClipRecords, resolveInheritedSignature, resolveMergeOrder, resolveResultNameContext, resolveResultSignatures, trimOrder } from '../../common/features/patchExport';
import { getProjectFileName, isSamePath, planFinishContinuation, resolveReadOnlySourceArea, resolveWorkRootForPath } from '../../common/features/patchFinish';
import type { PatchFinishNextChoice, PatchFinishReport } from '../../common/features/patchFinish';
import type { PatchExportFileRecord, PatchExportManifest, PatchExportPlan, PatchExportSegmentInput, PatchManifestSegmentRecord, PatchMergedPlan, PatchMergeClip } from '../../common/features/patchExport';
import { appendBatchPaths, defaultPatchDirNames, dedupeBatchPaths, dedupePaths, getPatchWorkDirNames, getPatchRepairTmpFileName, getProjectFileLookup, getVideoNamedProjectCandidates, patchWindowPathChannel, replacePatchWorkAreaActions, updateBatchPath } from '../../common/features/patchWork';
import type { ProjectSaveSuppression } from '../../common/features/patchWork';
// patch: the export-finished notice can be silenced for good (features/patchNotice).
import { patchNoticeExportFinished, shouldShowExportFinishedNotice } from '../../common/features/patchNotice';
import { usePatchNotice } from './features/patchNotice/PatchNoticeProvider';
import PatchDontShowAgainCheckbox from './features/patchNotice/PatchDontShowAgainCheckbox';
// patch: the merged result shows the clips as read-only chapters (features/patchMerged).
import { buildMergedChapters, buildMergedChapterNumbers } from '../../common/features/patchMerged/mergedChapters.js';
import type { PatchMergedChapter } from '../../common/features/patchMerged/mergedChapters.js';
import { disablePatchMergedActions } from '../../common/features/patchMerged/mergedMode.js';
import usePatchMergedChapters from './features/patchMerged/usePatchMergedChapters';
// patch: the cut queue numbers the segments and explains itself (features/patchSegmentQueue).
import { buildSegmentOrderNumbers, isExportSelectionEmpty } from '../../common/features/patchSegmentQueue';
import SegmentQueueHelp from './features/patchSegmentQueue/SegmentQueueHelp';
import SegmentSelectionBar from './features/patchSegmentQueue/SegmentSelectionBar';
import useSegmentMultiSelect from './features/patchSegmentQueue/useSegmentMultiSelect';
import PatchNewSegmentRow from './features/patchCutMark/PatchNewSegmentRow';
// patch: the source list only accepts media files, so nothing unplayable is ever opened from it.
import { filterPatchMediaPaths } from '../../common/features/patchData/mediaPaths';
// patch: estimate the disk space an export or a merge needs before it writes anything.
import type { PatchSpaceEstimateMode } from '../../common/features/patchSpace';
import { estimateConcatBytes } from '../../common/features/patchSpace';
import { buildExportSpaceWrites, confirmPatchSpace } from './features/patchSpace/space';
// patch: A/B/C decide how a cut end is handled when the clips will be merged.
import { getCutTailGuardSeconds, getPatchCutSignature, getPatchTailTargets, getTailGuardFrames, resolveCutPolicy } from '../../common/features/patchExportPolicy';
import type { PatchTailTarget } from '../../common/features/patchExportPolicy';
import useMergeBoundaryPolicy from './features/patchExportPolicy/useMergeBoundaryPolicy';
// patch: a downloaded source can have a damaged head GOP that no cut can repair.
import usePatchSourceHealth from './features/patchSourceHealth/usePatchSourceHealth';
// patch: some sources are stored so that the built-in player and a lossless copy cannot show/cut them
// correctly (features/damagedSource).
import useDamagedSource from './features/damagedSource/useDamagedSource';
import SourceRepairMenu from './features/damagedSource/SourceRepairMenu';
import { parse as parsePath, join as pathJoin, basename, dirname } from './util/path';

const { ipcRenderer, webUtils } = window.require('electron');
const { lstat } = window.require('node:fs/promises');
const { hasDisabledNetworking, pathToFileURL, lossyMode, isLinux } = window.require('@electron/remote').require('./index.js');

/** Windows and macOS resolve paths case-insensitively, so manifest lookups have to as well. */
const manifestPathCaseInsensitive = isWindows || isMac;

/**
The project file next to a video (`a.mp4` -> `a-proj.llc`).

The merged-result window no longer auto-saves one; a sidecar that an older build left behind has
to go when its video is replaced, because the merged chapters live in the export manifest.
*/
const getProjectSidecarPath = (videoPath: string) => pathJoin(dirname(videoPath), getProjectFileName(videoPath));


const hevcPlaybackSupportedPromise = doesPlayerSupportHevcPlayback();
// eslint-disable-next-line unicorn/prefer-top-level-await
hevcPlaybackSupportedPromise.catch((err: unknown) => console.error(err));

function emitEvent(appEvent: AppEvent) {
  ipcRenderer.send('appEvent', appEvent satisfies AppEvent);
}

/** `lstat` without throwing (used by the incremental export to check recorded results). */
async function fileExists(path: string) {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

// patch: the player window cannot create or move cut points (features/patchPlayer).
const noopSetCutTime = () => undefined;

// patch: `patchMode` is the single seam patch mode uses in upstream `App`.
// See ai-tmp/patch-mode-steps.md for the stepwise plan.
// `playerMode` marks the separate player window (features/patchPlayer): the very same player, used to
// review the cut results. It only removes the cutting (cut-point marking, cut-list editing, export)
// and adds the playlist flow (auto play / auto advance through the batch list).
// `mergedMode` is the merged-result window: a player window that plays one file and has no merge key.
// `inspectMode` is the check player: a player window the detached-source check opens for one source.
function App({ patchMode = false, playerMode = false, mergedMode = false, inspectMode = false }: { patchMode?: boolean, playerMode?: boolean, mergedMode?: boolean, inspectMode?: boolean } = {}) {
  const { t } = useTranslation();

  // patch: the provider is mounted by the patch shell for both modes, so gate on `patchMode`:
  // `patchConsole` stays undefined in base mode and every patch branch below stays inert.
  const patchConsole = usePatchConsole();
  const patchModeConsole = patchMode ? patchConsole : undefined;

  // Per project state
  const [ffmpegCommandLog, setFfmpegCommandLog] = useState<FfmpegCommandLog>([]);
  const [rotation, setRotation] = useState(360);
  const [progress, setProgress] = useState<number>();
  const [startTimeOffset, setStartTimeOffset] = useState(0);
  const [filePath, setFilePath] = useState<string>();
  const [fileDuration, setFileDuration] = useState<number>();
  const [externalFilesMeta, setExternalFilesMeta] = useState<FilesMeta>({});
  const [paramsByFile, setParamsByFile] = useState<ParamsByFile>(new Map());
  const [detectedFps, setDetectedFps] = useState<number>();
  const [mainFileMeta, setMainFileMeta] = useState<{ ffprobeMeta: FileFfprobeMeta, stats: FileStats }>();
  const [streamsSelectorShown, setStreamsSelectorShown] = useState(false);
  const [concatDialogOpen, setConcatDialogOpen] = useState(false);
  const [zoomUnrounded, setZoom] = useState(1);
  const [shortestFlag, setShortestFlag] = useState(false);
  const [zoomWindowStartTime, setZoomWindowStartTime] = useState(0);
  const [activeVideoStreamIndex, setActiveVideoStreamIndex] = useState<number>();
  const [activeAudioStreamIndexes, setActiveAudioStreamIndexes] = useState<Set<number>>(new Set());
  const [activeSubtitleStreamIndex, setActiveSubtitleStreamIndex] = useState<number>();
  const [hideCompatPlayer, setHideCompatPlayer] = useState(false);
  const [exportConfirmOpen, setExportConfirmOpen] = useState(false);
  const [cacheBuster, setCacheBuster] = useState(0);
  const [currentFileExportCount, setCurrentFileExportCount] = useState(0);

  const { fileFormat, setFileFormat, detectedFileFormat, setDetectedFileFormat, isCustomFormatSelected } = useFileFormatState();

  // State per application launch
  const [ffmpegInfo, setFfmpegInfo] = useState<Awaited<ReturnType<typeof runStartupCheck>>>();
  const lastOpenedPathRef = useRef<string>(undefined);
  const [showRightBar, setShowRightBar] = useState(true);
  const [lastCommandsVisible, setLastCommandsVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [tunerVisible, setTunerVisible] = useState<TunerType>();
  const [keyboardShortcutsVisible, setKeyboardShortcutsVisible] = useState(false);
  // patch: the player window's rename dialog (label or full file name).
  const [patchRenameRequest, setPatchRenameRequest] = useState<{ kind: 'label' | 'full', defaultValue: string }>();
  // patch: the source a key asked to play once it is loaded (`Shift+PgUp` / `Shift+PgDn`).
  const pendingAutoPlayPathRef = useRef<string>(undefined);
  const [mifiLink, setMifiLink] = useState<unknown>();
  const [alwaysConcatMultipleFiles, setAlwaysConcatMultipleFiles] = useState(false);
  const [editingSegmentTagsSegmentIndex, setEditingSegmentTagsSegmentIndex] = useState<number>();
  const [editingSegmentTags, setEditingSegmentTags] = useState<SegmentTags>();
  const [mediaSourceQuality, setMediaSourceQuality] = useState(0);
  const [encBitrate, setEncBitrate] = useState<number | undefined>();
  const [exportCount, setExportCount] = useState(0);
  /**
  patch: the timestamp of the export that is being set up.

  The merged name rule can use `{datetime}` / `{epoch_ms}`, so the preview and the export have to
  agree on one moment (see `features/patchMergeName`). It is refreshed whenever the export starts
  or the export options open, and read by the export itself.
  */
  // eslint-disable-next-line react/purity -- patch: captured once at mount on purpose (see above)
  const patchExportNameEpochRef = useRef(Date.now());
  const [patchExportNameEpochMs, setPatchExportNameEpochMs] = useState(() => patchExportNameEpochRef.current);
  const beginPatchExportName = useCallback(() => {
    const now = Date.now();
    patchExportNameEpochRef.current = now;
    setPatchExportNameEpochMs(now);
  }, []);
  const [maxKeyframes, setMaxKeyframes] = useState(10000);

  const incrementMediaSourceQuality = useCallback(() => setMediaSourceQuality((v) => (v + 1) % mediaSourceQualities.length), []);

  // Batch state / concat files
  const [batchFiles, setBatchFiles] = useState<BatchFile[]>([]);
  const [selectedBatchFiles, setSelectedBatchFiles] = useState<string[]>([]);

  const allUserSettings = useUserSettingsRoot();
  const { captureFormat, keyframeCut, preserveMetadata, preserveMetadataOnMerge, preserveMovData, preserveChapters, movFastStart, avoidNegativeTs, autoMerge, timecodeFormat, invertCutSegments, autoExportExtraStreams, askBeforeClose, enableImportChapters, enableAskForFileOpenAction, playbackVolume, autoSaveProjectFile, llcTimeFormat, wheelSensitivity, waveformHeight, invertTimelineScroll, language, ffmpegExperimental, hideNotifications, hideOsNotifications, autoLoadTimecode, autoDeleteMergedSegments, exportConfirmEnabled, segmentsToChapters, simpleMode, cutFileTemplate, cutMergedFileTemplate, mergedFileTemplate, keyboardSeekAccFactor, keyboardNormalSeekSpeed, keyboardSeekSpeed2, keyboardSeekSpeed3, treatInputFileModifiedTimeAsStart, treatOutputFileModifiedTimeAsStart, outFormatLocked, safeOutputFileName, enableAutoHtml5ify, segmentsToChaptersOnly, keyBindings, enableSmartCut, customFfPath, storeProjectInWorkingDir, enableOverwriteOutput, mouseWheelZoomModifierKey, mouseWheelFrameSeekModifierKey, mouseWheelKeyframeSeekModifierKey, captureFrameMethod, captureFrameQuality, captureFrameFileNameFormat, enableNativeHevc, cleanupChoices, preferStrongColors, outputFileNameMinZeroPadding, cutFromAdjustmentFrames, cutToAdjustmentFrames, waveformMode: waveformModePreference, thumbnailsEnabled, keyframesEnabled, reducedMotion, ffmpegHwaccel, videoFit, damagedSourcePlaybackRepair, damagedSourcePlaybackRepairQuality, damagedSourceExportRepair } = allUserSettings.settings;
  const { setDamagedSourcePlaybackRepairQuality, setDamagedSourceExportRepair, setCaptureFormat, setCustomOutDir, setKeyframeCut, setPlaybackVolume, setExportConfirmEnabled, setSimpleMode, setOutFormatLocked, setSafeOutputFileName, setKeyBindings, resetKeyBindings, setStoreProjectInWorkingDir, setCleanupChoices, darkMode, toggleDarkMode, setWaveformMode, setThumbnailsEnabled, setKeyframesEnabled, prefersReducedMotion } = allUserSettings;

  // patch: in patch mode the working directory decides where the output goes: the cut results are
  // written into the work area the app maintains (`<working directory>/.losslesscut_work/clips`).
  // Without a working directory the work area is created next to the source file instead (see
  // features/patchWork). Base mode keeps the upstream custom output directory.
  const patchWork = usePatchWork();
  const patchWorkDirs = patchMode ? patchWork?.workDirs : undefined;
  const customOutDir = patchWorkDirs?.clipsDir ?? allUserSettings.customOutDir;

  // patch: the A/B/C cut-end policy of merged exports, chosen in the export settings (E).
  const mergeBoundary = useMergeBoundaryPolicy();

  // patch: the rule that names the merged cut results (features/patchMergeName).
  const patchMergedName = useMergedNameRule();

  // patch: the rule that names the cut results themselves (features/patchCutName). A separate rule,
  // so the clips and the file they are merged into do not fight over the same names.
  const patchCutName = useCutNameRule();

  // patch: the time converter (`Tools -> Time convert...`, console `opentimeconvert`): written time
  // pairs -> cut list / project file, and project file -> written time pairs (features/patchTimeConvert).
  const patchTimeConvert = usePatchTimeConvert();

  // patch: the project file (.llc) and the EDL exports follow upstream: they go to the upstream
  // custom output directory when the user set one, otherwise next to the source video. The work area
  // holds the patch results (the cut results and the merged file) and never the project file: the
  // project belongs to the media (it stores the media file name), so it has to travel with it to
  // stay reusable. Base mode keeps the upstream behaviour (there `upstreamOutDir` is `customOutDir`).
  const upstreamOutDir = allUserSettings.customOutDir;

  // patch: the notices the user has silenced (features/patchNotice). Only patch mode uses it.
  const patchNotice = usePatchNotice();

  // patch: the work area falls back to the source file's folder, so the provider has to know which
  // file is open. The player window only reviews results (it never exports), so it reports none.
  const patchSetSourcePath = patchWork?.setSourcePath;
  useEffect(() => {
    if (playerMode) return;
    patchSetSourcePath?.(filePath);
  }, [filePath, patchSetSourcePath, playerMode]);

  // patch: tell the main process which video this window shows, so its context menu can open the
  // video's work folder (`Open the work folder`). The check player is left out: it plays the very
  // source the detached-source check deletes for good, and a reported path would make that delete
  // refuse the file as "open in one of the app windows".
  useEffect(() => {
    if (inspectMode) return;
    ipcRenderer.send(patchWindowPathChannel, filePath ?? null);
  }, [filePath, inspectMode]);

  const [showAdvancedSettings, setShowAdvancedSettings] = useState(!simpleMode);

  const { withErrorHandling, handleError, genericError, setGenericError } = useErrorHandling();

  const { showGenericDialog, genericDialog, closeGenericDialog, confirmDialog, openNoticeDialog, openExportFinishedDialog, openCutFinishedDialog, openConcatFinishedDialog, openCleanupFilesDialog, openShiftSegmentsDialog, openDecimateDialog } = useDialog();

  // patch: the shortcut scopes. Base mode runs the upstream layout; patch mode runs its own layout
  // on top of it (patch wins on the keys it claims, everything else keeps working), and the results
  // windows re-purpose the walk keys on top of that. User bindings run in both modes.
  const effectiveKeyBindings = useMemo(() => resolveKeyBindings(keyBindings, {
    mode: patchMode || playerMode ? 'patch' : 'base',
    context: mergedMode ? 'merged' : (playerMode ? 'player' : 'editor'),
  }), [keyBindings, mergedMode, patchMode, playerMode]);

  // Note that each action may be multiple key bindings and this will only be the first binding for each action
  const keyBindingByAction = useMemo(() => Object.fromEntries(effectiveKeyBindings.map((binding) => [binding.action, binding])), [effectiveKeyBindings]);

  // patch: a key of the user's own that collides with a default cannot run (the save dialog blocks
  // it, but a hand-edited config can still carry one). Say it once at startup, in the cutting
  // window only - the results windows share the same config and would show the same dialog again.
  const blockingShortcutConflicts = useMemo(() => findBlockingConflicts(keyBindings), [keyBindings]);
  const shortcutConflictNoticeShownRef = useRef(false);
  useEffect(() => {
    if (!patchMode || playerMode || mergedMode || blockingShortcutConflicts.length === 0 || shortcutConflictNoticeShownRef.current) return;
    shortcutConflictNoticeShownRef.current = true;

    const lines = blockingShortcutConflicts.map(({ binding, scope }) => {
      const scopeLabel = t(scope === 'base' ? 'Base' : 'Patch');
      return `${binding.keys.split('+').join(' + ')} (${t('yours')} / ${scopeLabel})`;
    });

    confirmDialog({
      description: t('These keys cannot run because another binding already uses the same key: {{conflicts}}. Opening the shortcut list lets you change or switch them off; until then they stay inactive.', { conflicts: lines.join(', ') }),
      confirmButtonText: t('Open the shortcut list'),
      cancelButtonText: t('Later'),
    }).then((shouldOpen) => {
      if (shouldOpen) setKeyboardShortcutsVisible(true);
      return undefined;
    }).catch((err: unknown) => {
      console.error('Failed to show the keyboard conflict notice', err);
    });
  }, [blockingShortcutConflicts, confirmDialog, mergedMode, patchMode, playerMode, t]);

  // patch: the finish dialog is opened by one of these keys, and the same key starts the job while
  // the dialog is open (see `PatchFinishDialog`), so the whole finish step stays on the keyboard.
  const patchFinishExecuteKeys = useMemo(
    () => ['finish', 'finishMerge', 'finishCut', 'finishKeepSource']
      .map((action) => keyBindingByAction[action]?.keys)
      .filter((keys): keys is string => keys != null),
    [keyBindingByAction],
  );

  // patch: the same for the merge name dialog: `E` opens it in the cut-results window and starts
  // the merge when pressed again (the cutting window has no merge key, so the list is empty there).
  const patchMergeExecuteKeys = useMemo(
    () => ['mergeCutResults']
      .map((action) => keyBindingByAction[action]?.keys)
      .filter((keys): keys is string => keys != null),
    [keyBindingByAction],
  );

  const mainVideoStyle = useMemo<CSSProperties>(() => ({ ...videoStyle, objectFit: videoFit }), [videoFit]);

  const { working, setWorking, workingRef, abortWorking } = useLoading();
  // patch: the export run of this window (its own state, not the shared `working` slot; see
  // features/patchExportRun). `undefined` in the results windows, which never export.
  const exportRun = usePatchExportRun();
  // patch: "busy" for the patch flows that must not run during an export. The export's own run
  // state counts, because the shared `working` slot only covers it until something clears it.
  const patchIsWorking = useCallback(() => workingRef.current || (exportRun?.isRunning() ?? false), [workingRef, exportRun]);

  // patch: the export locks. While this window exports, the cut list does not change (the export is
  // a snapshot) and no second job starts. `Tools -> Unlock cutting` is the escape hatch: it clears
  // both locks until the next export begins.
  const forceUnlockedRef = useRef(false);
  const isPatchExporting = useCallback(() => patchMode && (exportRun?.isRunning() ?? false), [patchMode, exportRun]);
  const isPatchExportBlocked = useCallback(() => isPatchExporting() && !forceUnlockedRef.current, [isPatchExporting]);
  const warnExportRunning = useCallback(() => {
    getSwal().toast.fire({ icon: 'info', text: i18n.t('Wait for the current export to finish.') });
  }, []);
  // patch: is the finish job moving files right now? It keeps its own `busy` flag (it does not fill
  // the shared `working` slot), and the export must not start while it moves the same files. The
  // value is written by an effect below, once the finish hook exists.
  const patchFinishJobRunningRef = useRef(false);
  /** Set synchronously by the finish hook before its first `await` (see `onJobRunningChange` there). */
  const patchFinishExecutingRef = useRef(false);
  /** Whether this window's finish dialog is open: an export behind it would change the results it shows. */
  const patchFinishDialogOpenRef = useRef(false);
  /** Bumped by the results-window claim effect, so a stale cleanup cannot release a newer claim. */
  const patchResultClaimGenerationRef = useRef(0);
  const { videoRef, videoContainerRef, playbackRate, setPlaybackRate, outputPlaybackRate, setOutputPlaybackRate, commandedTime, seekAbs, playingRef, getRelevantTime, setPlaying, onSeeked, relevantTime, onStartPlaying, setCommandedTime, setOutputPlaybackRateState, commandedTimeRef, onStopPlaying, onVideoAbort, resetPendingSeek, playerTime, setPlayerTime, playbackMode, setPlaybackMode, playbackModeRef, playing, play, pause, seekRel } = useVideo({ filePath });

  // patch: the last non-1x speed the user chose, remembered in patch-config.json so the `Z`
  // toggle can go back to it. An inert no-op in base mode (the rate keys keep upstream behaviour).
  const playbackRateMemory = usePlaybackRateMemory();
  const { timecodePlaceholder, formatTimecode, parseTimecode, getFrameCount, promptTimecode } = useTimecode({ detectedFps, timecodeFormat, compactTimeInput: patchMode, showGenericDialog });
  const { loadSubtitle, subtitlesByStreamId, setSubtitlesByStreamId } = useSubtitles();

  const fileDurationNonZero = isDurationValid(fileDuration) ? fileDuration : 1;
  const zoom = Math.floor(zoomUnrounded);
  const zoomedDuration = isDurationValid(fileDuration) ? fileDuration / zoom : undefined;
  const zoomWindowEndTime = useMemo(() => (zoomedDuration != null ? zoomWindowStartTime + zoomedDuration : undefined), [zoomedDuration, zoomWindowStartTime]);

  useEffect(() => setDocumentTitle({ filePath, working: working?.text, progress }), [progress, filePath, working?.text]);

  useEffect(() => {
    mainApi.setProgressBar(progress ?? -1);
  }, [progress]);

  useEffect(() => {
    ffmpegSetCustomFfPath(customFfPath);
  }, [customFfPath]);

  const cutFileTemplateOrDefault = cutFileTemplate ?? defaultCutFileTemplate;
  // patch: merged cut results are named by the patch `{token}` rule (see features/patchMergeName),
  // so this upstream template is only used by base mode. A template the user set always wins.
  const cutMergedFileTemplateOrDefault = cutMergedFileTemplate ?? defaultCutMergedFileTemplate;
  const mergedFileTemplateOrDefault = mergedFileTemplate
    ?? (patchMode ? patchMergedFileTemplate : defaultMergedFileTemplate);

  useEffect(() => {
    i18n.changeLanguage(language ?? undefined).catch(console.error);
    ipcRenderer.send('setLanguage', language);
  }, [language]);

  const isFileOpened = Boolean(filePath);

  const [hoveringTime, setHoveringTime] = useState<number>();

  const displayTime = (hoveringTime != null && isFileOpened && !playing ? hoveringTime : relevantTime) + startTimeOffset;

  const onOutputFormatUserChange = useCallback((newFormat: string) => {
    setFileFormat(newFormat);
    if (outFormatLocked) {
      setOutFormatLocked(newFormat === detectedFileFormat ? undefined : newFormat);
    }
  }, [detectedFileFormat, outFormatLocked, setFileFormat, setOutFormatLocked]);

  // eslint-disable-next-line @eslint-react/naming-convention-ref-name -- TODO fix (new rule in @mifi/lint-config)
  const previousPlaybackVolume = useRef(playbackVolume);
  const toggleMuted = useCallback(() => {
    setPlaybackVolume((volume) => {
      if (volume === 0) {
        return previousPlaybackVolume.current || 1;
      }
      previousPlaybackVolume.current = volume;
      return 0;
    });
  }, [setPlaybackVolume]);

  // patch: a bare wheel over the video steps the preview volume (features/patchWheelVolume), capped
  // to 0-1 the same way increaseVolume / decreaseVolume are.
  const stepPlaybackVolume = useCallback((delta: number) => {
    setPlaybackVolume((val) => Math.min(1, Math.max(0, val + delta)));
  }, [setPlaybackVolume]);

  const toggleShowThumbnails = useCallback(() => setThumbnailsEnabled((v) => !v), [setThumbnailsEnabled]);

  const hideAllNotifications = hideNotifications === 'all';

  const showNotification = useCallback((opts: SweetAlertOptions) => {
    if (!hideAllNotifications) {
      getSwal().toast.fire(opts);
    }
  }, [hideAllNotifications]);

  // patch: patch mode's source list is a media list - a file that cannot be played is left out,
  // and the user is told instead of wondering where it went (features/patchData).
  const notifySkippedMediaFiles = useCallback((skipped: readonly string[]) => {
    if (skipped.length === 0) return;
    showNotification({
      text: skipped.length === 1
        ? i18n.t('A file was skipped because it is not supported media. Only media files can be played.')
        : i18n.t('{{total}} files were skipped because they are not supported media. Only media files can be played.', { total: skipped.length }),
    });
  }, [showNotification]);

  const showOsNotification = useCallback((text: string) => {
    if (hideOsNotifications == null) {
      // on Linux app name is not shown in notification, see https://github.com/mifi/lossless-cut/issues/2794
      if (isLinux) mainApi.sendOsNotification({ title: appName, body: text });
      else mainApi.sendOsNotification({ title: text });
    }
  }, [hideOsNotifications]);

  const toggleExportConfirmEnabled = useCallback(() => setExportConfirmEnabled((v) => {
    const newVal = !v;
    showNotification({ text: i18n.t(newVal ? 'Export options will be shown before exporting.' : 'Export options will not be shown before exporting.') });
    return newVal;
  }), [setExportConfirmEnabled, showNotification]);

  const toggleShowKeyframes = useCallback(() => {
    setKeyframesEnabled((old) => {
      const enabled = !old;
      if (enabled && !calcShouldShowKeyframes(zoomedDuration)) {
        showNotification({ text: i18n.t('Key frames will show on the timeline. You need to zoom in to view them') });
      }
      return enabled;
    });
  }, [setKeyframesEnabled, showNotification, zoomedDuration]);

  const appendLastCommandsLog = useCallback((command: string) => {
    setFfmpegCommandLog((old) => [...old, { command, time: new Date() }]);
  }, []);
  const appendFfmpegCommandLog = useCallback((args: string[]) => appendLastCommandsLog(getFfCommandLine('ffmpeg', args)), [appendLastCommandsLog]);

  const toggleSegmentsList = useCallback(() => setShowRightBar((v) => !v), []);

  const toggleSafeOutputFileName = useCallback(() => setSafeOutputFileName((v) => {
    if (v) showNotification({ icon: 'info', text: i18n.t('Output file name will not be sanitized, and any special characters will be preserved. This may cause the export to fail and can cause other funny issues. Use at your own risk!') });
    return !v;
  }), [setSafeOutputFileName, showNotification]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = playbackVolume;
  }, [playbackVolume, videoRef]);

  const mainStreams = useMemo(() => mainFileMeta?.ffprobeMeta.streams ?? [], [mainFileMeta?.ffprobeMeta.streams]);
  const mainFileFormat = useMemo(() => mainFileMeta?.ffprobeMeta.format, [mainFileMeta?.ffprobeMeta.format]);
  const mainFileChapters = useMemo(() => mainFileMeta?.ffprobeMeta.chapters, [mainFileMeta?.ffprobeMeta.chapters]);

  const subtitleStreams = useMemo(() => getSubtitleStreams(mainStreams), [mainStreams]);
  const videoStreams = useMemo(() => getRealVideoStreams(mainStreams), [mainStreams]);
  const audioStreams = useMemo(() => getAudioStreams(mainStreams), [mainStreams]);

  const mainVideoStream = useMemo(() => videoStreams[0], [videoStreams]);
  const mainAudioStream = useMemo(() => audioStreams[0], [audioStreams]);

  const activeSubtitle = useMemo(() => (activeSubtitleStreamIndex != null ? subtitlesByStreamId[activeSubtitleStreamIndex] : undefined), [activeSubtitleStreamIndex, subtitlesByStreamId]);
  const activeVideoStream = useMemo(() => (activeVideoStreamIndex != null ? videoStreams.find((stream) => stream.index === activeVideoStreamIndex) : undefined) ?? mainVideoStream, [activeVideoStreamIndex, mainVideoStream, videoStreams]);
  const activeAudioStreams = useMemo(() => {
    let ret: FFprobeStream[] = [];
    if (activeAudioStreamIndexes.size > 0) ret = audioStreams.filter((stream) => activeAudioStreamIndexes.has(stream.index));
    if (ret.length === 0 && mainAudioStream != null) ret = [mainAudioStream];
    return ret;
  }, [activeAudioStreamIndexes, audioStreams, mainAudioStream]);

  // 360 means we don't modify rotation gtrgt
  const isRotationSet = rotation !== 360;
  const effectiveRotation = useMemo(() => (isRotationSet ? rotation : (activeVideoStream?.tags?.rotate ? parseInt(activeVideoStream.tags.rotate, 10) : undefined)), [isRotationSet, activeVideoStream, rotation]);

  const zoomAbs = useCallback((fn: (v: number) => number) => setZoom((z) => Math.min(Math.max(fn(z), 1), zoomMax)), []);
  const zoomRel = useCallback((rel: number) => zoomAbs((z) => z + (rel * (1 + (z / 10)))), [zoomAbs]);

  const comfortZoom = isDurationValid(fileDuration) ? Math.max(fileDuration / 100, 1) : undefined;
  const timelineToggleComfortZoom = useCallback(() => {
    if (!comfortZoom) return;

    zoomAbs((prevZoom) => {
      if (prevZoom === 1) return comfortZoom;
      return 1;
    });
  }, [comfortZoom, zoomAbs]);


  const maxLabelLength = safeOutputFileName ? 100 : 500;

  const checkFileOpened = useCallback(() => {
    if (isFileOpened) return true;
    getSwal().toast.fire({ icon: 'info', title: i18n.t('You need to open a media file first') });
    return false;
  }, [isFileOpened]);

  const {
    cutSegments, cutSegmentsHistory, createSegmentsFromKeyframes, shuffleSegments, detectBlackScenes, detectSilentScenes, detectSceneChanges, removeSegment, removeSegments, invertAllSegments, fillSegmentsGaps, combineOverlappingSegments, combineSelectedSegments, modifySelectedSegmentTimes, alignSegmentTimesToKeyframes, updateSegOrder, updateSegOrders, reorderSegsByStartTime, addSegment, setCutStart, setCutEnd, newSegmentMark, toggleNewSegmentMark, labelSegment, splitCurrentSegment, focusSegmentAtCursor, selectSegmentsAtCursor, createNumSegments, createFixedDurationSegments, createFixedByteSizedSegments, createRandomSegments, getSegEstimatedSize, haveInvalidSegs, currentSegIndexSafe, currentCutSeg, inverseCutSegments, clearSegments, clearSegColorCounter, loadCutSegments, setCutTime, setCurrentSegIndex, labelSelectedSegments, deselectAllSegments, selectAllSegments, selectOnlyCurrentSegment, toggleCurrentSegmentSelected, invertSelectedSegments, removeSelectedSegments, selectSegmentsByLabel, selectSegmentsByExpr, selectAllMarkers, mutateSegmentsByExpr, toggleSegmentSelected, selectOnlySegment, applySegmentsSelection, selectedSegments, segmentsOrInverse, segmentsToExport, duplicateCurrentSegment, duplicateSegment, updateSegAtIndex, findSegmentsAtCursor, maybeCreateFullLengthSegment, currentCutSegOrWholeTimeline, segColorCounter,
  } = useSegments({ filePath, workingRef, setWorking, setProgress, videoStream: activeVideoStream, fileDuration, getRelevantTime, maxLabelLength, checkFileOpened, invertCutSegments, segmentsToChaptersOnly, timecodePlaceholder, parseTimecode, appendFfmpegCommandLog, fileDurationNonZero, mainFileMeta: mainFileMeta?.ffprobeMeta, seekAbs, activeVideoStreamIndex, activeAudioStreamIndexes, handleError, showGenericDialog, simpleMode, ffmpegHwaccel, isEditLocked: isPatchExportBlocked });

  // patch: the time converter loads rows into the cut list like a project import does: it replaces
  // the list (the dialog asked first), and an empty result never reaches the loader - that throws on
  // an empty list (a broken project file), which is upstream semantics we do not change.
  const patchTimeConvertLoad = useCallback((rows: TimePairRow[]) => {
    loadCutSegments({
      segments: rows.map(({ start, end, label }) => ({ start, end, name: label })),
      append: false,
      clampDuration: fileDuration,
      getNextCurrentSegIndex: () => 0,
    });
  }, [fileDuration, loadCutSegments]);

  // patch: the live cut list. An export plans from a snapshot, so when the list is force-unlocked
  // during a run (`Tools -> Unlock cutting`) the end can tell the user the results are the old list.
  const latestExportListRef = useRef<PatchExportListEntry[]>([]);
  useEffect(() => {
    latestExportListRef.current = planPatchExportListSnapshot(segmentsToExport);
  }, [segmentsToExport]);

  // patch: the project file is written where upstream puts it (the upstream custom output
  // directory, otherwise next to the source video), never into the patch work area. The results
  // windows are read-only views: their list (the merged chapters) comes from the export manifest,
  // so a project file next to a result would only litter the work area - and a stale one outlives
  // the result it belongs to when the result is replaced.
  const autoSaveProjectFileForWindow = autoSaveProjectFile && !playerMode && !mergedMode;
  // patch: a cut list read from the video's own name (`a.llc`) is never written back, and opening
  // it must not create `<video>-proj.llc` as a side effect. The hold is cleared by the next file and
  // by any changed cut list (see `shouldSuppressProjectSave`).
  const [suppressedProjectSave, setSuppressedProjectSave] = useState<ProjectSaveSuppression>();
  const { getEdlFilePath, projectFileSavePath, getProjectFileSavePath, flushSave: flushProjectSave } = useSegmentsAutoSave({ autoSaveProjectFile: autoSaveProjectFileForWindow, storeProjectInWorkingDir, filePath, customOutDir: upstreamOutDir, cutSegments, llcTimeFormat, suppressedProjectSave });

  // patch: the finish job and a discard have to leave a project file behind even when the cut list
  // came from a video-named file and nothing changed: a cut/export is a real save, not the load.
  const flushProjectSaveForced = useCallback(async () => {
    await flushProjectSave({ force: true });
  }, [flushProjectSave]);

  // patch: the updater closes the app to replace its files (features/updater). The project file is
  // written with a debounce, so the main process asks for a last save and waits for this answer
  // before quitting - without it an update could throw away the current cut list.
  useEffect(() => {
    const onFlushBeforeUpdate = () => {
      flushProjectSave()
        .catch((err: unknown) => console.error('Failed to save before the update', err))
        .finally(() => ipcRenderer.send(patchFlushBeforeUpdateDoneChannel));
    };
    ipcRenderer.on(patchFlushBeforeUpdateChannel, onFlushBeforeUpdate);
    return () => {
      ipcRenderer.off(patchFlushBeforeUpdateChannel, onFlushBeforeUpdate);
    };
  }, [flushProjectSave]);

  const { nonCopiedExtraStreams, exportExtraStreams, mainCopiedThumbnailStreams, numStreamsToCopy, toggleStripVideo, toggleStripAudio, toggleStripSubtitle, toggleStripThumbnail, toggleStripAll, copyStreamIdsByFile, setCopyStreamIdsByFile, copyFileStreams, mainCopiedStreams, setCopyStreamIdsForPath, toggleCopyStreamId, isCopyingStreamId, toggleCopyStreamIds, changeEnabledStreamsFilter, applyEnabledStreamsFilter, enabledStreamsFilter, toggleCopyAllStreamsForPath } = useStreamsMeta({ mainStreams, externalFilesMeta, filePath, autoExportExtraStreams, showGenericDialog });

  const onDurationChange = useCallback<ReactEventHandler<HTMLVideoElement>>((e) => {
    // Some files report duration infinity first, then proper duration later
    // Sometimes after seeking to end of file, duration might change
    const { duration: durationNew } = e.currentTarget;
    console.log('onDurationChange', durationNew);
    if (isDurationValid(durationNew)) {
      setFileDuration(durationNew);
      // patch: the merged window has no cut list - its rows are the read-only chapters. The
      // upstream full-length segment would show up as one unnamed chapter when the merged file has
      // none (an older merged file, see usePatchMergedChapters).
      if (!mergedMode) maybeCreateFullLengthSegment(durationNew);
    }
  }, [maybeCreateFullLengthSegment, mergedMode]);

  const segmentsAtCursor = useMemo(() => findSegmentsAtCursor(commandedTime).map((index) => cutSegments[index]), [commandedTime, cutSegments, findSegmentsAtCursor]);
  const firstSegmentAtCursor = useMemo(() => segmentsAtCursor[0], [segmentsAtCursor]);

  // patch: the cut queue shows two numbers per segment: its rank by start time (which does not
  // change when the queue is reordered) and its position in the queue. The numbers must match what
  // the export would do: the initial full-length segment is never exported, and when the user has
  // selected nothing the export falls back to all segments.
  const patchSegmentNumbers = useMemo(() => {
    if (!patchMode) return undefined;
    const nothingSelected = segmentsOrInverse.selected.length === 0;
    return buildSegmentOrderNumbers(cutSegments
      .filter((seg) => !seg.initial)
      .map((seg) => ({
        segId: seg.segId,
        start: seg.start,
        end: seg.end,
        selected: seg.selected || nothingSelected,
      })));
  }, [cutSegments, patchMode, segmentsOrInverse.selected.length]);

  const segmentAtCursorRef = useRef<StateSegment>(undefined);
  useEffect(() => {
    segmentAtCursorRef.current = firstSegmentAtCursor;
  }, [firstSegmentAtCursor]);

  const seekRelPercent = useCallback((val: number) => {
    if (!isDurationValid(zoomedDuration)) return;
    seekRel(val * zoomedDuration);
  }, [seekRel, zoomedDuration]);

  // patch: in patch mode a frame step pauses for the seek and puts the previous playback state
  // back once it lands, so stepping backwards cannot race the playhead (see
  // features/patchFrameStep). Base mode keeps the upstream step below untouched.
  const patchStepFrame = useFrameStep({ enabled: patchMode, videoRef, fps: detectedFps, getRelevantTime, setCommandedTime, seekAbs, filePath });

  const shortStep = useCallback((direction: number) => {
    if (patchStepFrame(direction) || !videoRef.current) return;

    // If we don't know fps, just assume 30 (for example if unknown audio file)
    const fps = detectedFps || 30;

    // try to align with frame
    const currentTimeNearestFrameNumber = getFrameCountRaw(fps, videoRef.current.currentTime);
    invariant(currentTimeNearestFrameNumber != null);
    const nextFrame = currentTimeNearestFrameNumber + direction;
    seekAbs(nextFrame / fps);
  }, [detectedFps, patchStepFrame, seekAbs, videoRef]);

  const jumpSegStart = useCallback((index: number) => {
    const seg = cutSegments[index];
    if (seg != null) seekAbs(seg.start);
  }, [cutSegments, seekAbs]);
  const jumpSegEnd = useCallback((index: number) => {
    const seg = cutSegments[index];
    if (seg?.end != null) seekAbs(seg.end);
  }, [cutSegments, seekAbs]);
  const jumpCutStart = useCallback(() => jumpSegStart(currentSegIndexSafe), [currentSegIndexSafe, jumpSegStart]);
  const jumpCutEnd = useCallback(() => jumpSegEnd(currentSegIndexSafe), [currentSegIndexSafe, jumpSegEnd]);
  // patch: Shift+Right stops a lead-in before the end (pressing it again goes to the end).
  // The lead-in is a patch setting shared with the player window.
  // The cut-results windows play one clip (a cut result), so the key previews the tail of that
  // clip there; the cutting window previews the tail of the selected cut segment, and the merged
  // window previews the tail of the current read-only chapter.
  const jumpSegmentEndPreview = useCallback(() => {
    const range = resolveSegmentEndPreviewRange({
      scope: (playerMode && !mergedMode) ? 'timeline' : 'segment',
      segments: cutSegments,
      selectedIndex: currentSegIndexSafe,
      timeline: isDurationValid(fileDuration) ? { start: 0, end: fileDuration } : undefined,
    });
    if (range == null) return;
    seekAbs(getSegmentEndPreviewTime({
      start: range.start,
      end: range.end,
      currentTime: getRelevantTime(),
      leadInSeconds: patchWork?.segmentLeadInSeconds ?? defaultPatchSettings.segmentLeadInSeconds,
    }));
  }, [currentSegIndexSafe, cutSegments, fileDuration, getRelevantTime, patchWork?.segmentLeadInSeconds, mergedMode, playerMode, seekAbs]);
  const jumpTimelineStart = useCallback(() => seekAbs(0), [seekAbs]);
  const jumpTimelineEnd = useCallback(() => seekAbs(fileDuration), [fileDuration, seekAbs]);

  // const getSafeCutTime = useCallback((cutTime, next) => ffmpeg.getSafeCutTime(neighbouringFrames, cutTime, next), [neighbouringFrames]);

  const outputDir = getOutDir(customOutDir, filePath);

  const increaseRotation = useCallback(() => {
    setRotation((r) => (r + 90) % 450);
    setHideCompatPlayer(false);
    // Matroska is known not to work, so we warn user. See https://github.com/mifi/lossless-cut/discussions/661
    const supportsRotation = !isMatroska(fileFormat);
    if (!supportsRotation) showNotification({ text: i18n.t('Lossless rotation might not work with this file format. You may try changing to MP4') });
  }, [fileFormat, showNotification]);

  const { ensureWritableOutDir, ensureAccessToSourceDir } = useDirectoryAccess({ setCustomOutDir });

  const toggleCaptureFormat = useCallback(() => setCaptureFormat((f) => {
    const captureFormats: CaptureFormat[] = ['jpeg', 'png', 'webp'];
    let index = captureFormats.indexOf(f);
    if (index === -1) index = 0;
    index += 1;
    if (index >= captureFormats.length) index = 0;
    const newCaptureFormat = captureFormats[index];
    invariant(newCaptureFormat != null);
    return newCaptureFormat;
  }), [setCaptureFormat]);

  const toggleKeyframeCut = useCallback((showMessage?: boolean) => setKeyframeCut((val) => {
    const newVal = !val;
    if (showMessage) {
      if (newVal) showNotification({ title: i18n.t('Keyframe cut enabled'), text: i18n.t('Will now cut at the nearest keyframe before the desired start cutpoint. This is recommended for most files.') });
      else showNotification({ title: i18n.t('Keyframe cut disabled'), text: i18n.t('Will now cut at the exact position, but may leave an empty portion at the beginning of the file. You may have to set the cutpoint a few frames before the next keyframe to achieve a precise cut'), timer: 7000 });
    }
    return newVal;
  }), [showNotification, setKeyframeCut]);

  const toggleSimpleMode = useCallback(() => setSimpleMode((v) => {
    showNotification({ text: i18n.t(v ? 'Advanced view has been enabled. You will now also see non-essential buttons and functions' : 'Advanced view disabled. You will now see only the most essential buttons and functions') });
    return !v;
  }), [setSimpleMode, showNotification]);

  const effectiveExportMode = useMemo(() => {
    if (segmentsToChaptersOnly) return 'segments_to_chapters';
    if (autoMerge && autoDeleteMergedSegments) return 'merge';
    if (autoMerge) return 'merge+separate';
    return 'separate';
  }, [autoDeleteMergedSegments, autoMerge, segmentsToChaptersOnly]);

  const changeOutDir = useCallback(async () => {
    const newOutDir = await askForOutDir(outputDir);
    if (newOutDir) setCustomOutDir(newOutDir);
  }, [outputDir, setCustomOutDir]);

  const ensureWritableOutDirWithFilePath = useCallback(async ({ outDir }: { outDir: string | undefined }) => ensureWritableOutDir({ inputPath: filePath, outDir }), [ensureWritableOutDir, filePath]);

  const toggleStoreProjectInWorkingDir = useCallback(async () => {
    const newValue = !storeProjectInWorkingDir;
    const path = getProjectFileSavePath(newValue);
    if (path) { // path will be falsy if no file loaded
      try {
        await ensureAccessToSourceDir(path);
      } catch (err) {
        if (err instanceof DirectoryAccessDeclinedError) return;
        console.error(err);
      }
    }
    setStoreProjectInWorkingDir(newValue);
  }, [ensureAccessToSourceDir, getProjectFileSavePath, setStoreProjectInWorkingDir, storeProjectInWorkingDir]);

  const userSettingsContext = useMemo<UserSettingsContextType>(() => {
    const { settings, ...rest } = allUserSettings;

    return {
      ...settings, ...rest, toggleCaptureFormat, changeOutDir, toggleKeyframeCut, toggleExportConfirmEnabled, toggleSimpleMode, toggleSafeOutputFileName, effectiveExportMode, ensureWritableOutDirWithFilePath,
    };
  }, [allUserSettings, changeOutDir, effectiveExportMode, ensureWritableOutDirWithFilePath, toggleCaptureFormat, toggleExportConfirmEnabled, toggleKeyframeCut, toggleSafeOutputFileName, toggleSimpleMode]);

  const segColorsContext = useMemo<SegColorsContextType>(() => ({
    getSegColor: (seg: SegmentColorIndex | undefined) => {
      const color = getSegColor(seg);
      return color.desaturate(preferStrongColors ? 0.2 : 0.6);
    },
    nextSegColorIndex: isInitialSegment(cutSegments) ? segColorCounter : segColorCounter + 1,
  }), [cutSegments, preferStrongColors, segColorCounter]);

  const onActiveSubtitleChange = useCallback(async (index?: number) => {
    if (index == null) {
      setActiveSubtitleStreamIndex(undefined);
      return;
    }
    if (subtitlesByStreamId[index]) { // Already loaded
      setActiveSubtitleStreamIndex(index);
      return;
    }
    const subtitleStream = index != null && subtitleStreams.find((s) => s.index === index);
    if (!subtitleStream || workingRef.current) return;

    setWorking({ text: i18n.t('Loading subtitle') });
    try {
      await withErrorHandling(async () => {
        invariant(filePath != null);
        await loadSubtitle({ filePath, index, subtitleStream });
        setActiveSubtitleStreamIndex(index);
      }, i18n.t('Failed to load subtitles from track {{index}}', { index }));
    } finally {
      setWorking(undefined);
    }
  }, [subtitlesByStreamId, subtitleStreams, workingRef, setWorking, withErrorHandling, filePath, loadSubtitle]);

  const onActiveVideoStreamChange = useCallback((videoStreamIndex?: number) => {
    invariant(videoRef.current);
    setHideCompatPlayer(false);
    enableVideoTrack(videoRef.current, videoStreamIndex);
    setActiveVideoStreamIndex(videoStreamIndex);
  }, [videoRef]);

  const onActiveAudioStreamsChange = useCallback((audioStreamIndexes: Set<number>) => {
    invariant(videoRef.current);
    setHideCompatPlayer(false);
    enableAudioTrack(videoRef.current, [...audioStreamIndexes][0]);
    setActiveAudioStreamIndexes(audioStreamIndexes);
  }, [videoRef]);

  const allFilesMeta = useMemo(() => ({
    ...externalFilesMeta,
    ...(filePath && mainFileMeta != null && { [filePath]: mainFileMeta.ffprobeMeta }),
  }), [externalFilesMeta, filePath, mainFileMeta]);

  // total number of streams for ALL files
  const numStreamsTotal = Object.values(allFilesMeta).flatMap(({ streams }) => streams).length;

  const hasAudio = Boolean(mainAudioStream);
  const hasVideo = Boolean(mainVideoStream);

  const forceBigWaveform = !hasVideo && hasAudio;

  const toggleWaveformMode = useCallback(() => {
    if (forceBigWaveform) return;

    if (waveformModePreference === 'waveform') {
      setWaveformMode('big-waveform');
    } else if (waveformModePreference === 'big-waveform') {
      setWaveformMode(undefined);
    } else {
      showNotification({ text: i18n.t('Mini-waveform has been enabled. Click again to enable full-screen waveform') });
      setWaveformMode('waveform');
    }
  }, [forceBigWaveform, setWaveformMode, showNotification, waveformModePreference]);

  const waveformMode = forceBigWaveform ? 'big-waveform' : waveformModePreference;

  const waveformEnabled = hasAudio && waveformMode != null;
  const bigWaveformEnabled = waveformEnabled && waveformMode === 'big-waveform';
  const showThumbnails = thumbnailsEnabled && hasVideo;

  const { thumbnailsSorted, setThumbnails } = useThumbnails({ filePath, zoomedDuration, zoomWindowStartTime, showThumbnails });

  const { neighbouringKeyFrames, findNearestKeyFrameTime, keyframeByNumber, readAllKeyframes } = useKeyframes({ keyframesEnabled, filePath, commandedTime, videoStream: activeVideoStream, detectedFps, ffmpegExtractWindow, maxKeyframes, currentCutSegOrWholeTimeline, setWorking, setMaxKeyframes, handleError });

  // patch: patch mode steps keyframes from the previous target and reads packets when the upstream
  // cache misses, so holding Alt+Left/Right keeps moving while the video plays (features/patchSeek).
  const { stepKeyframe } = useKeyframeStep({
    enabled: patchMode,
    keyframeTimes: () => neighbouringKeyFrames.map((frame) => frame.time),
    liveTime: getRelevantTime,
    commandedTime,
    sigma: detectedFps ? (1 / detectedFps) : 0.1,
    filePath,
    streamIndex: activeVideoStream?.index,
    window: ffmpegExtractWindow,
    seekAbs,
  });

  const { waveforms, overviewWaveform, renderOverviewWaveform } = useWaveform({ filePath, relevantTime, waveformEnabled, audioStream: activeAudioStreams[0], ffmpegExtractWindow, fileDuration });

  const currentFrame = useMemo(() => {
    const frameNum = getFrameCount(commandedTime);
    if (frameNum == null) return undefined;
    return keyframeByNumber[frameNum];
  }, [commandedTime, getFrameCount, keyframeByNumber]);

  const generateOverviewWaveform = useCallback(async () => {
    if (working) return;
    try {
      setWorking({ text: t('Generating full overview waveform, this may take a few minutes.') });
      await renderOverviewWaveform();
    } finally {
      setWorking();
    }
  }, [renderOverviewWaveform, setWorking, t, working]);

  const shouldShowKeyframes = keyframesEnabled && hasVideo && calcShouldShowKeyframes(zoomedDuration);
  const shouldShowWaveform = calcShouldShowWaveform(zoomedDuration) || overviewWaveform != null;

  const areWeCutting = useMemo(() => segmentsToExport.some(({ start, end }) => isCuttingStart(start) || isCuttingEnd(end, fileDuration)), [fileDuration, segmentsToExport]);
  const needSmartCut = areWeCutting && enableSmartCut;

  // patch: a source stored so that a lossless copy is unusable (features/damagedSource). Detected when
  // the file is opened; the answer decides the preview and how the export encodes this file.
  const damageSettings = useMemo(() => ({
    playbackRepair: damagedSourcePlaybackRepair,
    playbackRepairQuality: damagedSourcePlaybackRepairQuality,
    exportRepair: damagedSourceExportRepair,
  }), [damagedSourceExportRepair, damagedSourcePlaybackRepair, damagedSourcePlaybackRepairQuality]);
  const damagedSource = useDamagedSource({
    patchMode,
    filePath,
    canExport: !playerMode && !mergedMode,
    // patch: the full-resolution preview renumbers frames at the source rate; without one the main
    // process falls back to 30 while the audio keeps its timestamps, and the two drift apart.
    frameRateKnown: activeVideoStream == null || (getStreamFps(activeVideoStream) ?? 0) > 0,
    settings: damageSettings,
    showGenericDialog,
    // The chosen quality is one answer for every damaged file, so it goes into the settings.
    onQualityChosen: setDamagedSourcePlaybackRepairQuality,
    // The export switch is the same one the export dialog shows.
    onExportRepairChosen: setDamagedSourceExportRepair,
  });
  const damagePolicy = damagedSource.policy;

  /**
  patch: the preview quality of a damaged source is derived, not copied into state. The setting can
  change while the file is open (the opening dialog, the settings panel, the player's own selector),
  and a derived value follows all three without an effect that could miss a change. It also avoids a
  first render at the wrong quality followed by a restart at the right one.

  Upstream's own quality button (`mediaSourceQuality`) is not shown for a damaged file: the player
  control is the single place that decides it.
  */
  const damagedPreviewQualityIndex = mediaSourceQualities.indexOf(damagePolicy.playbackQuality === 'original' ? 'OG' : 'HD');
  const effectiveMediaSourceQuality = damagePolicy.playbackNeedsTranscode ? damagedPreviewQualityIndex : mediaSourceQuality;
  // patch: the repair encodes the whole video track, so smart cut is off for this file (see features/
  // damagedSource: encoding only the joins would leave the copied middle broken). Lossy mode already
  // encodes every segment, so it stays as it is.
  const effectiveNeedSmartCut = needSmartCut && !damagePolicy.forbidsPartialEncode;
  const effectiveIsEncoding = lossyMode != null || effectiveNeedSmartCut;

  const {
    concatFiles, html5ifyDummy, cutMultiple, concatCutSegments, html5ify, fixInvalidDuration, decimate, extractStreams, tryDeleteFiles,
  } = useFfmpegOperations({ filePath, treatInputFileModifiedTimeAsStart, treatOutputFileModifiedTimeAsStart, isEncoding: effectiveIsEncoding, lossyMode, repairVideoEncode: damagePolicy.exportNeedsVideoEncode, enableOverwriteOutput, outputPlaybackRate, cutFromAdjustmentFrames, cutToAdjustmentFrames, appendLastCommandsLog, encCustomBitrate: encBitrate, appendFfmpegCommandLog, ffmpegHwaccel });

  const { previewFilePath, setPreviewFilePath, usingDummyVideo, setUsingDummyVideo, userHtml5ifyCurrentFile, convertFormatBatch, html5ifyAndLoadWithPreferences } = useHtml5ify({
    filePath, hasVideo, hasAudio, workingRef, setWorking, ensureWritableOutDir, customOutDir, batchFiles, enableAutoHtml5ify, setProgress, html5ify, html5ifyDummy, withErrorHandling, showGenericDialog,
  });

  const compatPlayerRequired = (
    // if user selected an explicit video or audio stream, and the html5 player does not have any track index corresponding to the selected stream index
    (
      (activeVideoStreamIndex != null || activeAudioStreamIndexes.size === 1)
      && videoRef.current != null
      && !canHtml5PlayerPlayStreams(videoRef.current, activeVideoStreamIndex, [...activeAudioStreamIndexes][0])
    )
    // or if selected multiple audio streams (html5 video element doesn't support that)
    || activeAudioStreamIndexes.size > 1
  );
  // if user selected a rotation, but they might want to turn off the rotation preview
  // but allow the user to disable
  // patch: a damaged source needs the same ffmpeg-assisted player to look right, and the same X
  // button turns the repair off to see the file as it really is (features/damagedSource).
  const compatPlayerWanted = (isRotationSet && !hideCompatPlayer)
    || usingDummyVideo
    || (damagePolicy.playbackNeedsTranscode && !hideCompatPlayer);

  const compatPlayerEnabled = (compatPlayerRequired || compatPlayerWanted) && (activeVideoStream != null || activeAudioStreams.length > 0);

  // patch: the finish job moves the files the repair preview reads, and that preview's ffmpeg keeps
  // the source locked on Windows. `usePatchFinish` unmounts the preview for the duration of the job,
  // so the process is gone before the first move (see `main/ffmpegChildren.ts`).
  const [patchPreviewSuspended, setPatchPreviewSuspended] = useState(false);
  const patchCompatPlayerEnabled = compatPlayerEnabled && !patchPreviewSuspended;
  const patchSuspendPreview = useCallback(() => {
    // Synchronous on purpose: the unmount (and with it the abort of the preview process) has to
    // happen before the job is asked to move the file, not on the next render.
    // eslint-disable-next-line @eslint-react/dom-no-flush-sync -- patch: see above
    flushSync(() => { setPatchPreviewSuspended(true); });
  }, []);
  const patchResumePreview = useCallback(() => { setPatchPreviewSuspended(false); }, []);

  useEffect(() => {
    // Reset the user preference when we go from not having compat player to having it
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (compatPlayerEnabled) setHideCompatPlayer(false);
  }, [compatPlayerEnabled]);

  const shouldShowPlaybackStreamSelector = videoStreams.length > 0 || audioStreams.length > 0 || (subtitleStreams.length > 0 && !compatPlayerEnabled);

  const usingPreviewFile = Boolean(previewFilePath);
  const effectiveFilePath = previewFilePath || filePath;
  useEffect(() => {
    if (!effectiveFilePath) return undefined;
    const url = (() => {
      const baseUrl = pathToFileURL(effectiveFilePath).href;
      // https://github.com/mifi/lossless-cut/issues/1674
      if (cacheBuster !== 0) {
        const qs = new URLSearchParams();
        qs.set('t', String(cacheBuster));
        return `${baseUrl}?${qs.toString()}`;
      }
      return baseUrl;
    })();

    const video = videoRef.current;
    if (video) {
      video.src = url;
    }

    return () => {
      // Apparently this is the correct way to unload a video
      // See commit 260603f613632850c301f72f0fca267b06b688a0
      // and https://github.com/mifi/lossless-cut/issues/2907
      if (video) {
        video.pause();
        video.removeAttribute('src'); // empty source
        video.load();
      }
    };
  }, [cacheBuster, effectiveFilePath, videoRef]);

  const resetState = useCallback(() => {
    console.log('State reset');
    const video = videoRef.current;
    // patch: a seek that waits for its `seeked` event must not survive the file switch - the next
    // file fires that event and lands on the stale position (clamped to its end).
    resetPendingSeek();
    setCommandedTime(0);
    if (video != null) video.currentTime = 0;
    setPlaybackRate(1);

    // setWorking();
    setPreviewFilePath(undefined);
    setUsingDummyVideo(false);
    setPlaying(false);
    playingRef.current = false;
    setPlaybackMode(undefined);
    setFileDuration(undefined);
    cutSegmentsHistory.history[0] = []; // in case we have exceeded capacity
    cutSegmentsHistory.go(0);
    setDetectedFileFormat(undefined);
    setRotation(360);
    setProgress(undefined);
    setStartTimeOffset(0);
    setFilePath(undefined);
    setExternalFilesMeta({});
    setParamsByFile(new Map());
    setDetectedFps(undefined);
    setMainFileMeta(undefined);
    setCopyStreamIdsByFile({});
    setStreamsSelectorShown(false);
    setZoom(1);
    setThumbnails([]);
    setShortestFlag(false);
    setZoomWindowStartTime(0);
    setSubtitlesByStreamId({});
    setActiveAudioStreamIndexes(new Set());
    setActiveVideoStreamIndex(undefined);
    setActiveSubtitleStreamIndex(undefined);
    setHideCompatPlayer(false);
    setExportConfirmOpen(false);
    setOutputPlaybackRateState(1);
    setCurrentFileExportCount(0);
  }, [videoRef, resetPendingSeek, setCommandedTime, setPlaybackRate, setPreviewFilePath, setUsingDummyVideo, setPlaying, playingRef, setPlaybackMode, cutSegmentsHistory, setDetectedFileFormat, setCopyStreamIdsByFile, setThumbnails, setSubtitlesByStreamId, setOutputPlaybackRateState]);


  const showNotNativelySupportedMessage = useCallback(() => {
    showNotification({ timer: 13000, text: i18n.t('File is not natively supported. Preview playback may be slow and of low quality, but the final export will be lossless. You may convert the file from the menu for a better preview.') });
  }, [showNotification]);

  const showPreviewFileLoadedMessage = useCallback((fileName: string) => {
    showNotification({ icon: 'info', text: i18n.t('Loaded existing preview file: {{ fileName }}', { fileName }) });
  }, [showNotification]);

  const handleHideCompatPlayerClick = useCallback(() => {
    setHideCompatPlayer(true);
    setPreviewFilePath(undefined);
    setUsingDummyVideo(false);
  }, [setHideCompatPlayer, setPreviewFilePath, setUsingDummyVideo]);

  const { captureFrameFromTag, captureFrameFromFfmpeg, captureFrameToClipboard, captureFramesRange } = useFrameCapture({ appendFfmpegCommandLog, formatTimecode, treatInputFileModifiedTimeAsStart, treatOutputFileModifiedTimeAsStart, fileDuration });

  const getNewJumpIndex = (oldIndex: number, direction: -1 | 1) => Math.max(oldIndex + direction, 0);

  const jumpSeg = useCallback((params: ({ abs: number } | { rel: -1 | 1 }) & { seek?: true }) => {
    const clamp = (v: number) => Math.max(0, Math.min(v, cutSegments.length - 1));

    const seek = (index: number) => {
      if (params.seek && cutSegments[index]) seekAbs(cutSegments[index].start);
    };

    if ('abs' in params) {
      const index = clamp(params.abs);
      setCurrentSegIndex(index);
      seek(index);
    } else {
      setCurrentSegIndex((old) => {
        const index = clamp(getNewJumpIndex(old, params.rel));
        seek(index);
        return index;
      });
    }
  }, [cutSegments, seekAbs, setCurrentSegIndex]);

  const togglePlay = useCallback(({ resetPlaybackRate, requestPlaybackMode }: { resetPlaybackRate?: boolean, requestPlaybackMode?: PlaybackMode } | undefined = {}) => {
    setPlaybackMode(requestPlaybackMode);

    // patch: the element decides, not the mirror. A finish job releases the player (`src` removed,
    // `load()`), a natural end and an `abort` can leave `playingRef` at `true` over a paused element,
    // and then the play key only ever called `pause()` on a paused element - a silent no-op that made
    // the key look dead. `resolvePlayKeyIntent` corrects the mirror in both directions.
    const video = videoRef.current;
    const intent = resolvePlayKeyIntent({ playing: playingRef.current, videoPaused: video?.paused });
    playingRef.current = intent.playing;
    if (intent.playing !== playing) setPlaying(intent.playing);
    if (intent.action === 'pause') {
      pause();
      return;
    }

    // patch: the last source (and the last result) loops instead of closing. Playback stops at the
    // end and stays there; pressing play again starts the same file from the beginning.
    if (patchMode && playbackModeRef.current == null && video != null && isDurationValid(fileDuration) && video.currentTime >= fileDuration - getFrameDuration(detectedFps) * 1.5) {
      seekAbs(0);
    }

    // If we are using a special playback mode, we might need to do more:
    if (playbackModeRef.current != null) {
      const selectedSegmentsWithoutMarkers = filterNonMarkers(selectedSegments);
      const selectedSegmentAtCursor = selectedSegmentsWithoutMarkers.find((selectedSegment) => selectedSegment.segId === segmentAtCursorRef.current?.segId);
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
  }, [setPlaybackMode, playingRef, playing, setPlaying, playbackModeRef, play, pause, selectedSegments, commandedTimeRef, currentCutSeg, cutSegments, setCurrentSegIndex, seekAbs, patchMode, videoRef, fileDuration, detectedFps]);

  const onTimeUpdate = useCallback<ReactEventHandler<HTMLVideoElement>>((e) => {
    const { currentTime } = e.currentTarget;
    if (playerTime === currentTime) return;
    setPlayerTime(currentTime);

    const segmentsAtCursorIndexes = findSegmentsAtCursor(commandedTimeRef.current);
    const firstSegmentAtCursorIndex = segmentsAtCursorIndexes[0];
    const playingSegment = firstSegmentAtCursorIndex != null ? cutSegments[firstSegmentAtCursorIndex] : undefined;

    if (playbackModeRef.current != null && playingRef.current && playingSegment?.end != null) {
      const nextAction = getPlaybackAction({ playbackMode: playbackModeRef.current, currentTime, playingSegment: { start: playingSegment.start, end: playingSegment.end } });

      const exit = () => {
        setPlaybackMode(undefined);
        pause();
      };

      if (nextAction != null) {
        console.log(nextAction);
        if (nextAction.nextSegment) {
          const selectedSegmentsWithoutMarkers = filterNonMarkers(selectedSegments);

          const index = selectedSegmentsWithoutMarkers.findIndex((selectedSegment) => selectedSegment.segId === playingSegment.segId);
          let newSelectedSegmentIndex = getNewJumpIndex(index !== -1 ? index : 0, 1);
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

  const closeFileWithConfirm = useCallback(async () => {
    if (!isFileOpened || workingRef.current) return;

    if (askBeforeClose && !(await confirmDialog({ focusConfirm: true, description: i18n.t('Are you sure you want to close the current file?') }))) return;

    // patch: the project file is written with a debounce (useSegmentsAutoSave), so closing the file
    // straight after a mark would drop it. Flush the pending save first.
    await flushProjectSave();
    // patch: release the "this video is open here" claim, so another window may open it.
    if (patchMode && !playerMode && !mergedMode) {
      await mainApi.patchReleaseSourceClaims().catch((err: unknown) => { console.warn('Failed to release the source claim', err); });
    }
    resetState();
    clearSegments();
  }, [isFileOpened, workingRef, askBeforeClose, confirmDialog, flushProjectSave, patchMode, playerMode, mergedMode, resetState, clearSegments]);

  const closeBatch = useCallback(async () => {
    // patch: patch mode never destroys the list - it only hides it, so the batch survives the whole
    // session and can be shown again with the command console (`tbfl`). Base mode is unchanged.
    if (patchModeConsole != null) {
      patchModeConsole.setBatchFilesListVisible(false);
      return;
    }
    if (askBeforeClose && !(await confirmDialog({ focusConfirm: true, description: i18n.t('Are you sure you want to close the loaded batch of files?') }))) return;
    setBatchFiles([]);
    setSelectedBatchFiles([]);
  }, [askBeforeClose, confirmDialog, patchModeConsole]);

  // patch: the source file list can be cleared from its context menu (a row, the header, or the
  // panel around the rows). Only the queue is dropped: the open video and its results stay. The
  // confirmation has its own setting, separate from the upstream askBeforeClose.
  const clearBatchFiles = useCallback(async () => {
    if ((patchWork?.confirmClearFileList ?? true) && !(await confirmDialog({
      focusConfirm: true,
      description: t('Are you sure you want to clear the source file list?'),
      footer: <PatchConfirmClearFileListCheckbox />,
    }))) return;
    setBatchFiles([]);
    setSelectedBatchFiles([]);
  }, [confirmDialog, patchWork?.confirmClearFileList, t]);

  const clearBatchFilesFromMenu = useCallback(() => {
    clearBatchFiles().catch((err: unknown) => { console.error('Failed to clear the file list', err); });
  }, [clearBatchFiles]);

  const batchListRemoveFile = useCallback((path: string | undefined) => {
    setBatchFiles((existingBatch) => {
      // patch: the row is found the way the file system compares, so a row written under another
      // spelling of the same file can still be removed (base mode keeps the exact string).
      const index = existingBatch.findIndex((existingFile) => path != null && (patchMode
        ? isSamePath(existingFile.path, path, { caseInsensitive: manifestPathCaseInsensitive })
        : existingFile.path === path));
      if (index === -1) return existingBatch;
      const newBatch = [...existingBatch];
      newBatch.splice(index, 1);
      const newItemAtIndex = newBatch[index];
      if (newItemAtIndex != null) setSelectedBatchFiles([newItemAtIndex.path]);
      else if (newBatch.length > 0) setSelectedBatchFiles([newBatch[0]!.path]);
      else setSelectedBatchFiles([]);
      return newBatch;
    });
  }, [patchMode]);

  const commonSettings = useMemo(() => {
    const { keyBindings: _keyBindings, ...rest } = allUserSettings.settings;
    return { ...rest, ffmpegVersion: ffmpegInfo?.program_version.version };
  }, [allUserSettings.settings, ffmpegInfo?.program_version.version]);

  const openSendReportDialogWithState = useCallback(async (err?: unknown) => {
    const state = {
      ...commonSettings,

      filePath,
      fileFormat,
      externalFilesMeta,
      mainStreams,
      copyStreamIdsByFile,
      cutSegments: cutSegments.map((s) => ({ start: s.start, end: s.end })),
      mainFileFormat,
      rotation,
      shortestFlag,
      effectiveExportMode,
    };

    openSendReportDialog({ err, state });
  }, [commonSettings, copyStreamIdsByFile, cutSegments, effectiveExportMode, externalFilesMeta, fileFormat, filePath, mainFileFormat, mainStreams, rotation, shortestFlag]);

  const openSendConcatReportDialogWithState = useCallback(async (err: unknown, reportState?: object) => {
    const state = { ...commonSettings, ...reportState };
    openSendReportDialog({ err, state });
  }, [commonSettings]);

  const handleExportFailed = useCallback(async (err: unknown) => {
    // patch: let the dialog recognize a cause that no format/track/cut-mode change can fix (a piece
    // of the clip lost a track), instead of showing the generic suggestions.
    const errorText = isExecaError(err)
      ? [getStdioString(err.stdout), getStdioString(err.stderr)].filter(Boolean).join('\n')
      : undefined;
    const sendErrorReport = await showExportFailedDialog({ fileFormat, safeOutputFileName, errorText });
    if (sendErrorReport) openSendReportDialogWithState(err);
  }, [fileFormat, safeOutputFileName, openSendReportDialogWithState]);

  const handleConcatFailed = useCallback(async (err: unknown, reportState: object) => {
    const sendErrorReport = await showConcatFailedDialog({ fileFormat });
    if (sendErrorReport) openSendConcatReportDialogWithState(err, reportState);
  }, [fileFormat, openSendConcatReportDialogWithState]);

  const generateCutFileNames = useCallback(async (template: string, onNameContexts?: (contexts: GeneratedNameContext[]) => void) => {
    invariant(fileFormat != null && outputDir != null && filePath != null);
    return generateCutFileNamesRaw({ fileDuration, exportCount, currentFileExportCount, segmentsToExport, template, formatTimecode, isCustomFormatSelected, fileFormat, sourceFile: { path: filePath, ...mainFileMeta }, outputDir, safeOutputFileName, maxLabelLength, outputFileNameMinZeroPadding, ...((onNameContexts != null) && { onNameContexts }) });
  }, [currentFileExportCount, exportCount, fileDuration, fileFormat, filePath, formatTimecode, isCustomFormatSelected, mainFileMeta, maxLabelLength, outputDir, outputFileNameMinZeroPadding, safeOutputFileName, segmentsToExport]);

  const generateCutMergedFileNames = useCallback(async (template: string) => {
    invariant(fileFormat != null && outputDir != null && filePath != null);
    return generateCutMergedFileNamesRaw({ template, isCustomFormatSelected, fileFormat, sourceFile: { path: filePath, ...mainFileMeta }, outputDir, safeOutputFileName, maxLabelLength, exportCount, currentFileExportCount, segLabels: segmentsToExport.map((seg) => seg.name ?? '') });
  }, [currentFileExportCount, exportCount, fileFormat, filePath, isCustomFormatSelected, mainFileMeta, maxLabelLength, outputDir, safeOutputFileName, segmentsToExport]);

  const generateMergedFileNames = useCallback(async (params: GenerateMergedOutFileNamesParams) => (
    generateMergedFileNamesRaw({ ...params, isCustomFormatSelected, safeOutputFileName, maxLabelLength, exportCount })
  ), [exportCount, isCustomFormatSelected, maxLabelLength, safeOutputFileName]);

  const userConcatFiles = useCallback(async ({ paths, includeAllStreams, streams, fileFormat: outFormat, clearBatchFilesAfterConcat, generatedFileNames }: {
    paths: string[],
    includeAllStreams: boolean,
    streams: FFprobeStream[],
    fileFormat: string,
    clearBatchFilesAfterConcat: boolean,
    generatedFileNames: GeneratedOutFileNames,
  }) => {
    if (workingRef.current) return;

    const firstPath = paths[0];
    if (!firstPath) return;

    try {
      // need to ensure the output dir is writable, because the user might not yet have opened a file, and so MAS might not yet have access to write the dir
      const newCustomOutDir = await ensureWritableOutDir({ inputPath: firstPath, outDir: customOutDir });
      if (newCustomOutDir !== customOutDir) {
        // throw user back to the concat dialog because now things might have changed (which could affect overwriting files etc!)
        // also if the user cancels the dialog, `DirectoryAccessDeclinedError` will be thrown and we will return (see catch below)
        return;
      }

      // only after ensuring out dir access, we can close the concat dialog
      setConcatDialogOpen(false);
      setWorking({ text: i18n.t('Merging') });

      const warnings = new Set<string>();
      const notices = new Set<string>();

      const { fileNames, problems } = generatedFileNames;
      if (problems.error != null) {
        console.warn('Merged file name invalid, using default instead', fileNames[0]);
        warnings.add(problems.error);
        warnings.add(t('Fell back to default output file name'));
      }

      const outDir = getOutDir(customOutDir, firstPath);

      const [fileName] = fileNames;
      invariant(fileName != null);
      const outPath = getOutPath({ customOutDir, filePath: firstPath, fileName });

      const chaptersFromSegments = segmentsToChapters
        ? await createChaptersFromSegments({ paths, defaultChapterNames: paths.map((path) => parsePath(path).name), useFileChapters: true })
        : undefined;

      let inputSize: number;
      try {
        inputSize = sum(await readFileSizes(paths));
      } catch (err) {
        console.warn('Unable to read input file sizes', err);
        throw makeSourceFileAccessError();
      }

      // patch: do not start a merge that cannot fit on the output volume (features/patchSpace). A
      // merge that would be skipped (existing output, overwrite disabled) writes nothing.
      if (patchMode) {
        const targetExists = pathExistsSync(outPath);
        const willWrite = enableOverwriteOutput || !targetExists;
        if (willWrite) {
          const reclaimBytes = targetExists ? await readFileSize(outPath).catch(() => 0) : 0;
          const fits = await confirmPatchSpace({
            writes: [{ dir: outDir, estimatedBytes: estimateConcatBytes({ inputBytes: inputSize }), reclaimBytes }],
          });
          if (!fits) return;
        }
      }

      // console.log('merge', paths);
      const metadataFromPath = paths[0];
      invariant(metadataFromPath != null);

      await maybeMkDeepOutDir({ outputDir: outDir, fileOutPath: outPath });

      const { haveExcludedStreams } = await concatFiles({ paths, outPath, outDir, outFormat, metadataFromPath, includeAllStreams, streams, ffmpegExperimental, onProgress: setProgress, preserveMovData, movFastStart, preserveMetadataOnMerge, chapters: chaptersFromSegments });

      const outputSize = await readFileSize(outPath); // * 1.06; // testing:)
      const sizeCheckResult = checkFileSizes(inputSize, outputSize);
      if (sizeCheckResult != null) warnings.add(sizeCheckResult);

      if (clearBatchFilesAfterConcat) closeBatch();
      if (!includeAllStreams && haveExcludedStreams) notices.add(i18n.t('Some extra tracks have been discarded. You can change this option before merging.'));
      if (!enableOverwriteOutput) warnings.add(i18n.t('Overwrite output setting is disabled and some files might have been skipped.'));

      if (!hideAllNotifications) {
        showOsNotification(i18n.t('Merge finished'));
        openConcatFinishedDialog({ filePath: outPath, notices: [...notices], warnings: [...warnings] });
      }
    } catch (err) {
      if (err instanceof DirectoryAccessDeclinedError || isAbortedError(err)) return;

      showOsNotification(i18n.t('Failed to merge'));

      if (isExecaError(err)) {
        console.log('stdout:', getStdioString(err.stdout));
        console.error('stderr:', getStdioString(err.stderr));

        if (isOutOfSpaceError(err)) {
          showDiskFull();
          return;
        }
        if (isMuxNotSupported(err)) {
          showMuxNotSupported();
          return;
        }
      }

      if (err instanceof OutputNotWritableError) {
        showOutputNotWritable();
        return;
      }

      if (err instanceof UserFacingError) {
        errorToast(err.message);
        return;
      }

      const reportState = { includeAllStreams, streams, outFormat, clearBatchFilesAfterConcat };
      handleConcatFailed(err, reportState);
    } finally {
      setWorking(undefined);
      setProgress(undefined);
    }
  }, [workingRef, ensureWritableOutDir, customOutDir, setWorking, segmentsToChapters, concatFiles, ffmpegExperimental, preserveMovData, movFastStart, preserveMetadataOnMerge, closeBatch, enableOverwriteOutput, hideAllNotifications, t, showOsNotification, openConcatFinishedDialog, handleConcatFailed, patchMode]);

  const cleanupFiles = useCallback(async (cleanupChoices2: CleanupChoicesType) => {
    // Store paths before we reset state
    const savedPaths = { previewFilePath, sourceFilePath: filePath, projectFilePath: projectFileSavePath };

    if (cleanupChoices2.closeFile) {
      batchListRemoveFile(savedPaths.sourceFilePath);

      // patch: closing the file drops the cut list, and the project file is written with a debounce:
      // flush the pending marks first (the finish flow does the same before moving the source).
      await flushProjectSave();

      // close the file
      resetState();
      clearSegments();
    }

    await withErrorHandling(async () => {
      const abortController = new AbortController();
      setWorking({ text: i18n.t('Cleaning up'), abortController });
      console.log('Cleaning up files', cleanupChoices2);

      const pathsToDelete: string[] = [];
      if (cleanupChoices2.trashTmpFiles && savedPaths.previewFilePath) pathsToDelete.push(savedPaths.previewFilePath);
      if (cleanupChoices2.trashProjectFile && savedPaths.projectFilePath) pathsToDelete.push(savedPaths.projectFilePath);
      if (cleanupChoices2.trashSourceFile && savedPaths.sourceFilePath) pathsToDelete.push(savedPaths.sourceFilePath);

      await deleteFiles({ paths: pathsToDelete, deleteIfTrashFails: cleanupChoices2.deleteIfTrashFails, signal: abortController.signal });
    }, i18n.t('Unable to delete file'));
  }, [batchListRemoveFile, clearSegments, filePath, flushProjectSave, previewFilePath, projectFileSavePath, resetState, setWorking, withErrorHandling]);

  const askForCleanupChoices = useCallback(async () => {
    const trashResponse = await openCleanupFilesDialog(cleanupChoices);
    if (trashResponse != null) setCleanupChoices(trashResponse); // Store for next time, if not canceled
    return trashResponse;
  }, [cleanupChoices, openCleanupFilesDialog, setCleanupChoices]);

  const cleanupFilesDialog = useCallback(async () => {
    if (!isFileOpened || workingRef.current) return;

    try {
      const newCleanupChoices = cleanupChoices.askForCleanup ? await askForCleanupChoices() : cleanupChoices;
      // only if not canceled
      if (newCleanupChoices != null) await cleanupFiles(newCleanupChoices);
    } finally {
      setWorking(undefined);
    }
  }, [askForCleanupChoices, cleanupChoices, cleanupFiles, isFileOpened, setWorking, workingRef]);

  const closeExportConfirm = useCallback(() => setExportConfirmOpen(false), []);

  // patch: the export guard lives in the finish hook (it needs the batch list, which is defined
  // below); the export callbacks reach it through this stable ref.
  const patchFinishGuardRef = useRef<() => Promise<boolean>>(async () => true);

  const willMerge = segmentsToExport.length > 1 && autoMerge;
  // patch: whether this export actually cuts clips (the chapters modes only write a chapter file).
  const patchCutsClips = patchMode && !segmentsToChaptersOnly && !segmentsToChapters && segmentsToExport.length > 0;
  // patch: whether the cut results are named by the patch `{token}` rule (features/patchCutName).
  // The clips of the merged-only flow are throw-away, so they keep the upstream default template.
  const patchNamesCutResults = patchCutsClips && !(willMerge && autoDeleteMergedSegments);

  // patch: how the cut ends are handled for this export. Every patch cut follows it, including a
  // single result: the repair rewrites the clip's ends, so it cannot be added later when the user
  // merges results that were cut on separate days. Base mode keeps the upstream command line.
  const patchHasBFrames = videoStreams[0]?.has_b_frames;
  // patch: a display matrix is the modern way to mark a rotated phone video; `effectiveRotation`
  // only knows the user's own rotation (and the legacy `tags.rotate`). The join repair cannot follow
  // either one: ffmpeg applies it physically when re-encoding, so the repaired parts would come out
  // upright while the copied middle stays rotated.
  const patchSourceDisplayRotation = videoStreams[0]?.side_data_list?.find((sideData) => sideData.rotation != null)?.rotation;
  // patch: either source has to block the repair, so they are combined instead of fallen back from:
  // a legacy `tags.rotate` of `0` is a real value and would otherwise hide a display matrix (the
  // repaired parts would come out upright while the copied middle stays rotated).
  const patchSourceRotation = [effectiveRotation, patchSourceDisplayRotation].find((candidateRotation) => (
    candidateRotation != null && Number.isFinite(candidateRotation) && candidateRotation % 360 !== 0
  ));
  // patch: -shortest ends the output when *any* stream ends, so the copied streams decide whether it
  // is safe: a subtitle track, a short audio track or a track from another file would cut the video.
  const patchCopiedStreamFacts = useMemo(() => {
    const copied = copyFileStreams.flatMap((file) => {
      const streams = allFilesMeta[file.path]?.streams ?? [];
      return streams.filter((stream) => file.streamIds.includes(stream.index)).map((stream) => ({ path: file.path, stream }));
    });
    return {
      hasExternalStreams: copyFileStreams.some((file) => file.path !== filePath && file.streamIds.length > 0),
      hasNonAvStreams: copied.some(({ stream }) => stream.codec_type !== 'video' && stream.codec_type !== 'audio'),
      hasAudioStream: copied.some(({ stream }) => stream.codec_type === 'audio'),
      hasShortAudioStream: copied.some(({ stream }) => {
        if (stream.codec_type !== 'audio' || fileDuration == null) return false;
        const streamDuration = Number(stream.duration);
        return Number.isFinite(streamDuration) && streamDuration > 0 && streamDuration < fileDuration - 1;
      }),
    };
  }, [allFilesMeta, copyFileStreams, fileDuration, filePath]);
  const patchCutPolicy = resolveCutPolicy({
    policy: mergeBoundary.policy,
    guard: mergeBoundary.guard,
    patchMode,
    detectedFps,
    hasBFrames: patchHasBFrames,
    shortestRequested: shortestFlag,
    hasVideoStream: videoStreams.length > 0,
    videoCodec: videoStreams[0]?.codec_name,
    rotation: patchSourceRotation,
    ...patchCopiedStreamFacts,
  });
  // patch: what policy A keeps, shown in the dialog even while B or C is chosen.
  const patchGuardInfo = {
    guardFrames: getTailGuardFrames({ guard: mergeBoundary.guard, hasBFrames: patchHasBFrames, fps: detectedFps }),
    guardSeconds: getCutTailGuardSeconds({ guard: mergeBoundary.guard, hasBFrames: patchHasBFrames, fps: detectedFps }),
  };
  // patch: warn once when the opened source cannot be decoded at its head (features/patchSourceHealth).
  // The results windows play results, not sources, so they stay quiet.
  const patchSourceDamaged = usePatchSourceHealth({ patchMode: patchMode && !playerMode && !mergedMode, filePath });

  // patch: a source inside `.losslesscut_work` or `losslesscut_finished` is almost always a video
  // whose finish job already ran. Cutting it there would nest a work area (and it would be easy to
  // cut a result that is about to be deleted), so the cutting window becomes a viewer: the badge
  // explains why, the bottom bar is greyed and every cut/export key opens the folder dialog instead
  // (see `usePatchFinish`).
  const patchReadOnlySource = useMemo(
    () => (patchMode && !playerMode && !mergedMode && filePath != null ? resolveReadOnlySourceArea(filePath, patchWork?.dirNames ?? defaultPatchDirNames) : undefined),
    [filePath, mergedMode, patchMode, patchWork?.dirNames, playerMode],
  );
  // The badge and its tooltip for the read-only source, in both areas. Kept out of the JSX so the
  // two states stay next to each other.
  const patchReadOnlySourceCopy = patchReadOnlySource == null ? undefined : {
    work: {
      badge: t('In the work directory'),
      tooltip: t('This video is inside the work directory, so it is probably already finished. Cutting is disabled.'),
    },
    finished: {
      badge: t('In the finished folder'),
      tooltip: t('This video is inside the finished folder, so it is already finished. Cutting is disabled.'),
    },
  }[patchReadOnlySource];

  // patch: the cut queue's Shift+click multi-selection (features/patchSegmentQueue). Only the
  // cutting window's queue has it: the results window has no segment list, the merged window's
  // chapters are read-only, and invert mode's rows are the gaps between the segments. A read-only
  // source can still be swept and marked (it only decides what an export would use), but its rows
  // cannot be deleted.
  const patchMultiSelect = useSegmentMultiSelect({
    enabled: patchMode && !playerMode && !mergedMode && !invertCutSegments,
    segments: cutSegments,
    removeSegments,
    applySegmentsSelection,
    locked: isPatchExportBlocked(),
    readOnly: patchReadOnlySource != null,
  });

  // patch: a results window declares the clip it plays, so another window (another instance) does not
  // move or delete it under the player. Reading a result is never refused - two windows may play the
  // same file -, so a failure here must not block opening; the claim only gates rename/finish/export.
  // The claim follows the file this window plays and goes away with it: on a file change, when the
  // window unloads the video (an export/finish job needs the handle) and when the window closes. Every
  // refusal says "stop it there first", so stopping must actually release it.
  //
  // `cacheBuster` is a dependency because a reload is how the video comes back after the release
  // listener below: the path stays the same, so without it the window would keep playing a result
  // that the destructive paths no longer see as in use.
  useEffect(() => {
    if (!patchMode || !(playerMode || mergedMode) || inspectMode || filePath == null) return undefined;
    const kind = mergedMode ? 'merged' : 'cut-results';
    // Release by kind drops every claim of that kind, so a cleanup that runs late (StrictMode, a fast
    // file switch) must not remove the claim a newer effect just took.
    patchResultClaimGenerationRef.current += 1;
    const generation = patchResultClaimGenerationRef.current;
    const isLatest = () => patchResultClaimGenerationRef.current === generation;
    const release = () => {
      if (!isLatest()) return;
      mainApi.patchReleaseResultClaims({ kind }).catch((err: unknown) => {
        console.warn('Failed to release the result claim', err);
      });
    };
    let cancelled = false;
    (async () => {
      await mainApi.patchClaimResultFile({ path: filePath, kind }).catch((err: unknown) => {
        console.warn('Failed to claim the result file', err);
      });
      // The cleanup ran while the claim was in flight (StrictMode, a fast file switch), so its release
      // found no file: release the one that just landed (unless a newer effect already claimed).
      if (cancelled) release();
    })();
    return () => {
      cancelled = true;
      release();
    };
  }, [cacheBuster, filePath, inspectMode, mergedMode, patchMode, playerMode]);

  // patch: the cut names this export writes, resolved once for the export, the dialog preview and the
  // early path-length guard (they must not disagree about a name or a problem).
  const resolvePatchCutExportNames = useCallback((epochMs: number) => {
    if (!patchNamesCutResults || filePath == null || fileFormat == null) return undefined;
    const cutOutputDir = getOutDir(patchWorkDirs?.clipsDir ?? customOutDir, filePath);
    const namingSegments = getGuaranteedSegments(segmentsToExport, fileDuration);
    const clips: CutNameClip[] = namingSegments.map((segment) => ({
      ...((segment.name != null) && { label: segment.name }),
      start: segment.start,
      end: segment.end,
    }));
    return {
      clips,
      resolved: resolvePatchCutNames({
        rule: patchCutName.rule,
        sourcePath: filePath,
        clips,
        outputDir: cutOutputDir,
        ext: getOutFileExtension({ isCustomFormatSelected, outFormat: fileFormat, filePath }),
        epochMs,
        exportCount,
        labelSeparator: patchCutName.labelSeparator,
        maxLabelLength,
        minZeroPadding: outputFileNameMinZeroPadding,
        isWindows,
        caseInsensitive: manifestPathCaseInsensitive,
      }),
    };
  }, [patchNamesCutResults, filePath, fileFormat, patchWorkDirs?.clipsDir, customOutDir, segmentsToExport, fileDuration, patchCutName.rule, patchCutName.labelSeparator, isCustomFormatSelected, exportCount, maxLabelLength, outputFileNameMinZeroPadding]);

  // patch: the merged name of this export, resolved once for the export, the dialog preview and the
  // early path-length guard (see `resolvePatchCutExportNames`).
  const resolvePatchExportMergedName = useCallback((epochMs: number, rule: string = patchMergedName.rule) => {
    if (!patchMode || filePath == null || fileFormat == null) return undefined;
    const sourcePath = filePath;
    const mergedDir = getOutDir(patchWorkDirs?.mergedDir ?? customOutDir, sourcePath);
    return resolvePatchMergedName({
      rule,
      sourcePath,
      labels: segmentsToExport.map((segment) => segment.name),
      outputDir: mergedDir,
      ext: getOutFileExtension({ isCustomFormatSelected, outFormat: fileFormat, filePath: sourcePath }),
      epochMs,
      exportCount,
      labelSeparator: patchMergedName.labelSeparator,
      maxLabelLength,
      isWindows,
    });
  }, [patchMode, filePath, fileFormat, patchWorkDirs?.mergedDir, customOutDir, segmentsToExport, patchMergedName.rule, patchMergedName.labelSeparator, isCustomFormatSelected, exportCount, maxLabelLength]);

  const onExportConfirm = useCallback(async ({ force = false }: { force?: boolean } = {}) => {
    // patch: a source video inside a work directory has to move out before it can be cut.
    if (patchMode && !playerMode && !(await patchFinishGuardRef.current())) return;
    // patch: the finish job moves and deletes the results/manifest this export writes. It runs in the
    // main process without filling `working`, so the button stays enabled while it runs.
    if (patchMode && (patchFinishJobRunningRef.current || patchFinishExecutingRef.current)) {
      showNotification({ icon: 'info', text: i18n.t('A finish job is moving files. Wait for it to finish.') });
      return;
    }
    // patch: the finish dialog lists the results the job will move. An export started behind it would
    // write new results the dialog does not show (and its name plan does not know).
    if (patchMode && patchFinishDialogOpenRef.current) {
      showNotification({ icon: 'info', text: i18n.t('Close the finish dialog before exporting.') });
      return;
    }

    // patch: the cut queue must have at least one segment to export. Upstream falls back to "all
    // segments" when nothing is selected, but in patch mode that would cut exactly the segments the
    // user just took out of the queue (and record an order they never chose). Ask for a segment.
    if (patchMode && !playerMode && !mergedMode && !invertCutSegments && !segmentsToChaptersOnly && !segmentsToChapters) {
      const hasCutSegment = cutSegments.some((segment) => segment.selected && !segment.initial && segment.end != null);
      if (!hasCutSegment) {
        errorToast(i18n.t('Select at least one segment to export.'));
        return;
      }
    }

    invariant(filePath != null && outputDir != null);
    // patch: patch mode emits this right before the first file is touched (after the free-space
    // check), so a cancelled export does not unload the result windows.
    if (!patchMode) emitEvent({ eventName: 'export-start', path: filePath });

    if (numStreamsToCopy === 0) {
      errorToast(i18n.t('No tracks selected for export'));
      return;
    }

    if (haveInvalidSegs) {
      errorToast(i18n.t('Start time must be before end time'));
      return;
    }

    // patch: a cut or merged name that does not fit the folder stops the export here, before
    // anything is written and while the options sheet stays open: the user has to shorten the
    // working folder or the rule (the dialog preview already shows the same error).
    if (patchMode && !playerMode) {
      const cutNames = resolvePatchCutExportNames(patchExportNameEpochRef.current);
      const mergedName = willMerge ? resolvePatchExportMergedName(patchExportNameEpochRef.current) : undefined;
      const pathTooLong = (cutNames != null && 'problem' in cutNames.resolved && cutNames.resolved.problem.code === 'pathTooLong')
        || (mergedName != null && 'problem' in mergedName && mergedName.problem.code === 'pathTooLong');
      if (pathTooLong) {
        await showPathTooLong();
        return;
      }
    }

    setStreamsSelectorShown(false);
    setExportConfirmOpen(false);

    // patch: the export cannot run twice: our own cut-list lock and the cutter's output would fight
    // each other. Say so instead of silently doing nothing (the sheet has already been closed).
    if (workingRef.current) {
      // Another operation (not this export) is running: say what to wait for.
      getSwal().toast.fire({ icon: 'info', text: i18n.t(isPatchExporting() ? 'Wait for the current export to finish.' : 'Wait for the current operation to finish.') });
      return;
    }
    // patch: an export is a real save. A cut list that came from a video-named `.llc` is otherwise
    // held back by the auto-save, and the exported results would have no project file behind them.
    if (patchMode) await flushProjectSaveForced();

    /** Did this call reach its end (so the run card may show the result)? */
    let exportSucceeded = false;
    /** Did it fail (the card says so, unlike a plain cancel)? */
    let exportFailed = false;
    /** What this export cuts; compared at the end, in case the list was force-unlocked meanwhile. */
    const exportListSnapshot = planPatchExportListSnapshot(segmentsToExport);
    /** The work area this export holds the cross-window lock of (`undefined`: none). */
    const exportWorkRoot = patchMode ? patchWork?.effectiveRoot : undefined;
    /** Did this export take the work-area lock? */
    let exportLockHeld = false;
    try {
      setWorking({ text: i18n.t('Exporting') });
      // patch: the run state and the guards live in the patch shell (`features/patchExportRun`).
      // The run outlives the shared `working` slot, which an unrelated operation may clear. Base
      // mode keeps the upstream overlay.
      if (patchMode) {
        // A new export locks again: the escape hatch only lasted until here.
        forceUnlockedRef.current = false;
        exportRun?.begin();
      }

      // Special segments-to-chapters mode:
      let chaptersToAdd: Chapter[] | undefined;
      if (segmentsToChaptersOnly) {
        const sortedSegments = sortSegments(segmentsOrInverse.selected);
        if (hasAnySegmentOverlap(sortedSegments)) {
          errorToast(i18n.t('Make sure you have no overlapping segments.'));
          return;
        }
        // matroska supports gaps, so we can use segments directly
        chaptersToAdd = isMatroska(fileFormat) ? sortedSegments : convertSegmentsToChaptersWithGaps(sortedSegments);
      }

      console.log('cutFileTemplate', cutFileTemplateOrDefault);

      const notices = new Set<string>();
      const warnings = new Set<string>();

      let cutFileNames: string[];
      // patch: the variables each result was named with, so the player can re-render the name when
      // a result's label changes (see features/patchPlayer).
      let cutNameContexts: GeneratedNameContext[] = [];
      const onNameContexts = (contexts: GeneratedNameContext[]) => { cutNameContexts = contexts; };
      // patch: the results named by the `{token}` rule instead of the upstream `${}` template
      // (features/patchCutName). The chapters modes write one file for the whole source and the
      // merged-only flow writes throw-away clips, so both keep the upstream naming.
      const patchCutNaming = patchNamesCutResults;
      // patch: the record of each result, in export order (only with `patchCutNaming`).
      let patchCutContexts: RuleCutNameContext[] = [];
      if (patchCutNaming) {
        const cutNames = resolvePatchCutExportNames(patchExportNameEpochRef.current);
        if (cutNames == null) throw new Error(i18n.t('No file is loaded'));
        const { resolved } = cutNames;
        if ('problem' in resolved) {
          // patch: a path that leaves no room for the names is not replaced by another rule: the
          // export stops until the user shortens the working folder or the rule.
          if (resolved.problem.code === 'pathTooLong') throw new UserFacingError(cutNameProblemMessage(resolved.problem));
          // A rule that cannot name the results must not fail the export: the upstream default
          // template always produces usable names (same fallback the merged rule uses).
          console.warn('Cut result name rule invalid, using the default template instead', resolved.problem);
          warnings.add(cutNameProblemMessage(resolved.problem));
          warnings.add(t('Fell back to default output file name'));
          const generated = await generateCutFileNames(defaultCutFileTemplate, onNameContexts);
          cutFileNames = generated.fileNames;
          if (generated.problems.error != null) warnings.add(generated.problems.error);
        } else {
          cutFileNames = resolved.names;
          patchCutContexts = resolved.contexts;
          if (resolved.suffixes.some((suffix) => suffix !== '')) {
            warnings.add(t('Some cut results share a name, so a number and the time were appended to keep them apart.'));
          }
        }
      } else if (willMerge && autoDeleteMergedSegments) {
        // When deleting merged segments, use the default template so that we e.g. don't risk creating a folder structure
        // https://github.com/mifi/lossless-cut/issues/2637
        const generated = await generateCutFileNames(defaultCutFileTemplate, onNameContexts);
        cutFileNames = generated.fileNames;
      } else {
        const generated = await generateCutFileNames(cutFileTemplateOrDefault, onNameContexts);
        cutFileNames = generated.fileNames;
        if (generated.problems.error != null) {
          console.warn('Output segments file name invalid, using default instead', generated.fileNames);
          warnings.add(generated.problems.error);
          warnings.add(t('Fell back to default output file name'));
        }
      }

      // patch: the work area may have been removed since the working directory was picked, so make
      // sure it exists before the cut results are written into it.
      if (patchMode) await patchWork?.ensureWorkDirs();

      // patch: one job at a time per work area, across windows (`allowMultipleInstances`). Another
      // window exporting into the same areas would fight over the manifest and the result files.
      // `finally` releases it (the work root is captured above the try for that).
      if (patchMode && exportWorkRoot != null) {
        const lock = await mainApi.patchAcquireWorkLock({ workRoot: exportWorkRoot, owner: 'export' });
        if (!lock.ok) {
          if (lock.reason === 'busy') showNotification({ icon: 'info', text: i18n.t('Another window is using this work folder. Wait for its export to finish.') });
          else errorToast(lock.message);
          return;
        }
        exportLockHeld = true;
      }

      // patch: incremental export. Only with a work area (the manifest lives in it) and not for the
      // chapters modes (their output contains every segment's chapter data).
      const workRoot = patchWork?.effectiveRoot;
      const incremental = patchMode && workRoot != null && !segmentsToChaptersOnly && !segmentsToChapters;
      // When the clips are deleted after merging, the merged file is the only result to compare;
      // the clips are temporary and cannot be reused.
      const mergedOnly = willMerge && autoDeleteMergedSegments;
      const incrementalClips = incremental && !mergedOnly;

      const toPatchNameContext = (generated: GeneratedNameContext | undefined, index: number): PatchNameContext | undefined => (
        // patch: a result named by the cut rule carries that rule's record; everything else keeps
        // the upstream template context.
        patchCutContexts[index] ?? (generated == null ? undefined : {
          template: generated.template,
          outputDir,
          context: generated.context,
          emptyLabelSuffix: generated.emptyLabelSuffix,
          maxLabelLength,
          safeOutputFileName,
        })
      );

      let mergedOutFilePath: string | undefined;
      if (willMerge) {
        // patch: a merged result's project sidecar is not tracked, so one left by an older build is
        // cleaned up here (its video is already gone) before the next merge writes a new result.
        if (patchWorkDirs?.mergedDir != null) await deleteOrphanProjectFiles(patchWorkDirs.mergedDir, manifestPathCaseInsensitive);
        let fileName: string;
        if (patchMode) {
          // patch: the merged result follows the patch `{token}` rule (features/patchMergeName),
          // not the upstream template. A rule that cannot render falls back to the default one, so
          // the export still produces its merged file; a name that does not fit stops it instead.
          if (filePath == null || fileFormat == null) throw new Error(i18n.t('No file is loaded'));
          let nameResult = resolvePatchExportMergedName(patchExportNameEpochRef.current);
          if (nameResult == null) throw new Error(i18n.t('No file is loaded'));
          if ('problem' in nameResult) {
            if (nameResult.problem.code === 'pathTooLong') throw new UserFacingError(mergedNameProblemMessage(nameResult.problem));
            warnings.add(mergedNameProblemMessage(nameResult.problem));
            warnings.add(t('Fell back to default output file name'));
            nameResult = resolvePatchExportMergedName(patchExportNameEpochRef.current, patchMergedName.defaultRule);
            if (nameResult == null) throw new Error(i18n.t('No file is loaded'));
          }
          if ('problem' in nameResult) {
            if (nameResult.problem.code === 'pathTooLong') throw new UserFacingError(mergedNameProblemMessage(nameResult.problem));
            warnings.add(mergedNameProblemMessage(nameResult.problem));
            return;
          }
          fileName = nameResult.fileName;
        } else {
          const { fileNames, problems } = await generateCutMergedFileNames(cutMergedFileTemplateOrDefault);
          if (problems.error != null) {
            console.warn('Merged file name invalid, using default instead', fileNames[0]);
            warnings.add(problems.error);
            warnings.add(t('Fell back to default output file name'));
          }
          const [generatedName] = fileNames;
          invariant(generatedName != null);
          fileName = generatedName;
        }
        // patch: merged results live in the work area's `merged` directory (see features/patchWork).
        mergedOutFilePath = getOutPath({ customOutDir: patchWorkDirs?.mergedDir ?? customOutDir, filePath, fileName });
      }

      const guaranteedSegments = getGuaranteedSegments(segmentsToExport, fileDuration);
      const exportSegments = incremental ? guaranteedSegments : [];
      // patch: the time-last segment reaches the source's real last frame (the player's duration can
      // be shorter, see features/patchExportPolicy/tailEnd), while the queue-last segment keeps the
      // frame at its cut end. Time and queue order are separate, so a reorder never drops the
      // source-end extension.
      const patchTailEnabled = patchMode && !segmentsToChaptersOnly && !segmentsToChapters && mergeBoundary.tailToSourceEnd;
      let patchTailTargetList: PatchTailTarget[] = [];
      if (patchTailEnabled && guaranteedSegments.length > 0) {
        let sourceEnd: number | undefined;
        try {
          sourceEnd = await getDuration(filePath);
        } catch (err) {
          console.warn('Patch tail: could not read the source video end, using the player duration', err);
        }
        patchTailTargetList = getPatchTailTargets({
          segments: guaranteedSegments,
          allSegments: segmentsOrInverse.all,
          fileDuration,
          frameDuration: getFrameDuration(detectedFps),
          sourceEnd,
        });
      }
      const planSegments: PatchExportSegmentInput[] = incremental
        ? exportSegments.map((segment, index) => {
          // patch: the merged result reuses the source scheme, so the color travels with the record.
          const segColorIndex = cutSegments.find((existing) => existing.segId === segment.segId)?.segColorIndex;
          const tail = patchTailTargetList.find((target) => target.segId === segment.segId);
          return {
            segId: segment.segId,
            start: segment.start,
            end: segment.end,
            label: segment.name,
            path: pathJoin(outputDir, cutFileNames[index]!),
            nameContext: toPatchNameContext(cutNameContexts[index], index),
            ...((segColorIndex != null) && { segColorIndex }),
            ...((tail != null) && { tail: tail.mode }),
          };
        })
        : [];

      // patch: two results may not share a name. The manifest would record both under one path and
      // the second cut would silently replace the first one, so refuse the export instead. The
      // names are compared the way the file system does: on Windows/macOS `Clip.mp4` and `clip.mp4`
      // are the same file.
      if (incremental) {
        const seenPaths = new Set<string>();
        for (const segment of planSegments) {
          const key = normalizeManifestPath(segment.path, { caseInsensitive: manifestPathCaseInsensitive });
          if (seenPaths.has(key)) {
            throw new UserFacingError(i18n.t('Output file name template results in duplicate file names (you are trying to export multiple files with the same name). You can fix this for example by adding the "{{segNumVariable}}" variable.', { segNumVariable: `\${${selectedSegNumVariable}}` }));
          }
          seenPaths.add(key);
        }
      }

      let manifest: PatchExportManifest | undefined;
      let fileRecord: PatchExportFileRecord | undefined;
      /** The manifest key of this source (it may differ in spelling from `filePath`). */
      let fileRecordKey = filePath;
      let sourceSignature: string | undefined;
      let exportPlan: PatchExportPlan | undefined;
      let mergedPlan: PatchMergedPlan | undefined;
      let mergedSignature: string | undefined;
      /** The signature every clip has, as the merge plan assumes it. */
      let clipSignatures: (string | undefined)[] | undefined;
      let existingPaths = new Set<string>();
      /**
      The cut-queue order this export records (fork-owned): the segments it selects, in queue order.
      The merge follows it, so a reorder is a change to the manifest even when no clip is cut.
      */
      let exportOrder: string[] = [];
      /** Did the queue order (or the selected set) change since the last export? */
      let orderChanged = false;

      if (incremental && workRoot != null) {
        const stats = await lstat(filePath);
        const signature = hashExportSignature({
          version: 1,
          source: { size: stats.size, mtimeMs: stats.mtimeMs },
          outFormat: fileFormat,
          keyframeCut,
          copyStreams: copyFileStreams,
          shortestFlag,
          ffmpegExperimental,
          preserveMetadata,
          preserveMetadataOnMerge,
          preserveMovData,
          preserveChapters,
          movFastStart,
          avoidNegativeTs: avoidNegativeTs ?? null,
          rotation: isRotationSet ? effectiveRotation : null,
          paramsByFile: serializeParamsByFile(paramsByFile),
          detectedFps: detectedFps ?? null,
          encoding: effectiveIsEncoding,
          enableSmartCut,
          hwaccel: ffmpegHwaccel ?? null,
          cutFromAdjustmentFrames,
          cutToAdjustmentFrames,
          // patch: the cut strategy changes the clips themselves, so an incremental export must
          // re-cut a result that was cut under another policy instead of reusing it.
          ...(patchCutsClips && {
            patchCut: getPatchCutSignature({
              policy: patchCutPolicy.effective,
              guard: mergeBoundary.guard,
              repairJoins: patchCutPolicy.repairJoins,
              tailGuardSeconds: patchCutPolicy.tailGuardSeconds,
              // patch: a clip cut before the damaged source was repaired is a lossless copy that still
              // stutters, and it was not encoded like the repaired clips it would be merged with.
              repairVideoEncode: damagePolicy.exportNeedsVideoEncode,
            }),
          }),
        });
        sourceSignature = signature;

        manifest = await readExportManifest(workRoot);
        // The same source can be opened with another spelling (separators, case on Windows/macOS):
        // reuse the stored key instead of adding a second record for the same file.
        fileRecordKey = findManifestFileKey(manifest.files, filePath, { caseInsensitive: manifestPathCaseInsensitive }) ?? filePath;
        fileRecord = manifest.files[fileRecordKey];

        // patch: the cut queue order is what the merge follows, and it is a user decision the
        // manifest has to keep. A reorder - or a segment taken out of the queue - therefore counts
        // as work even when every clip is reused as it is (`isNoOpExport`), otherwise the second
        // export would look dead and the merge would keep the old order.
        exportOrder = planSegments.map((segment) => segment.segId);
        orderChanged = !isSameOrder(fileRecord?.order, trimOrder(exportOrder, fileRecord?.segments ?? {}));

        const candidatePaths = new Set<string>([
          ...Object.values(fileRecord?.segments ?? {}).map((segment) => segment.path),
          ...planSegments.map((segment) => segment.path),
        ]);
        if (mergedOutFilePath != null) {
          candidatePaths.add(mergedOutFilePath);
          if (fileRecord?.merged != null) candidatePaths.add(fileRecord.merged.path);
        }
        const existing = await Promise.all([...candidatePaths].map(async (path) => (await fileExists(path) ? path : undefined)));
        existingPaths = new Set(existing.filter((path): path is string => path != null));
        // patch: the temporary names of a name swap are not known before the plan, so they are
        // looked up on the disk when the plan asks about them.
        const exists = (path: string) => existingPaths.has(path) || pathExistsSync(path);

        // patch: the plan is built by a function because the no-op prompt below can ask for the
        // same export with `force` (cut everything again) after seeing the first result.
        const buildPlans = (forceExport: boolean) => {
          exportPlan = incrementalClips ? planIncrementalExport({
            segments: planSegments,
            record: fileRecord,
            signature,
            force: forceExport,
            overwriteAllowed: enableOverwriteOutput,
            exists,
            caseInsensitivePaths: manifestPathCaseInsensitive,
          }) : undefined;

          if (!willMerge || mergedOutFilePath == null) return;

          // The merged file is the concatenation of the clips: its fingerprint is built from the
          // clips themselves, so a clip that was cut with other parameters (and was therefore not
          // cut again) is part of it.
          // patch: without an export plan (the merged-only mode) every clip is rewritten: the
          // clips are the app's own files in the work area, so `collectOwnedClipPaths` hands them
          // to the cutter as `overwritePaths` and the cutter replaces them even when "overwrite
          // output" is off. A cut that fails aborts the export, so no signature is written at all.
          // Every clip therefore really has the signature of this export.
          const clips = exportPlan != null
            ? resolveResultSignatures({ decisions: exportPlan.decisions, signature, inheritedSignature: resolveInheritedSignature({ record: fileRecord, signature }) })
            : planSegments.map(() => signature);
          clipSignatures = clips;
          const mergedSig = hashExportSignature(buildMergedSignatureInput({
            segments: planSegments.map((segment, index) => ({ ...segment, signature: clips[index] })),
            merge: { outFormat: fileFormat, ffmpegExperimental, preserveMovData, movFastStart, preserveMetadataOnMerge },
            // patch: the labels are only part of the file when they are written as chapters.
            labelsAffectContent: !patchMode || Boolean(segmentsToChapters && !invertCutSegments),
          }));
          mergedSignature = mergedSig;
          mergedPlan = planMergedExport({
            path: mergedOutFilePath,
            signature: mergedSig,
            previous: fileRecord?.merged,
            force: forceExport,
            overwriteAllowed: enableOverwriteOutput,
            exists,
            caseInsensitivePaths: manifestPathCaseInsensitive,
            // The renames of the cut results run before the merge is written, so they free the
            // names they leave.
            freePaths: exportPlan?.vacatedPaths,
          });
        };
        buildPlans(force);

        // patch: an incremental export that writes nothing (every result is up to date) must not
        // look like a dead key - the export-finished notice can be silenced for good, and in patch
        // mode the only other feedback is the results window. Ask what the user wants instead.
        // `E` - the export key that opened this - presses "Open the results" (the confirm button),
        // while Left/Right still move the focus and Enter still presses the focused button.
        if (patchMode && !force && isNoOpExport({ clips: exportPlan, merged: mergedPlan, orderChanged })) {
          const answer = await getSwal().Swal.fire(withConfirmKeys({
            icon: 'info',
            title: i18n.t('Nothing to export'),
            text: i18n.t('Every result is up to date. Nothing has to be cut again.'),
            showDenyButton: true,
            showCancelButton: true,
            confirmButtonText: i18n.t('Open the results'),
            denyButtonText: i18n.t('Cut again anyway'),
            cancelButtonText: i18n.t('Cancel'),
          }));
          if (answer.isDismissed) return;
          // The user wants the cuts again: rebuild the plan as a forced export (like `exportForce`).
          if (answer.isDenied) buildPlans(true);
        }
      }

      // With `autoDeleteMergedSegments` the clips are temporary: when the merged file itself can be
      // reused, no clip has to be cut at all.
      const skipClipCuts = mergedOnly && mergedPlan != null && mergedPlan.action !== 'regenerate';

      // Only the segments that actually need a cut are passed to ffmpeg; everything else is reused
      // or renamed. `overwritePaths` lets the cutter replace its own previous results even when the
      // user disabled "overwrite output".
      let segmentsForCut = segmentsToExport;
      let namesForCut = cutFileNames;
      if (skipClipCuts) {
        segmentsForCut = [];
        namesForCut = [];
      } else if (exportPlan != null) {
        segmentsForCut = exportPlan.exports.map(({ index }) => exportSegments[index]!);
        namesForCut = exportPlan.exports.map(({ index }) => cutFileNames[index]!);
      }

      // patch: estimate the free space this export needs before it touches any file (features/
      // patchSpace). Reused/renamed results are not in `segmentsForCut`, and a target that is
      // rewritten in place only needs the difference. A cancelled export writes nothing and leaves
      // the result windows open. `segmentsToChaptersOnly` copies the whole file without cutting, so
      // the segment estimate does not describe it and it is left alone.
      if (patchMode && !segmentsToChaptersOnly) {
        // patch: a repair re-encodes the whole video track at a quality target, so the source's
        // bitrate does not describe the result; it uses the same generous factor as a lossy encode.
        const spaceMode: PatchSpaceEstimateMode = (lossyMode != null || damagePolicy.exportNeedsVideoEncode)
          ? 'lossy'
          : (effectiveNeedSmartCut ? 'smartcut' : 'copy');
        const spaceClipSegments = exportPlan != null || segmentsForCut.length > 0
          ? segmentsForCut
          : (skipClipCuts ? [] : getGuaranteedSegments(segmentsToExport, fileDuration));
        const mergedWillBeWritten = willMerge && mergedOutFilePath != null
          && (mergedPlan == null || mergedPlan.action === 'regenerate');
        let sourceBytes: number | undefined;
        try {
          sourceBytes = await readFileSize(filePath);
        } catch (err) {
          console.warn('Unable to read the source size, skipping the free-space check', err);
        }

        if (sourceBytes != null) {
          // patch: a tail target may keep the rest of the source; estimate the space it really writes.
          const estimateSegment = <T extends { segId?: string | undefined, start: number, end: number }>(segment: T): T => {
            const tail = patchTailTargetList.find((target) => target.segId === segment.segId);
            return tail != null ? { ...segment, end: tail.cutTo } : segment;
          };
          const writes = await buildExportSpaceWrites({
            sourceBytes,
            sourceDuration: fileDuration,
            mode: spaceMode,
            outputDir,
            clips: spaceClipSegments.map((segment, index) => ({ segment: estimateSegment(segment), name: namesForCut[index] })),
            merged: mergedWillBeWritten && mergedOutFilePath != null
              ? {
                targetPath: mergedOutFilePath,
                estimateSegments: (exportSegments.length > 0 ? exportSegments : getGuaranteedSegments(segmentsToExport, fileDuration)).map((segment) => estimateSegment(segment)),
                // The old merged file only frees its space when the merge writes to the same path.
                reclaim: mergedPlan == null ? enableOverwriteOutput : mergedPlan.obsoletePath == null,
              }
              : undefined,
          });
          if (!(await confirmPatchSpace({ writes }))) return;
        }
      }

      // patch: never overwrite (or rename away) a result another window is playing. The results
      // window of another instance holds the file open, so the cut would fail on Windows with an
      // error that hides the cause. Only the paths this export really writes are checked: an
      // incremental export that reuses a result leaves it alone.
      if (patchMode && !playerMode) {
        const writePaths = new Set<string>();
        if (exportPlan != null) {
          for (const path of exportPlan.ownedPaths) writePaths.add(path);
          for (const rename of exportPlan.renames) {
            writePaths.add(rename.from);
            writePaths.add(rename.to);
          }
        } else if (!segmentsToChaptersOnly) {
          for (const name of namesForCut) writePaths.add(pathJoin(outputDir, name));
        }
        if (willMerge && mergedOutFilePath != null) writePaths.add(mergedOutFilePath);
        // patch: the export also deletes the results it replaces (an incremental re-cut, the old
        // merged file). Those are files another window may be playing too, and deleting one under a
        // player fails on Windows or leaves the window showing a file that is gone.
        const obsoletePaths = exportPlan?.obsoletePaths ?? [];
        for (const path of obsoletePaths) writePaths.add(path);
        if (mergedPlan?.obsoletePath != null) writePaths.add(mergedPlan.obsoletePath);

        if (writePaths.size > 0) {
          const { inUse } = await mainApi.patchFindResultFilesInUse({ paths: [...writePaths] });
          if (inUse.length > 0) {
            showNotification({ icon: 'info', text: i18n.t('Some cut results are being played in another window. Stop them there first.') });
            return;
          }
        }
      }

      // patch: the player releases its file before the export renames/regenerates results. In patch
      // mode this happens after the free-space check, so a cancelled export does not unload it.
      if (patchMode) emitEvent({ eventName: 'export-start', path: filePath });

      // Rename first: it frees old names before the new files are written.
      if (exportPlan != null) await applyResultRenames(exportPlan.renames);

      // patch: the clips of a merged-only export feed the merge, so they have to be the current
      // ones: a leftover clip of an earlier export is rewritten instead of being merged as it is
      // (the merge would then not match its signature). They are the app's own files (they live in
      // the work area), so they may be replaced even when "overwrite output" is disabled.
      const ownedClipPaths = collectOwnedClipPaths({ mergedOnly, incremental, segments: planSegments });
      const overwritePaths = exportPlan != null
        ? new Set(exportPlan.ownedPaths)
        : (ownedClipPaths.length > 0 ? new Set(ownedClipPaths) : undefined);

      // throw (() => { const err = new Error('test'); err.code = 'ENOENT'; return err; })();
      const patchTailTargets = patchTailTargetList.length > 0
        ? new Map(patchTailTargetList.map((target) => [target.segId, target] as const))
        : undefined;
      const outFiles = segmentsForCut.length === 0 ? [] : await cutMultiple({
        outputDir,
        customOutDir,
        outFormat: fileFormat,
        fileDuration,
        rotation: isRotationSet ? effectiveRotation : undefined,
        copyFileStreams,
        allFilesMeta,
        keyframeCut,
        segments: segmentsForCut,
        cutFileNames: namesForCut,
        // patch: the same progress feeds the shared `working` overlay (base mode) and the floating
        // export card (`features/patchExportRun`).
        onProgress: (reported) => { setProgress(reported); exportRun?.setProgress(reported); },
        // patch: `-shortest` is left out when a copied track would end the clip before the video
        // (see `PatchCutPolicy.shortestBlocked`); the dialog says so.
        shortestFlag: shortestFlag && !patchCutPolicy.shortestBlocked,
        ffmpegExperimental,
        preserveMetadata,
        preserveMetadataOnMerge,
        preserveMovData,
        preserveChapters,
        movFastStart,
        avoidNegativeTs,
        paramsByFile,
        chapters: chaptersToAdd,
        detectedFps,
        cutToGuardSeconds: patchCutPolicy.tailGuardSeconds,
        splitNonAvStreams: patchCutPolicy.splitNonAvStreams,
        repairJoins: patchCutPolicy.repairJoins,
        // patch: a smart cut that cannot be placed becomes a whole-segment encode instead of an error.
        patchMode,
        ...((overwritePaths != null) && { overwritePaths }),
        ...((patchTailTargets != null) && { tailTargets: patchTailTargets }),
      });

      // The final path of every selected segment, in playlist order (reused + renamed + cut).
      let incrementalResults: { path: string, label?: string | undefined, nameContext?: PatchNameContext | undefined, segId?: string | undefined }[] = [];
      /** Segments that produced no result (their name belongs to a file the app does not own). */
      const skippedResultIndices = new Set<number>();
      // patch: the results this export really wrote (cut again). The results window jumps to the
      // earliest of them when it gets the new playlist (see `planPlaylistUpdate`).
      const recutPaths = new Set<string>();
      if (exportPlan != null) {
        const exportedByIndex = new Map<number, { path: string, created: boolean }>();
        exportPlan.exports.forEach(({ index }, position) => {
          const file = outFiles[position];
          if (file != null) exportedByIndex.set(index, { path: file.path, created: file.created });
        });

        incrementalResults = planSegments.map((segment) => ({ path: segment.path, label: segment.label, nameContext: segment.nameContext, segId: segment.segId }));

        exportPlan.decisions.forEach((decision) => {
          const segment = planSegments[decision.index]!;
          switch (decision.kind) {
            case 'reuse': {
              const previous = fileRecord?.segments[segment.segId];
              // The template that is in use now wins: the result may have been cut with another
              // template (the two rendered the same path), and a later label rename must use the
              // current one.
              incrementalResults[decision.index] = {
                path: previous?.path ?? segment.path,
                label: segment.label,
                nameContext: resolveResultNameContext({ current: segment.nameContext, previous: previous?.nameContext }),
                segId: segment.segId,
              };
              break;
            }
            case 'blocked': {
              incrementalResults[decision.index] = { path: decision.previous.path, label: decision.previous.label, nameContext: decision.previous.nameContext, segId: segment.segId };
              break;
            }
            case 'export': {
              const result = exportedByIndex.get(decision.index);
              if (result == null || !result.created) {
                // No file was written. A previous result may be kept; a new segment has nothing.
                if (decision.previous == null) skippedResultIndices.add(decision.index);
                else {
                  incrementalResults[decision.index] = {
                    path: decision.previous.path,
                    label: decision.previous.label,
                    nameContext: decision.previous.nameContext,
                    segId: segment.segId,
                  };
                }
              } else {
                // patch: the cutter wrote this result, so the playlist marks it as re-cut.
                recutPaths.add(segment.path);
              }
              break;
            }
            case 'rename': {
              // initialized from `planSegments` above
              break;
            }
            case 'skipped': {
              skippedResultIndices.add(decision.index);
              break;
            }
          }
        });

        // A skipped segment has no result. Never let its planned path (a file the app does not own)
        // reach the merge or the results list.
        if (skippedResultIndices.size > 0) {
          incrementalResults = incrementalResults.filter((_result, index) => !skippedResultIndices.has(index));
          warnings.add(t('Overwrite output setting is disabled and some files might have been skipped.'));
        }
      }

      const clipPaths = exportPlan != null ? incrementalResults.map((result) => result.path) : outFiles.map((file) => file.path);

      let mergedFileIsOurs = false;
      /** The merged result that exists after this export (`undefined` when there is none). */
      let mergedResultPath: string | undefined;
      /** Did this export actually write the merged file (instead of skipping it)? */
      let mergedWrote = false;
      /** patch: the merged file's read-only chapters, recorded in the manifest and shown in its window. */
      let mergedChaptersForExport: PatchMergedChapter[] | undefined;

      if (willMerge) {
        invariant(mergedOutFilePath != null);

        setProgress(0);
        setWorking({ text: i18n.t('Merging') });

        const chapterNames = segmentsToChapters && !invertCutSegments ? segmentsToExport.map((s) => s.name) : undefined;

        let shouldConcat = true;
        if (mergedPlan != null) {
          switch (mergedPlan.action) {
            case 'reuse': {
              shouldConcat = false;
              mergedFileIsOurs = true;
              mergedResultPath = mergedPlan.path;
              break;
            }
            case 'blocked': {
              mergedOutFilePath = mergedPlan.path;
              shouldConcat = false;
              mergedResultPath = mergedPlan.path;
              break;
            }
            case 'rename': {
              invariant(fileRecord?.merged != null);
              await renameResultFile(fileRecord.merged.path, mergedPlan.path);
              // patch: a sidecar project an older build wrote next to the old name does not belong
              // to the renamed result (it stores the old media name), so it goes with the old name.
              await deleteResultFiles([getProjectSidecarPath(fileRecord.merged.path)]);
              mergedOutFilePath = mergedPlan.path;
              shouldConcat = false;
              mergedFileIsOurs = true;
              mergedResultPath = mergedPlan.path;
              break;
            }
            case 'skipped': {
              // The name is held by a file the app does not own. Do not claim it as a result and
              // do not pretend the merge happened.
              shouldConcat = false;
              warnings.add(t('Overwrite output setting is disabled and some files might have been skipped.'));
              break;
            }
            case 'regenerate': {
              break;
            }
          }
        }

        if (shouldConcat) {
          mergedFileIsOurs = mergedPlan == null
            // Base mode / no work area: there is no ownership information, so the user's
            // "overwrite output" setting decides (the upstream decision: the merge is skipped
            // when the file exists and overwriting is disabled).
            ? mayReplaceMergedFile({
              exists: pathExistsSync(mergedOutFilePath),
              overwriteAllowed: enableOverwriteOutput,
              // The chapters modes are not tracked, so there is no merged result of ours (the
              // record is only read for a tracked export).
              owned: incremental && fileRecord?.merged != null,
            })
            // The planner only regenerates when the target is our own result, is free, or the user
            // allowed replacing it.
            : true;
          mergedWrote = await concatCutSegments({
            customOutDir,
            outFormat: fileFormat,
            segmentPaths: clipPaths,
            ffmpegExperimental,
            preserveMovData,
            movFastStart,
            // patch: the card follows the merge step as well (it is part of the same export).
            onProgress: (reported) => { setProgress(reported); exportRun?.setProgress(reported); },
            chapterNames,
            preserveMetadataOnMerge,
            mergedOutFilePath,
            ...(mergedFileIsOurs && { overwrite: true }),
            repairJoins: patchCutPolicy.repairJoins,
          });
          if (mergedWrote) {
            mergedResultPath = mergedOutFilePath;
          } else {
            mergedFileIsOurs = false;
          }
          // Base mode keeps the upstream reporting even when the cut was skipped.
          if (!incremental) mergedResultPath = mergedOutFilePath;
        }

        // patch: the merged timeline's read-only chapters (features/patchMerged). The clips are still
        // on disk here - they may be deleted just below - so their real durations are probed and the
        // source segment lengths are the fallback. The two numbers are the ones the cut queue shows
        // (colored = start-time rank, plain = queue position), so the merged list reads like it.
        if (patchMode && willMerge && mergedResultPath != null) {
          const orderSegments = planSegments.length > 0
            ? planSegments
            : segmentsForCut.map((segment) => ({ segId: segment.segId, start: segment.start, end: segment.end }));
          const segmentBySegId = new Map(orderSegments.map((segment) => [segment.segId, segment]));
          const numbers = buildSegmentOrderNumbers(orderSegments.map((segment) => ({
            segId: segment.segId,
            start: segment.start,
            end: segment.end,
            selected: true,
          })));

          const chapterEntries = clipPaths.map((path, index) => {
            const result = exportPlan != null ? incrementalResults[index] : undefined;
            const cutSegment = segmentsForCut[index];
            const segId = result?.segId ?? cutSegment?.segId ?? `chapter-${index}`;
            const source = segmentBySegId.get(segId);
            return {
              path,
              segId,
              label: result?.label ?? cutSegment?.name,
              fallbackDuration: source != null ? source.end - source.start : 0,
            };
          });
          const durations = await Promise.all(chapterEntries.map(async (entry) => {
            try {
              const meta = await readFileFfprobeMeta(entry.path);
              const probed = Number.parseFloat(meta.format.duration);
              return Number.isFinite(probed) && probed > 0 ? probed : undefined;
            } catch {
              return undefined;
            }
          }));
          mergedChaptersForExport = buildMergedChapters(chapterEntries.map((entry, index) => ({
            segId: entry.segId,
            label: entry.label,
            segColorIndex: cutSegments.find((existing) => existing.segId === entry.segId)?.segColorIndex,
            duration: durations[index],
            fallbackDuration: entry.fallbackDuration,
            startRank: numbers.get(entry.segId)?.startRank,
            queueRank: numbers.get(entry.segId)?.queueRank,
          })));
        }

        // don't delete existing files that were not created by losslesscut now (due to overwrite disabled) https://github.com/mifi/lossless-cut/issues/2436
        const createdOutFiles = outFiles.flatMap((f) => (f.created ? [f.path] : []));
        if (autoDeleteMergedSegments) await tryDeleteFiles(createdOutFiles);
      }

      // patch: remove the files this export replaced (only after the new ones were written).
      // The old merged file is only removed when the rebuild really happened. Its project sidecar
      // goes with it: the merged window no longer writes one, and a leftover would keep the old name.
      const obsoleteMergedPaths = mergedPlan?.obsoletePath != null && mergedWrote ? [mergedPlan.obsoletePath] : [];
      const obsoletePaths = [
        ...(exportPlan?.obsoletePaths ?? []),
        ...obsoleteMergedPaths,
        ...obsoleteMergedPaths.map((path) => getProjectSidecarPath(path)),
      ];
      if (obsoletePaths.length > 0) await deleteResultFiles(obsoletePaths);

      if (exportPlan != null) {
        const reusedCount = exportPlan.decisions.filter((decision) => decision.kind === 'reuse').length;
        const renamedCount = exportPlan.decisions.filter((decision) => decision.kind === 'rename').length;
        const exportedCount = outFiles.filter((file) => file.created).length;
        if (reusedCount + renamedCount > 0) {
          notices.add(t('{{reused}} results reused, {{renamed}} renamed, {{exported}} exported', { reused: reusedCount, renamed: renamedCount, exported: exportedCount }));
        }
        if (exportPlan.decisions.some((decision) => decision.kind === 'blocked')) {
          warnings.add(t('Some results kept their old name because a file with the new name already exists.'));
        }
        // patch: a reorder (or a segment taken out of the queue) writes no file, so say that the
        // merge order was still saved - otherwise the export looks like it did nothing. A clip that
        // really was cut already shows up in the counts above.
        if (orderChanged && outFiles.every((file) => !file.created)) notices.add(t('The merge order was saved. The clips were not cut again.'));
      }

      // patch: a result that is cut again is written to a file the app owns (the cutter replaces
      // it even when overwriting is disabled), so it is never skipped. Only a result that was
      // really skipped is a warning - otherwise every export would warn and the "do not show this
      // again" of the export notice could never be used.
      if (!enableOverwriteOutput && (exportPlan == null || exportPlan.decisions.some((decision) => decision.kind === 'skipped'))) warnings.add(i18n.t('Overwrite output setting is disabled and some files might have been skipped.'));

      if (!exportConfirmEnabled) notices.add(i18n.t('Export options are not shown. You can enable export options by clicking the icon right next to the export button.'));

      invariant(mainFileFormat != null);
      // https://github.com/mifi/lossless-cut/issues/329
      if (isIphoneHevc(mainFileFormat, mainStreams)) warnings.add(i18n.t('There is a known issue with cutting iPhone HEVC videos. The output file may not work in all players.'));

      // https://github.com/mifi/lossless-cut/issues/280
      if (!ffmpegExperimental && isProblematicAvc1(fileFormat, mainStreams)) warnings.add(i18n.t('There is a known problem with this file type, and the output might not be playable. You can work around this problem by enabling the "Experimental flag" under Settings.'));

      if (exportExtraStreams) {
        try {
          setProgress(undefined); // If extracting extra streams takes a long time, prevent loader from being stuck at 100%
          setWorking({ text: i18n.t('Extracting {{count}} unprocessable tracks', { count: nonCopiedExtraStreams.length }) });
          await extractStreams({ customOutDir, streams: nonCopiedExtraStreams });
          notices.add(i18n.t('Unprocessable streams were exported as separate files.'));
        } catch (err) {
          console.error('Extra stream export failed', err);
          warnings.add(i18n.t('Unable to export unprocessable streams.'));
        }
      }

      if (areWeCutting) notices.add(i18n.t('Cutpoints may be inaccurate.'));

      if (simpleMode && !prefersReducedMotion) shootConfetti({ ticks: 50 });

      if (cleanupChoices.cleanupAfterExport) {
        const newCleanupChoices = cleanupChoices.askForCleanup ? await askForCleanupChoices() : cleanupChoices;
        // only if not canceled
        if (newCleanupChoices) await cleanupFiles(newCleanupChoices);
      }

      // The manifest only changes after the cuts and the merge succeeded; a failure keeps the old
      // records, so the next export can retry with the same knowledge.
      if (incremental && manifest != null && workRoot != null && sourceSignature != null) {
        const previousSegments = fileRecord?.segments;
        let segmentsRecord: Record<string, PatchManifestSegmentRecord> = previousSegments != null ? { ...previousSegments } : {};
        /** Segments whose file this export wrote or renamed: their record is authoritative. */
        const replacedSegIds: string[] = [];
        /** Segments whose clips this export deleted (merged-only mode). */
        let removedSegIds: string[] = [];
        /** The segments whose file this export really wrote. */
        const createdIndices = new Set<number>();
        exportPlan?.exports.forEach(({ index }, position) => {
          if (outFiles[position]?.created) createdIndices.add(index);
        });

        if (mergedOnly) {
          // The clips are temporary: when the merged result is current, delete the clips this
          // manifest still tracks and forget them.
          const mergedIsCurrent = mergedPlan != null && (
            mergedPlan.action === 'reuse'
            || mergedPlan.action === 'rename'
            || (mergedPlan.action === 'regenerate' && mergedWrote)
          );
          const mergedClipSegIds = new Set(planSegments.map((segment) => segment.segId));
          if (mergedIsCurrent) {
            const trackedClipPaths = Object.entries(segmentsRecord)
              .filter(([segId]) => mergedClipSegIds.has(segId))
              .map(([, tracked]) => tracked.path);
            if (trackedClipPaths.length > 0) await deleteResultFiles(trackedClipPaths);
            segmentsRecord = Object.fromEntries(Object.entries(segmentsRecord).filter(([segId]) => !mergedClipSegIds.has(segId)));
            removedSegIds = [...mergedClipSegIds];
          } else {
            // The merge was blocked or skipped, so the clips are not the result. The ones this
            // export cut are deleted anyway (they are temporary), so their records must not stay
            // in the manifest either - the next export would look for a file that is not there.
            const cutClipPaths = outFiles.filter((file) => file.created).map((file) => file.path);
            const pruned = pruneDeletedClipRecords({
              records: segmentsRecord,
              segments: planSegments,
              deletedPaths: cutClipPaths,
              caseInsensitivePaths: manifestPathCaseInsensitive,
            });
            segmentsRecord = pruned.records;
            removedSegIds = pruned.removedSegIds;
          }
        } else if (exportPlan != null) {
          // A local copy: the plan is assigned inside `buildPlans`, which the compiler cannot narrow.
          const plan = exportPlan;
          const merged = mergeExportRecords({
            previousSegments: segmentsRecord,
            segments: planSegments,
            decisions: plan.decisions,
            createdIndices,
            signature: sourceSignature,
            previousKeys: plan.previousKeys,
            caseInsensitivePaths: manifestPathCaseInsensitive,
          });
          segmentsRecord = merged.records;
          // The stale identities a reopened project left behind: the fresh manifest forgets them.
          removedSegIds.push(...merged.removedSegIds);

          plan.decisions.forEach((decision) => {
            const segId = planSegments[decision.index]?.segId;
            if (segId == null) return;
            if (decision.kind === 'rename' || (decision.kind === 'export' && createdIndices.has(decision.index))) {
              replacedSegIds.push(segId);
            } else if (decision.kind === 'reuse') {
              // The record was adopted from another identity (a reopened project): the new key is
              // authoritative even though the fresh manifest does not know it yet.
              const previousKey = plan.previousKeys[decision.index];
              if (previousKey != null && previousKey !== segId) {
                replacedSegIds.push(segId);
              }
            }
          });
        }

        // patch: the merged file is the concatenation of the clips, so its signature describes the
        // clips it was made of. A clip that was not written keeps the content it has, so the
        // signature of the merged file is computed from the signatures the clips really have. The
        // next export then rebuilds the merge instead of reusing a merged file that does not
        // match the clips.
        // The merged-only mode has no export plan, so there are no decisions to resolve: the
        // clips of that mode are always rewritten (see above), so their signatures are the ones
        // of this export.
        const actualClipSignatures = exportPlan != null
          ? resolveResultSignatures({
            decisions: exportPlan.decisions,
            signature: sourceSignature,
            inheritedSignature: resolveInheritedSignature({ record: fileRecord, signature: sourceSignature }),
            createdIndices,
          })
          : clipSignatures;
        const mergedRecordSignature = actualClipSignatures != null
          ? hashExportSignature(buildMergedSignatureInput({
            segments: planSegments.map((segment, index) => ({ ...segment, signature: actualClipSignatures[index] })),
            merge: { outFormat: fileFormat, ffmpegExperimental, preserveMovData, movFastStart, preserveMetadataOnMerge },
            // patch: the labels are only part of the file when they are written as chapters.
            labelsAffectContent: !patchMode || Boolean(segmentsToChapters && !invertCutSegments),
          }))
          : mergedSignature;

        const mergedRecord = willMerge && mergedRecordSignature != null && mergedFileIsOurs && mergedResultPath != null
          ? {
            signature: mergedRecordSignature,
            path: mergedResultPath,
            // The results the merged file was built from: the finish job needs them to prove that
            // deleting the cut results cannot lose anything. A segment that produced no file (its
            // name was taken) is not one of them.
            inputs: buildMergedInputs(
              planSegments
                .map((segment, index) => ({ ...segment, signature: actualClipSignatures?.[index] }))
                .filter((clip) => clip.signature != null),
            ),
            ...((mergedChaptersForExport != null) && { chapters: mergedChaptersForExport }),
          }
          : undefined;

        try {
          // The main process re-reads the manifest inside the write queue and merges this record
          // into it, so a rename made in the results window meanwhile is not lost.
          await updateExportManifest(workRoot, fileRecordKey, {
            signature: sourceSignature,
            segments: segmentsRecord,
            replacedSegIds,
            removedSegIds,
            // The order this export selected its segments in: the merge follows it (see
            // `collectMergeClips`), so a reorder reaches the merge even without a new cut.
            order: exportOrder,
            ...((mergedRecord != null) && { merged: mergedRecord }),
          });
        } catch (err) {
          console.error('Failed to save the export manifest', err);
          warnings.add(t('The export manifest could not be saved. The next export will regenerate every result.'));
        }
      }

      // Note: this should be after cleanup, so we don't accidentally open two dialogs at the same time, leading to error *and* success dialog simultaneously https://github.com/mifi/lossless-cut/issues/2609
      let exportedPaths: string[];
      if (willMerge && mergedResultPath != null) exportedPaths = [mergedResultPath];
      else if (exportPlan != null) exportedPaths = incrementalResults.map((result) => result.path);
      else exportedPaths = outFiles.map((f) => f.path);
      // Nothing may have been written (every result was skipped): show the warnings against the
      // source, but never claim a file the app did not create.
      const revealPath = exportedPaths[0] ?? filePath;

      // patch: the player window gets labels and name contexts, not just paths. A merged result has
      // no single segment label, so it gets no name context (only Shift+N can rename it).
      let cutResultEntries: PatchCutResultEntry[] = [];
      if (patchMode) {
        if (willMerge && mergedResultPath != null) {
          cutResultEntries = [{
            path: mergedResultPath,
            sourcePath: filePath,
            ...((mergedChaptersForExport != null) && { mergedChapters: mergedChaptersForExport }),
          }];
        } else if (exportPlan != null) {
          cutResultEntries = incrementalResults.map((result) => ({
            path: result.path,
            label: result.label,
            segId: result.segId,
            sourcePath: filePath,
            nameContext: result.nameContext,
            ...(recutPaths.has(result.path) && { recut: true }),
          }));
        } else {
          cutResultEntries = outFiles.map((file, i) => {
            const segment = segmentsToExport[i];
            const nameContext = cutNameContexts[i];
            return {
              path: file.path,
              label: segment?.name,
              segId: segment?.segId,
              sourcePath: filePath,
              nameContext: toPatchNameContext(nameContext, i),
            };
          });
        }
      }

      // patch: with the escape hatch (`Tools -> Unlock cutting`) the cut list may have changed while
      // the export ran. The results are still the list from before, so say so - the notices are the
      // last chance to notice the mismatch.
      let cutListChangeNotice: string | undefined;
      if (patchMode) {
        const change = detectPatchExportListChange({ before: exportListSnapshot, after: latestExportListRef.current });
        if (change.changed) cutListChangeNotice = i18n.t('The cut list was changed during the export. The results match the cut list from when the export started.');
      }
      if (cutListChangeNotice != null) notices.add(cutListChangeNotice);

      if (!hideAllNotifications) {
        showOsNotification(i18n.t('Export finished'));
        // patch: in patch mode the export-finished notice is noise in a batch run, so the user can
        // silence it for good. A warning is never silenced: it can mean the output is wrong, so the
        // notice shows every time until the problem is gone.
        const patchHideExportFinished = patchMode && patchNotice != null
          && !shouldShowExportFinishedNotice({ suppressed: patchNotice.suppressedNotices, hasWarnings: warnings.size > 0 });
        if (!patchHideExportFinished) {
          openCutFinishedDialog({
            filePath: revealPath,
            warnings: [...warnings],
            notices: [...notices],
            // patch: the checkbox is only offered when there is nothing to warn about.
            ...(patchMode && warnings.size === 0 && { footer: <PatchDontShowAgainCheckbox noticeId={patchNoticeExportFinished} /> }),
          });
        } else if (cutListChangeNotice != null) {
          // The dialog is silenced for good, and the notice must not disappear with it.
          showNotification({ icon: 'info', text: cutListChangeNotice });
        }
      }

      // A cycle that only reused/renamed files must not bump the export counters: the name template
      // can use them, and a changed count would rename every result on the next run. Count what was
      // actually written, not what was planned (a skipped cut wrote nothing). Base mode keeps the
      // upstream behaviour.
      const didAnyWork = skipClipCuts
        ? false
        : (incremental ? (outFiles.some((file) => file.created) || mergedWrote) : true);
      if (didAnyWork) {
        setExportCount((c) => c + 1);
        setCurrentFileExportCount((c) => c + 1);
      }

      emitEvent({
        eventName: 'export-complete',
        paths: exportedPaths,
        ...(patchMode && { entries: cutResultEntries }),
      });
      exportSucceeded = true;
    } catch (err) {
      emitEvent({ eventName: 'export-complete' });

      // patch: a user cancel is not a failure. The card says "Failed to export" for `failed`, while
      // the `finally` below promises that a cancel is dropped silently - so the flag is set after
      // this check, not before it.
      if (isAbortedError(err)) return;
      exportFailed = true;

      showOsNotification(i18n.t('Failed to export'));

      if (isExecaError(err)) {
        console.log('stdout:', getStdioString(err.stdout));
        console.error('stderr:', getStdioString(err.stderr));

        if (isOutOfSpaceError(err)) {
          showDiskFull();
          return;
        }
        if (isMuxNotSupported(err)) {
          showMuxNotSupported();
          return;
        }
      }

      if (err instanceof OutputNotWritableError) {
        showOutputNotWritable();
        return;
      }

      if (err instanceof UserFacingError) {
        errorToast(err.message);
        return;
      }

      handleExportFailed(err);
    } finally {
      // patch: the run state is what tells an export apart from any other operation (the overlay
      // and the locks read it). A run that never reached the end (user cancel, early guard) is
      // dropped silently.
      if (exportSucceeded) exportRun?.finish('done');
      else if (exportFailed) exportRun?.finish('failed');
      else exportRun?.clear();
      // patch: free the work area for another window (the manifest and the results are written).
      if (exportLockHeld && exportWorkRoot != null) {
        mainApi.patchReleaseWorkLock({ workRoot: exportWorkRoot, owner: 'export' }).catch((err: unknown) => { console.error('Failed to release the work-area lock', err); });
      }
      setWorking(undefined);
      setProgress(undefined);
    }
  }, [filePath, numStreamsToCopy, haveInvalidSegs, workingRef, setWorking, exportRun, isPatchExporting, segmentsToChaptersOnly, cutFileTemplateOrDefault, generateCutFileNames, cutMultiple, outputDir, customOutDir, fileFormat, fileDuration, isRotationSet, effectiveRotation, copyFileStreams, allFilesMeta, keyframeCut, cutSegments, segmentsToExport, shortestFlag, ffmpegExperimental, preserveMetadata, preserveMetadataOnMerge, preserveMovData, preserveChapters, movFastStart, avoidNegativeTs, paramsByFile, detectedFps, willMerge, enableOverwriteOutput, exportConfirmEnabled, mainFileFormat, mainStreams, exportExtraStreams, areWeCutting, simpleMode, prefersReducedMotion, cleanupChoices, hideAllNotifications, segmentsOrInverse.selected, t, cutMergedFileTemplateOrDefault, segmentsToChapters, patchMergedName.defaultRule, resolvePatchCutExportNames, resolvePatchExportMergedName, invertCutSegments, generateCutMergedFileNames, concatCutSegments, autoDeleteMergedSegments, tryDeleteFiles, nonCopiedExtraStreams, extractStreams, askForCleanupChoices, cleanupFiles, showOsNotification, showNotification, openCutFinishedDialog, handleExportFailed, patchMode, patchCutsClips, patchNamesCutResults, patchNotice, patchWork, patchWorkDirs?.mergedDir, maxLabelLength, safeOutputFileName, enableSmartCut, patchCutPolicy.repairJoins, patchCutPolicy.tailGuardSeconds, patchCutPolicy.splitNonAvStreams, patchCutPolicy.shortestBlocked, patchCutPolicy.effective, mergeBoundary.guard, mergeBoundary.tailToSourceEnd, segmentsOrInverse.all, cutFromAdjustmentFrames, cutToAdjustmentFrames, ffmpegHwaccel, playerMode, mergedMode, damagePolicy.exportNeedsVideoEncode, effectiveNeedSmartCut, effectiveIsEncoding, flushProjectSaveForced]);

  const onExportPress = useCallback(async () => {
    if (!filePath) return;

    // patch: one export at a time. Ask again rather than silently doing nothing (the upstream guard
    // used to swallow the key press).
    if (patchMode && isPatchExportBlocked()) {
      warnExportRunning();
      return;
    }

    // patch: never open the export dialog for a video that sits inside a work directory.
    if (patchMode && !playerMode && !(await patchFinishGuardRef.current())) return;

    if (!exportConfirmEnabled) {
      // No options sheet: the export starts now, so the merged name is timestamped now too.
      beginPatchExportName();
      await onExportConfirm();
    } else if (exportConfirmOpen) {
      // Confirmed from the sheet: keep the timestamp the preview was rendered with (see
      // `patchExportNameEpochRef`), or a `{datetime}` name would differ from what the user saw.
      await onExportConfirm();
    } else {
      // patch: the sheet is opening, i.e. the export is being set up: the preview and the export it
      // starts share this moment.
      beginPatchExportName();
      setExportConfirmOpen(true);
      setStreamsSelectorShown(false);
    }
  }, [beginPatchExportName, filePath, exportConfirmEnabled, exportConfirmOpen, isPatchExportBlocked, onExportConfirm, patchMode, playerMode, warnExportRunning]);

  const captureSnapshot = useCallback(async () => {
    if (!filePath || workingRef.current) return;
    try {
      setWorking({ text: i18n.t('Exporting') });

      await withErrorHandling(async () => {
        const currentTime = getRelevantTime();
        const video = videoRef.current;
        invariant(video != null);
        const usingFfmpeg = usingPreviewFile || captureFrameMethod === 'ffmpeg';
        const outPath = usingFfmpeg
          ? await captureFrameFromFfmpeg({ customOutDir, filePath, time: currentTime, captureFormat, quality: captureFrameQuality })
          : await captureFrameFromTag({ customOutDir, filePath, time: currentTime, captureFormat, quality: captureFrameQuality, video });

        if (simpleMode && !prefersReducedMotion) shootConfetti();
        if (!hideAllNotifications) openExportFinishedDialog({ filePath: outPath, children: <div style={{ wordWrap: 'break-word' }}>{i18n.t('Screenshot captured to:')} {outPath}</div> });
      }, i18n.t('Failed to capture frame'));
    } finally {
      setWorking(undefined);
    }
  }, [filePath, workingRef, setWorking, withErrorHandling, getRelevantTime, videoRef, usingPreviewFile, captureFrameMethod, captureFrameFromFfmpeg, customOutDir, captureFormat, captureFrameQuality, captureFrameFromTag, simpleMode, prefersReducedMotion, hideAllNotifications, openExportFinishedDialog]);

  const shiftAllSegmentTimes = useCallback(async () => {
    const shift = await openShiftSegmentsDialog({ inputPlaceholder: timecodePlaceholder, parseTimecode });
    if (shift == null) return;

    const { startShift, endShift } = shift;
    await modifySelectedSegmentTimes((segment) => {
      const newSegment = { ...segment };
      if (startShift != null) {
        newSegment.start += startShift;
      }
      if (endShift != null && newSegment.end != null) {
        newSegment.end += endShift;
      }
      return newSegment;
    });
  }, [modifySelectedSegmentTimes, openShiftSegmentsDialog, parseTimecode, timecodePlaceholder]);

  const captureSnapshotToClipboard = useCallback(async () => {
    if (!filePath || workingRef.current) return;
    try {
      setWorking({ text: i18n.t('Exporting') });

      await withErrorHandling(async () => {
        const currentTime = getRelevantTime();
        await captureFrameToClipboard({ filePath, time: currentTime, quality: captureFrameQuality });

        if (simpleMode && !prefersReducedMotion) shootConfetti();
        if (!hideAllNotifications) getSwal().toast.fire({ icon: 'info', title: t('Screenshot captured clipboard') });
      }, i18n.t('Failed to capture frame'));
    } finally {
      setWorking(undefined);
    }
  }, [captureFrameQuality, captureFrameToClipboard, filePath, getRelevantTime, hideAllNotifications, prefersReducedMotion, setWorking, simpleMode, t, withErrorHandling, workingRef]);

  const extractSegmentsFramesAsImages = useCallback(async (segments: SegmentBase[]) => {
    if (!filePath || detectedFps == null || workingRef.current || segments.length === 0) return;
    const segmentsNumFrames = segments.reduce((acc, { start, end }) => acc + (end == null ? 1 : (getFrameCount(end - start) ?? 0)), 0);
    // If all segments are markers, we shall export every marker as a file and therefore we don't have to ask user
    const areAllSegmentsMarkers = segments.every((seg) => seg.end == null);
    const captureFramesResponse = areAllSegmentsMarkers
      ? { filter: undefined, estimatedMaxNumFiles: segmentsNumFrames }
      : await askExtractFramesAsImages({ segmentsNumFrames, plural: segments.length > 1, fps: detectedFps });

    if (captureFramesResponse == null) return;

    try {
      setWorking({ text: i18n.t('Extracting frames') });
      console.log('Extracting frames as images', { captureFramesResponse });

      setProgress(0);

      let lastOutPath: string | undefined;

      const segmentProgresses: Record<number, number> = {};
      const handleSegmentProgress = (segIndex: number, segmentProgress: number) => {
        segmentProgresses[segIndex] = segmentProgress;
        const totalProgress = segments.reduce((acc, _ignored, index) => acc + (segmentProgresses[index] ?? 0), 0);
        setProgress(totalProgress / segments.length);
      };

      for (const [index, segment] of segments.entries()) {
        const { start, end } = segment;
        invariant(filePath != null);
        lastOutPath = await captureFramesRange({ customOutDir, filePath, fps: detectedFps, fromTime: start, toTime: end, estimatedMaxNumFiles: captureFramesResponse.estimatedMaxNumFiles, captureFormat, quality: captureFrameQuality, filter: captureFramesResponse.filter, outputTimestamps: captureFrameFileNameFormat === 'timestamp', onProgress: (segmentProgress) => handleSegmentProgress(index, segmentProgress) });
      }
      if (!hideAllNotifications && lastOutPath != null) {
        showOsNotification(i18n.t('Frames have been extracted'));
        openExportFinishedDialog({ filePath: lastOutPath, children: <div style={{ wordWrap: 'break-word' }}>{i18n.t('Frames extracted to: {{path}}', { path: outputDir })}</div> });
      }
    } catch (err) {
      showOsNotification(i18n.t('Failed to extract frames'));
      handleError({ err, title: i18n.t('Failed to extract frames') });
    } finally {
      setWorking(undefined);
      setProgress(undefined);
    }
  }, [filePath, detectedFps, workingRef, getFrameCount, setWorking, hideAllNotifications, captureFramesRange, customOutDir, captureFormat, captureFrameQuality, captureFrameFileNameFormat, showOsNotification, openExportFinishedDialog, outputDir, handleError]);

  const extractCurrentSegmentFramesAsImages = useCallback(() => {
    if (currentCutSeg != null) extractSegmentsFramesAsImages([currentCutSeg]);
  }, [currentCutSeg, extractSegmentsFramesAsImages]);

  const extractSelectedSegmentsFramesAsImages = useCallback(() => extractSegmentsFramesAsImages(selectedSegments), [extractSegmentsFramesAsImages, selectedSegments]);

  const userChangePlaybackRate = useCallback((dir: number, rateMultiplier?: number) => {
    const video = videoRef.current;
    if (video == null) return;
    // patch: the patch speed keys follow the configured step (base multiplier or fixed 0.1 steps).
    // Base mode always keeps the upstream multiplier.
    const nextRate = () => (
      patchMode && patchWork?.playbackRateStep === 'fixed'
        ? stepPlaybackRate({ currentRate: video.playbackRate, direction: dir, multiplier: rateMultiplier })
        : adjustRate(video.playbackRate, dir, rateMultiplier)
    );
    if (!playingRef.current) {
      // patch: in patch mode a paused speed key changes the speed instead of starting playback,
      // and the new speed becomes the one `Z` toggles back to. Base mode keeps upstream: the
      // first press while paused only starts playback.
      if (patchMode) {
        const newRate = nextRate();
        setPlaybackRate(newRate);
        playbackRateMemory.remember(newRate);
      } else {
        video.play();
      }
    } else {
      const newRate = nextRate();
      setPlaybackRate(newRate);
      if (patchMode) playbackRateMemory.remember(newRate);
    }
  }, [playingRef, setPlaybackRate, videoRef, patchMode, patchWork?.playbackRateStep, playbackRateMemory]);

  const loadEdlFile = useCallback(async ({ path, type, append = false }: { path: string, type: EdlFileType, append?: boolean }) => {
    console.log('Loading EDL file', type, path, append);
    // cannot clamDuration because the duration is null (if no file loaded) or duration of a different file (if switching files)
    // because of how react state works
    loadCutSegments({ segments: await readEdlFile({ type, path, fps: detectedFps }), append });
  }, [detectedFps, loadCutSegments]);

  const loadSubtitleTrackToSegments = useCallback(async (streamId: number) => {
    invariant(filePath != null);
    setWorking(true);
    try {
      setStreamsSelectorShown(false);
      loadCutSegments({ segments: await extractSubtitleTrackToSegments(filePath, streamId), append: true, clampDuration: fileDuration });
    } finally {
      setWorking(undefined);
    }
  }, [fileDuration, filePath, loadCutSegments, setWorking]);

  const loadMedia = useCallback(async ({ filePath: fp, projectPath }: { filePath: string, projectPath?: string | undefined }) => {
    async function tryOpenProjectPath(path: string) {
      if (!(await mainApi.pathExists(path))) return false;
      await loadEdlFile({ path, type: 'llc' });
      return true;
    }

    const storeProjectInSourceDir = !storeProjectInWorkingDir;

    async function tryFindAndLoadProjectFile({ chapters, cod }: { chapters: FFprobeChapter[], cod: string | undefined }) {
      try {
        // patch: the project file follows upstream, so the directory to look in first is the
        // upstream custom output directory (otherwise the source video's own folder, which is
        // looked at below). The work area of older patch versions is only looked at last.
        const projectLookup = getProjectFileLookup({ patchMode, outDir: cod, upstreamOutDir, workAreaDir: patchWorkDirs?.clipsDir });

        // First try to open from working dir
        if (await tryOpenProjectPath(getEdlFilePath(fp, projectLookup.dir))) return;

        // then try to open project from source file dir
        const sameDirEdlFilePath = getEdlFilePath(fp);
        // MAS only allows fs.access (pathExists) if we don't have access to input dir yet, so check first if the file exists,
        // so we don't need to annoy the user by asking for permission if the project file doesn't exist
        let projectLoaded = false;
        if (await mainApi.pathExists(sameDirEdlFilePath)) {
          // Ok, the file exists. now we have to ask the user, because we need to read that file
          await ensureAccessToSourceDir(fp);
          // Ok, we got access from the user (or already have access), now read the project file
          await loadEdlFile({ path: sameDirEdlFilePath, type: 'llc' });
          projectLoaded = true;
        }

        // patch: a cut list named after the video itself (`a.llc` next to `a.mp4`, or in the
        // working directory) is read too, but it is never written back: it is read-only compatible
        // with the canonical `<video>-proj.llc` (see the known issues and
        // `getVideoNamedProjectCandidates`). A broken or foreign `.llc` is skipped, not fatal.
        // Patch mode only: base mode keeps upstream's lookup byte for byte.
        if (!projectLoaded && patchMode) {
          const videoNamedCandidates = getVideoNamedProjectCandidates({ videoPath: fp, preferredDir: projectLookup.dir, caseInsensitive: manifestPathCaseInsensitive });
          for (const candidate of videoNamedCandidates) {
            try {
              if (!(await mainApi.pathExists(candidate.path))) continue;
              if (candidate.inSourceDir) await ensureAccessToSourceDir(fp);
              await loadEdlFile({ path: candidate.path, type: 'llc' });
              setSuppressedProjectSave({ filePath: fp, projectPath: candidate.path });
              return;
            } catch (err) {
              console.error('Video-named project file could not be read, trying the next one', candidate.path, err);
            }
          }
        }

        // patch: older patch versions wrote the project file into the work area, so look there too,
        // but last: the project file of the current location always wins.
        if (!projectLoaded && projectLookup.legacyDir != null && projectLookup.legacyDir !== projectLookup.dir) {
          const legacyProjectFound = await tryOpenProjectPath(getEdlFilePath(fp, projectLookup.legacyDir));
          if (legacyProjectFound) return;
        }

        // OK, we didn't find a project file, instead maybe try to create project (segments) from chapters
        const edl = tryMapChaptersToEdl(chapters);
        // patch: the result windows never import the source's chapters, and neither does the cutting
        // window for a result it can only view (features/patchChapterImport). The results carry their
        // source's chapter table with the source's own timestamps, and no result window can cut.
        const chapterImport = planEmbeddedChapterImport({
          chapterCount: edl.length,
          enableImportChapters,
          readOnlySource: patchMode && !playerMode && !mergedMode
            && resolveReadOnlySourceArea(fp, patchWork?.dirNames ?? defaultPatchDirNames) != null,
          windowKind: resolveChapterImportWindow({ patchMode, playerMode, mergedMode }),
        });
        if (chapterImport === 'import' || (chapterImport === 'ask' && (await askForImportChapters()))) {
          console.log('Convert chapters to segments', edl);
          loadCutSegments({ segments: edl, append: false });
        }
      } catch (err) {
        if (err instanceof DirectoryAccessDeclinedError) throw err;
        console.error('EDL load failed, but continuing', err);
        errorToast(`${i18n.t('Failed to load segments')} (${err instanceof Error && err.message})`);
      }
    }

    setWorking({ text: i18n.t('Loading file') });
    try {
      // Need to check if file is actually readable
      const pathReadAccessErrorCode = await getPathReadAccessError(fp);
      if (pathReadAccessErrorCode != null) {
        let errorMessage: string | undefined;
        if (pathReadAccessErrorCode === 'ENOENT') errorMessage = i18n.t('The media you tried to open does not exist');
        else if (['EACCES', 'EPERM'].includes(pathReadAccessErrorCode)) errorMessage = i18n.t('You do not have permission to access this file');
        else errorMessage = i18n.t('Could not open media due to error {{errorCode}}', { errorCode: pathReadAccessErrorCode });
        errorToast(errorMessage);
        return;
      }

      // Not sure why this one is needed, but I think sometimes fs.access doesn't fail but it fails when actually trying to read
      if (!(await havePermissionToReadFile(fp))) {
        errorToast(i18n.t('You do not have permission to access this file'));
        return;
      }

      const ffprobeMeta = await readFileFfprobeMeta(fp);
      const fileStats = await readFileStats(fp);
      // console.log('file meta read', fileMeta);

      const fileFormatNew = await getDefaultOutFormat({ filePath: fp, fileMeta: ffprobeMeta });
      if (!fileFormatNew) throw new Error('Unable to determine file format');

      const timecode = autoLoadTimecode ? getTimecodeFromStreams(ffprobeMeta.streams) : undefined;

      const [firstVideoStream] = getRealVideoStreams(ffprobeMeta.streams);
      const [firstAudioStream] = getAudioStreams(ffprobeMeta.streams);

      const copyStreamIdsForPathNew = fromPairs(ffprobeMeta.streams.map((stream) => [
        stream.index, shouldCopyStreamByDefault(stream),
      ]));

      const validDuration = isDurationValid(parseFloat(ffprobeMeta.format.duration));

      const hevcPlaybackSupported = enableNativeHevc && await hevcPlaybackSupportedPromise;

      // need to ensure we have access to write to working directory
      const cod = await ensureWritableOutDir({ inputPath: fp, outDir: customOutDir });

      // if storeProjectInSourceDir is true, we will be writing project file to input path's dir, so ensure that one too
      if (storeProjectInSourceDir) await ensureAccessToSourceDir(fp);

      const existingHtml5FriendlyFile = await findExistingHtml5FriendlyFile(fp, cod);

      const needsAutoHtml5ify = !existingHtml5FriendlyFile && !willPlayerProperlyHandleVideo({ streams: ffprobeMeta.streams, hevcPlaybackSupported, isMasBuild }) && validDuration;

      console.log('loadMedia', { filePath: fp, customOutDir: cod, projectPath });

      // patch: a video may be open in one window only - a mark is saved in the project file next to
      // it, and two windows would overwrite each other's file. The claim is per window and only
      // enforced when several instances are allowed (see features/patchSourceClaim).
      // It is taken here, once the file is known to be readable and writable: claiming first would
      // release the claim of the file still open and leave this one claimed when the open fails.
      if (patchMode && !playerMode && !mergedMode) {
        const claim = await mainApi.patchClaimSource({ path: fp });
        if (!claim.ok) {
          if (claim.reason === 'busy') {
            await getSwal().Swal.fire({
              icon: 'warning',
              title: i18n.t('This video is already open in another window'),
              text: i18n.t('Close it there first.'),
            });
          } else {
            errorToast(claim.message);
          }
          return;
        }
      }

      // BEGIN STATE UPDATES:

      // patch: the outgoing file's marks are written with a debounce, and `resetState` throws the
      // list away. Flush the pending save, so switching files (or closing the app) right after a
      // mark does not lose it. `flushProjectSave` is a no-op when nothing is pending.
      await flushProjectSave();

      resetState();
      clearSegColorCounter();
      // patch: a held save belongs to the file that was just closed; the new file gets its own
      // hold only when its cut list comes from a video-named `.llc`.
      setSuppressedProjectSave(undefined);

      if (existingHtml5FriendlyFile) {
        console.log('Found existing html5 friendly file', existingHtml5FriendlyFile.path);
        setUsingDummyVideo(existingHtml5FriendlyFile.usingDummyVideo);
        setPreviewFilePath(existingHtml5FriendlyFile.path);
      }

      if (needsAutoHtml5ify) {
        // Try to auto-html5ify if there are known issues with this file
        // 'fastest' works with almost all video files
        await html5ifyAndLoadWithPreferences(cod, fp, 'fastest', firstVideoStream != null, firstAudioStream != null);
      }

      // eslint-disable-next-line unicorn/prefer-ternary
      if (projectPath) {
        await loadEdlFile({ path: projectPath, type: 'llc' });
      } else {
        await tryFindAndLoadProjectFile({ chapters: ffprobeMeta.chapters, cod });
      }

      // throw new Error('test');

      // eslint-disable-next-line no-inner-declarations
      function getFps() {
        if (firstVideoStream != null) return getStreamFps(firstVideoStream);
        if (firstAudioStream != null) return getStreamFps(firstAudioStream);
        return undefined;
      }

      if (timecode) setStartTimeOffset(timecode);
      setDetectedFps(getFps());
      setMainFileMeta({ ffprobeMeta, stats: { size: fileStats.size, atime: fileStats.atimeMs, mtime: fileStats.mtimeMs, ctime: fileStats.ctimeMs, birthtime: fileStats.birthtimeMs } });
      setCopyStreamIdsForPath(fp, () => copyStreamIdsForPathNew);
      setDetectedFileFormat(fileFormatNew);
      if (outFormatLocked) {
        setFileFormat(outFormatLocked);
      } else {
        const recommendedDefaultFormat = mapRecommendedDefaultFormat({ sourceFormat: fileFormatNew, streams: ffprobeMeta.streams });
        if (recommendedDefaultFormat.message) showNotification({ icon: 'info', text: recommendedDefaultFormat.message });
        setFileFormat(recommendedDefaultFormat.format);
      }

      // only show one toast, or else we will only show the last one
      if (existingHtml5FriendlyFile && !existingHtml5FriendlyFile.usingDummyVideo) {
        showPreviewFileLoadedMessage(basename(existingHtml5FriendlyFile.path));
      } else if (needsAutoHtml5ify) {
        showNotNativelySupportedMessage();
      } else if (isAudioDefinitelyNotSupported(ffprobeMeta.streams)) {
        showNotification({ icon: 'info', text: i18n.t('The audio track is not supported while previewing. You can convert to a supported format from the menu') });
      } else if (!validDuration) {
        getSwal().toast.fire({ icon: 'warning', timer: 10000, text: i18n.t('This file does not have a valid duration. This may cause issues. You can try to fix the file\'s duration from the File menu') });
      }

      // This needs to be last, because it triggers <video> to load the video
      // If not, onVideoError might be triggered before setWorking() has been cleared.
      // https://github.com/mifi/lossless-cut/issues/515
      setFilePath(fp);
    } catch (err) {
      if (err instanceof DirectoryAccessDeclinedError) return;
      // patch: the open may have claimed the file before failing here, and the window keeps no file
      // after `resetState`: drop the claim so the next window can open it.
      if (patchMode) mainApi.patchReleaseSourceClaims().catch((releaseError: unknown) => { console.error('Failed to release the source claim', releaseError); });
      resetState();
      throw err;
    }
  }, [storeProjectInWorkingDir, setWorking, loadEdlFile, getEdlFilePath, enableImportChapters, ensureAccessToSourceDir, loadCutSegments, autoLoadTimecode, enableNativeHevc, ensureWritableOutDir, customOutDir, resetState, clearSegColorCounter, setSuppressedProjectSave, setCopyStreamIdsForPath, setDetectedFileFormat, outFormatLocked, setUsingDummyVideo, setPreviewFilePath, html5ifyAndLoadWithPreferences, setFileFormat, showNotification, showPreviewFileLoadedMessage, showNotNativelySupportedMessage, patchMode, playerMode, mergedMode, upstreamOutDir, patchWorkDirs, patchWork?.dirNames, flushProjectSave]);

  const toggleLastCommands = useCallback(() => setLastCommandsVisible((val) => !val), []);
  const toggleSettings = useCallback(() => setSettingsVisible((val) => !val), []);

  const seekClosestKeyframe = useCallback((direction: number) => {
    // patch: patch mode steps from the previous target and reads packets on a cache miss, so the
    // cursor keeps moving while the video plays; base mode keeps the upstream query verbatim.
    if (patchMode) {
      stepKeyframe(direction < 0 ? -1 : 1).catch((err: unknown) => console.error('Failed to step keyframe', err));
      return;
    }
    const sigma = detectedFps ? (1 / detectedFps) : 0.1; // because we don't want it to find the keyframe we're currently at.
    const time = findNearestKeyFrameTime({ time: getRelevantTime() + direction * sigma, direction });
    if (time == null) return;
    seekAbs(time);
  }, [detectedFps, findNearestKeyFrameTime, getRelevantTime, patchMode, seekAbs, stepKeyframe]);

  const onTimelineWheel = useTimelineScroll({ wheelSensitivity, mouseWheelZoomModifierKey, mouseWheelFrameSeekModifierKey, mouseWheelKeyframeSeekModifierKey, invertTimelineScroll, zoomRel, seekRel, shortStep, seekClosestKeyframe });
  // patch: only a bare wheel becomes a volume step; modifier wheels stay on the base handler.
  const onViewerWheel = usePatchWheelVolume({ enabled: patchMode, baseWheel: onTimelineWheel, onVolumeStep: stepPlaybackVolume });

  const seekAccelerationRef = useRef(1);

  const userOpenSingleFile = useCallback(async ({ path: pathIn, isLlcProject }: { path: string, isLlcProject?: boolean }) => {
    let path = pathIn;
    let projectPath: string | undefined;

    // Open .llc AND media referenced within
    if (isLlcProject) {
      console.log('Loading LLC project', path);
      const { mediaFileName } = await loadLlcProject(path);

      console.log({ mediaFileName });
      if (!mediaFileName) return;

      const mediaFilePath = pathJoin(dirname(path), mediaFileName);

      // Note: MAS doesn't allow anything else than fs.access before the user has granted our app access to input dir
      if (!(await mainApi.pathExists(mediaFilePath))) {
        errorToast(i18n.t('The media file referenced by the project file you tried to open does not exist in the same directory as the project file: {{mediaFileName}}', { mediaFileName }));
        return;
      }

      projectPath = path;

      // We might need to get user's access to the project file's directory, in order to read the media file
      try {
        await ensureAccessToSourceDir(mediaFilePath);
      } catch (err) {
        if (err instanceof DirectoryAccessDeclinedError) return;
      }
      path = mediaFilePath;
    }

    if (/\.vob$/i.test(path) && mustDisallowVob()) return;

    await loadMedia({ filePath: path, projectPath });
  }, [ensureAccessToSourceDir, loadMedia]);

  // todo merge with userOpenFiles?
  // patch: `autoPlay` is the open-and-play switch (`Shift+PgUp` / `Shift+PgDn`). The request is
  // recorded only after every refusal below has returned, so a refused open never leaves one.
  const batchOpenSingleFile = useCallback(async (path: string, { autoPlay = false }: { autoPlay?: boolean } = {}) => {
    if (workingRef.current) return;
    // patch: the open file is part of the export's snapshot. Holding the lock here (and not only on
    // the actions) covers every way of switching: the batch list, the keys and the API.
    if (patchMode && isPatchExportBlocked()) {
      warnExportRunning();
      return;
    }
    // patch: "already open" is a file-system comparison in patch mode (the same file can arrive in
    // another spelling); base mode keeps the exact string.
    if (patchMode ? (filePath != null && isSamePath(filePath, path, { caseInsensitive: manifestPathCaseInsensitive })) : filePath === path) return;
    // patch: the file is loading now; playback starts on its `loadedmetadata` (see
    // `onPatchSourceLoaded`), never on the outgoing one.
    pendingAutoPlayPathRef.current = autoPlay ? path : undefined;
    setWorking({ text: i18n.t('Loading file') });
    try {
      await withErrorHandling(async () => {
        await userOpenSingleFile({ path });
      }, i18n.t('Failed to open file'));
    } finally {
      setWorking(undefined);
    }
  }, [workingRef, patchMode, isPatchExportBlocked, warnExportRunning, filePath, setWorking, withErrorHandling, userOpenSingleFile]);

  const batchFileJump = useCallback((direction: number, alsoOpen: boolean, alsoPlay = false) => {
    if (batchFiles.length === 0) return;

    let newSelectedBatchFiles: [string];
    if (selectedBatchFiles.length === 0) {
      newSelectedBatchFiles = [batchFiles[0]!.path];
    } else {
      const selectedFilePath = selectedBatchFiles[direction > 0 ? selectedBatchFiles.length - 1 : 0];
      // patch: the selected row is found the way the file system compares (base mode: exact string).
      const pathIndex = batchFiles.findIndex(({ path }) => (patchMode && selectedFilePath != null
        ? isSamePath(path, selectedFilePath, { caseInsensitive: manifestPathCaseInsensitive })
        : path === selectedFilePath));
      if (pathIndex === -1) return;
      const nextFile = batchFiles[pathIndex + direction];
      if (!nextFile) return;
      newSelectedBatchFiles = [nextFile.path];
    }

    setSelectedBatchFiles(newSelectedBatchFiles);
    if (alsoOpen) batchOpenSingleFile(newSelectedBatchFiles[0], { autoPlay: alsoPlay });
  }, [batchFiles, batchOpenSingleFile, patchMode, selectedBatchFiles]);

  const batchOpenSelectedFile = useCallback(() => {
    const [firstSelectedBatchFile] = selectedBatchFiles;
    if (firstSelectedBatchFile == null) return;
    batchOpenSingleFile(firstSelectedBatchFile);
  }, [batchOpenSingleFile, selectedBatchFiles]);

  // patch: the player window's cut-results playlist (fork-owned; not the upstream batch list).
  const {
    entries: patchPlayerEntries,
    currentEntry: patchPlayerCurrentEntry,
    open: patchPlayerOpen,
    renameEntry: patchPlaylistRenameEntry,
    release: patchPlayerRelease,
    prev: patchPlaylistPrev,
    next: patchPlaylistNext,
    first: patchPlaylistFirst,
    last: patchPlaylistLast,
  } = usePatchPlayerPlaylist({ playerMode, currentPath: filePath, openPath: batchOpenSingleFile, reloadCurrentFile: () => setCacheBuster((v) => v + 1) });

  // patch: the merged window shows the clips as read-only chapters (source labels and colors).
  usePatchMergedChapters({ mergedMode, entry: patchPlayerCurrentEntry, filePath, clearSegments, loadCutSegments });

  // patch: the merged window's segment list shows the same two numbers as the cutting window
  // (colored = start-time rank, plain = queue position), carried with the chapters. An old merged
  // file has no numbers and the current entry can be missing for a moment (the player reloads its
  // file), so the loaded chapter list is numbered the same way as a fallback - the list never shows
  // a row without a number.
  const patchMergedNumbers = useMemo(() => {
    if (!mergedMode) return undefined;
    const chapters = patchPlayerCurrentEntry?.mergedChapters;
    if (chapters?.some((chapter) => chapter.startRank != null || chapter.queueRank != null)) {
      return buildMergedChapterNumbers(chapters);
    }
    return buildSegmentOrderNumbers(cutSegments
      .filter((seg) => seg.end != null)
      .map((seg) => ({ segId: seg.segId, start: seg.start, end: seg.end ?? 0, selected: true })));
  }, [cutSegments, mergedMode, patchPlayerCurrentEntry]);

  // patch: file location context menus (patch mode only): right-click a source file row, a cut
  // result row, or the video to reveal the file in the OS file manager.
  const { getFileMenuItems: patchFileMenuItems, getWorkPathListItem } = usePatchFileActions();
  // patch: the video's menu also offers the menu-bar toggle, so it is reachable with the mouse. The
  // hint follows the user's effective bindings; the keyboard layout map is not available this high
  // in App (it comes from useKeyboard), so this one uses the static key names.
  const patchMenuBarMenuItem = usePatchMenuBarMenuItem({ keyBindings: effectiveKeyBindings });
  usePatchFileContextMenu({ targetRef: videoRef, path: filePath, enabled: patchMode, extraItem: patchMode ? patchMenuBarMenuItem : undefined });

  // patch: the context menu of the source file list. A row keeps its own menu and gets the list
  // action appended; the header and the panel around the rows get the list action alone. The item
  // is greyed when there is nothing to clear.
  const getBatchFileMenuItems = useCallback((path: string): MenuItemConstructorOptions[] => [
    ...patchFileMenuItems(path),
    { type: 'separator' },
    { label: t('Clear the source file list'), enabled: batchFiles.length > 0, click: clearBatchFilesFromMenu },
  ], [batchFiles.length, clearBatchFilesFromMenu, patchFileMenuItems, t]);

  const batchListMenuItems = useMemo<MenuItemConstructorOptions[] | undefined>(() => (patchMode ? [
    getWorkPathListItem(),
    { type: 'separator' },
    { label: t('Clear the source file list'), enabled: batchFiles.length > 0, click: clearBatchFilesFromMenu },
  ] : undefined), [batchFiles.length, clearBatchFilesFromMenu, getWorkPathListItem, patchMode, t]);

  // patch: "Work folders and results..." on the menus the app builds in components it does not own:
  // the timeline and the segment list take the entries as a prop (empty in base mode, so their menus
  // stay byte-identical). The video, the source list and every cut-result row get the same entry
  // from `usePatchFileActions`.
  const patchWorkPathListMenuItems = useMemo<MenuItemConstructorOptions[]>(
    () => (patchMode ? [getWorkPathListItem()] : []),
    [getWorkPathListItem, patchMode],
  );

  // patch: an export renames/deletes result files, so the player must let go of the one it holds
  // (Windows file lock). The window stays exactly as it is; the next playlist reloads the video.
  useEffect(() => {
    if (!playerMode) return undefined;
    const onRelease = () => {
      pause();
      const video = videoRef.current;
      if (video != null) {
        video.removeAttribute('src');
        video.load();
      }
      patchPlayerRelease();
      // The video is gone, so the file is no longer being played: let another window move it. The
      // file path stays (a reload puts the playlist back), so the claim effect will not release it.
      // The check player never claims a result: releasing by kind there would drop the claim of the
      // cut-results window that really plays one.
      if (!inspectMode) {
        mainApi.patchReleaseResultClaims({ kind: mergedMode ? 'merged' : 'cut-results' }).catch((err: unknown) => {
          console.warn('Failed to release the result claim', err);
        });
      }
    };
    ipcRenderer.on(patchPlayerReleaseChannel, onRelease);
    return () => { ipcRenderer.off(patchPlayerReleaseChannel, onRelease); };
  }, [inspectMode, mergedMode, patchPlayerRelease, pause, playerMode, videoRef]);

  // patch: the results window plays the cut results; the source in this window would keep playing at
  // the same time. The playback is announced, and the cutting window pauses its source.
  useEffect(() => {
    if (!playerMode || !playing) return;
    ipcRenderer.send(patchPlayerPlaybackChannel);
  }, [playerMode, playing]);

  // patch: the cutting window pauses its source while the cut results are played in the results
  // window. The source is not resumed: the user starts it again when they need it.
  useEffect(() => {
    if (!patchMode || playerMode) return undefined;
    const onPauseSource = () => { pause(); };
    ipcRenderer.on(patchSourcePauseChannel, onPauseSource);
    return () => { ipcRenderer.off(patchSourcePauseChannel, onPauseSource); };
  }, [patchMode, pause, playerMode]);

  // patch: the other direction. Starting the source pauses whatever a results window is playing,
  // so the two windows never play audio at the same time.
  useEffect(() => {
    if (!patchMode || playerMode || !playing) return;
    ipcRenderer.send(patchSourcePlaybackChannel);
  }, [patchMode, playerMode, playing]);

  useEffect(() => {
    if (!playerMode) return undefined;
    const onPauseResults = () => { pause(); };
    ipcRenderer.on(patchResultsPauseChannel, onPauseResults);
    return () => { ipcRenderer.off(patchResultsPauseChannel, onPauseResults); };
  }, [pause, playerMode]);

  // patch: renaming a cut result (`label` re-renders the name template, `full` replaces the name).
  // The rename and the export manifest are updated by the main process (see
  // `main/features/patchExport/renameResult`), so this only has to follow it locally.
  const renamePatchResult = usePatchResultRename({
    currentPath: filePath,
    videoRef,
    pause,
    reloadCurrentFile: () => setCacheBuster((v) => v + 1),
    openPath: batchOpenSingleFile,
    onRenamed: (entry, newPath, label) => {
      patchPlaylistRenameEntry(entry.path, newPath, label);
    },
  });

  const openPatchRenameDialog = useCallback((kind: 'label' | 'full') => {
    const entry = patchPlayerCurrentEntry;
    if (entry == null) return;
    if (kind === 'label' && entry.nameContext == null) {
      showNotification({ text: i18n.t('Merged results have no segment label to rename. Use Shift+N to rename the file.') });
      return;
    }
    setPatchRenameRequest({ kind, defaultValue: kind === 'label' ? (entry.label ?? '') : parsePath(entry.path).name });
  }, [patchPlayerCurrentEntry, showNotification]);

  const onPatchRenameSubmit = useCallback(async (value: string) => {
    const request = patchRenameRequest;
    const entry = patchPlayerCurrentEntry;
    if (request == null || entry == null) return undefined;
    const outcome = await renamePatchResult({ entry, kind: request.kind, value });
    if (!outcome.ok) return outcome.error;
    setPatchRenameRequest(undefined);
    if (outcome.notice != null) showNotification({ text: outcome.notice });
    return undefined;
  }, [patchPlayerCurrentEntry, patchRenameRequest, renamePatchResult, showNotification]);

  // patch: merge the cut results of the current source into one file (`e` in the results window).
  // The results are the export manifest's records for the source, so this also works after a
  // restart and covers every incremental export. The merged file lives in the work area's `merged`
  // directory; an unchanged result set reuses it instead of merging again.
  const patchMergeCutResults = useCallback(async ({ rule, overwrite, epochMs }: { rule: string; overwrite: boolean; epochMs: number }) => {
    // The merged-result window is a viewer: it has no merge key and nothing to merge.
    if (mergedMode || workingRef.current) return;

    // The results window plays one of the results; the source is the file they were cut from.
    const sourcePath = playerMode
      ? (patchPlayerCurrentEntry?.sourcePath ?? patchPlayerEntries.find((entry) => entry.sourcePath != null)?.sourcePath)
      : filePath;
    if (sourcePath == null || fileFormat == null) {
      errorToast(i18n.t('No clips to merge'));
      return;
    }

    // patch: the merge reads the manifest of the work area the source belongs to. A source that sits
    // inside a work area (a finished source reopened) must not invent a nested one.
    const workRoot = resolveWorkRootForPath({ path: sourcePath, workRoot: patchWork?.workRoot, dirNames: patchWork?.dirNames ?? defaultPatchDirNames });
    if (workRoot == null) {
      errorToast(i18n.t('No clips to merge'));
      return;
    }

    // patch: the merge writes a result file and the export manifest - exactly what an export and a
    // finish job write - so it takes the work-area lock like they do (features/patchWork). Without it
    // two windows can read-modify-write the manifest and overwrite the merged result.
    const lock = await mainApi.patchAcquireWorkLock({ workRoot, owner: 'merge' });
    if (!lock.ok) {
      if (lock.reason === 'busy') showNotification({ icon: 'info', text: i18n.t('Another window is using this work folder. Wait for its export to finish.') });
      else errorToast(lock.message);
      return;
    }

    setWorking({ text: i18n.t('Merging') });
    setProgress(0);
    try {
      const manifest = await readExportManifest(workRoot);
      const recordKey = findManifestFileKey(manifest.files, sourcePath, { caseInsensitive: manifestPathCaseInsensitive }) ?? sourcePath;
      const record = manifest.files[recordKey];
      const clips = collectMergeClips(record);
      if (record == null || clips.length === 0) {
        // An export can already have merged (and deleted) the clips: show that merged result instead.
        if (record?.merged != null && await fileExists(record.merged.path)) {
          await window.electron.patchOpenMergedResult({
            path: record.merged.path,
            sourcePath,
            ...((record.merged.chapters != null) && { mergedChapters: record.merged.chapters }),
          });
          return;
        }
        errorToast(i18n.t('No clips to merge'));
        return;
      }

      // A result the user deleted by hand is skipped; the merge still produces the rest.
      const presentClips: PatchMergeClip[] = [];
      for (const clip of clips) {
        // eslint-disable-next-line no-await-in-loop
        if (await fileExists(clip.path)) presentClips.push(clip);
      }
      if (presentClips.length === 0) {
        errorToast(i18n.t('No clips to merge'));
        return;
      }
      if (presentClips.length < clips.length) {
        getSwal().toast.fire({ icon: 'warning', text: i18n.t('Some cut results are missing on disk and were skipped.') });
      }

      const workDirs = await window.electron.patchEnsureWorkDirs(workRoot);
      if (workDirs == null) {
        errorToast(i18n.t('Please select a working directory first'));
        return;
      }

      // patch: the result windows used to auto-save a project next to the merged file. Drop the
      // ones whose video is already gone before writing another merged result.
      await deleteOrphanProjectFiles(workDirs.mergedDir, manifestPathCaseInsensitive);

      const { mergedDir } = workDirs;
      const nameResult = resolvePatchMergedName({
        rule,
        sourcePath,
        labels: presentClips.map((clip) => clip.label),
        outputDir: mergedDir,
        ext: getOutFileExtension({ isCustomFormatSelected, outFormat: fileFormat, filePath: sourcePath }),
        epochMs,
        exportCount,
        labelSeparator: patchMergedName.labelSeparator,
        maxLabelLength,
        isWindows,
      });
      if ('problem' in nameResult) {
        errorToast(mergedNameProblemMessage(nameResult.problem));
        return;
      }
      // patch: a rule without a token that always differs renders the same name for the same source.
      // The merge then writes next to a file it does not own unless the user allowed replacing it, so
      // no foreign file is ever overwritten silently. The previous merged result of this source is
      // not a collision: the merge owns it and replaces or renames it.
      const previousMergedPath = record.merged?.path;
      const mergedFileName = resolveMergeFileName({
        fileName: nameResult.fileName,
        isTaken: (candidate) => {
          const candidatePath = pathJoin(mergedDir, candidate);
          if (previousMergedPath != null && isSamePath(candidatePath, previousMergedPath, { caseInsensitive: manifestPathCaseInsensitive })) return false;
          return pathExistsSync(candidatePath);
        },
        overwrite,
      });
      if (mergedFileName == null) {
        // Every ` (n)` sibling is taken: refuse rather than replace a file nobody checked.
        errorToast(i18n.t('No free file name was found for the merged result. Remove an old file or allow replacing it.'));
        return;
      }

      const signature = hashExportSignature(buildMergedSignatureInput({
        segments: presentClips,
        merge: { outFormat: fileFormat, ffmpegExperimental, preserveMovData, movFastStart, preserveMetadataOnMerge },
        // The labels only become part of the file when they are written as chapters. Otherwise a
        // relabeled clip is the same media, and the merge only has to rename the file.
        labelsAffectContent: Boolean(segmentsToChapters),
      }));
      const plan = planMergedExport({
        path: pathJoin(mergedDir, mergedFileName),
        signature,
        previous: record.merged,
        force: false,
        overwriteAllowed: overwrite,
        exists: pathExistsSync,
        caseInsensitivePaths: manifestPathCaseInsensitive,
      });

      // patch: the merged timeline shows one read-only chapter per clip (source labels and colors).
      // The actual clip durations are probed; the source times are the fallback. The two numbers of
      // each chapter are the ones the cutting window showed for that segment (colored = start-time
      // rank, plain = queue position), so the merged list reads like the cut queue it came from.
      const mergedChapters: PatchMergedChapter[] = await (async () => {
        const durations = await Promise.all(presentClips.map(async (clip) => {
          try {
            const meta = await readFileFfprobeMeta(clip.path);
            const probed = Number.parseFloat(meta.format.duration);
            return Number.isFinite(probed) && probed > 0 ? probed : undefined;
          } catch {
            return undefined;
          }
        }));
        // The numbers follow the cut queue the results were exported with (the recorded order), so
        // the merged list reads like the cutting window - not like the manifest's key order.
        const sourceNumbers = buildSegmentOrderNumbers(resolveMergeOrder({ order: record.order, segments: record.segments }).map((segId) => {
          const segment = record.segments[segId]!;
          return {
            segId,
            start: segment.start,
            end: segment.end,
            selected: true,
          };
        }));
        return buildMergedChapters(presentClips.map((clip, index) => ({
          segId: clip.segId,
          label: clip.label,
          segColorIndex: clip.segColorIndex,
          duration: durations[index],
          fallbackDuration: clip.end - clip.start,
          startRank: sourceNumbers.get(clip.segId)?.startRank,
          queueRank: sourceNumbers.get(clip.segId)?.queueRank,
        })));
      })();

      if (plan.action === 'blocked' || plan.action === 'skipped') {
        errorToast(i18n.t('The merged file name belongs to a file this app did not write. Remove it or allow replacing it.'));
        return;
      }

      // patch: the merged-result window may be playing the file this merge is about to rename,
      // overwrite or delete. Same rule as the export: never move a result another window holds. A
      // merge that only reuses the file writes nothing, so it does not ask.
      if (plan.action === 'rename' || plan.action === 'regenerate') {
        const inUsePaths = [plan.path, record.merged?.path, plan.obsoletePath]
          .filter((path): path is string => path != null);
        const { inUse } = await mainApi.patchFindResultFilesInUse({ paths: inUsePaths });
        if (inUse.length > 0) {
          showNotification({ icon: 'info', text: i18n.t('Some cut results are being played in another window. Stop them there first.') });
          return;
        }
      }

      if (plan.action === 'rename') {
        // patch: the content did not change (only the labels or the name rule did), so the file is
        // renamed instead of being merged again. The window may be playing it: Windows refuses the
        // rename until the video is unloaded.
        if (record.merged == null) throw new Error(i18n.t('The merged result to rename is missing'));
        emitEvent({ eventName: 'merge-start' });
        await renameResultFile(record.merged.path, plan.path);
        await deleteResultFiles([getProjectSidecarPath(record.merged.path)]);
        getSwal().toast.fire({ icon: 'success', text: i18n.t('Renamed the merged result') });
      } else if (plan.action === 'regenerate') {
        // patch: do not start a merge that cannot fit on the work area's volume (features/
        // patchSpace). The old merged file only frees its space when the merge writes to the same
        // path; a new name keeps it until the merge has finished.
        const inputBytes = sum(await readFileSizes(presentClips.map((clip) => clip.path)));
        const reclaimBytes = plan.obsoletePath == null && pathExistsSync(plan.path)
          ? await readFileSize(plan.path).catch(() => 0)
          : 0;
        const fits = await confirmPatchSpace({
          writes: [{ dir: workDirs.mergedDir, estimatedBytes: estimateConcatBytes({ inputBytes }), reclaimBytes }],
        });
        if (!fits) return;

        // The merged-result window may be playing the old file: Windows would refuse the write.
        emitEvent({ eventName: 'merge-start' });
        const wrote = await concatCutSegments({
          customOutDir: workDirs.mergedDir,
          outFormat: fileFormat,
          segmentPaths: presentClips.map((clip) => clip.path),
          ffmpegExperimental,
          preserveMovData,
          movFastStart,
          onProgress: setProgress,
          chapterNames: segmentsToChapters ? presentClips.map((clip) => clip.label) : undefined,
          preserveMetadataOnMerge,
          mergedOutFilePath: plan.path,
          overwrite: true,
          // patch: the results window's `E` merges clips that were cut earlier; the clips cannot be
          // re-cut here, but an explicit duration per clip still keeps the joins one frame apart.
          repairJoins: patchMode,
        });
        if (!wrote) throw new Error('The merged file was not written');
        if (plan.obsoletePath != null) await deleteResultFiles([plan.obsoletePath, getProjectSidecarPath(plan.obsoletePath)]);
        getSwal().toast.fire({ icon: 'success', text: i18n.t('Merged {{n}} clips', { n: presentClips.length }) });
      }

      // patch: record the merged file *with its chapters*, so `rsw` / `tmw` can reopen the merged
      // window with the same read-only chapters (and their numbers) after a restart. A reused merged
      // file is recorded too, so a merged file from an older version gains its chapters once.
      // The inputs say which cut results the file was built from: the finish job may only delete
      // those (and it cannot rely on file timestamps for that).
      try {
        // Merge into the fresh manifest: a rename made meanwhile is not lost.
        await updateExportManifest(workRoot, recordKey, {
          signature: record.signature,
          segments: record.segments,
          replacedSegIds: [],
          removedSegIds: [],
          merged: { signature, path: plan.path, inputs: buildMergedInputs(presentClips), chapters: mergedChapters },
        });
      } catch (err) {
        console.error('Failed to save the export manifest', err);
      }

      // patch: the merged result opens in its own window (the third window of the workflow).
      await window.electron.patchOpenMergedResult({ path: plan.path, sourcePath, mergedChapters });
    } catch (err) {
      handleError({ err });
    } finally {
      setWorking(undefined);
      setProgress(undefined);
      await mainApi.patchReleaseWorkLock({ workRoot, owner: 'merge' }).catch((err: unknown) => { console.error('Failed to release the work-area lock', err); });
    }
  }, [concatCutSegments, exportCount, ffmpegExperimental, fileFormat, filePath, handleError, isCustomFormatSelected, maxLabelLength, mergedMode, movFastStart, patchMergedName.labelSeparator, patchMode, patchPlayerCurrentEntry, patchPlayerEntries, patchWork?.dirNames, patchWork?.workRoot, playerMode, preserveMetadataOnMerge, preserveMovData, segmentsToChapters, setProgress, setWorking, showNotification, workingRef]);

  /**
  patch: the name the merge dialog shows.

  It runs the same rule as the merge (with the labels the manifest holds for the clips), so the
  preview is the name that will really be written. Nothing here writes or creates files.
  */
  const patchGenerateMergeNamePreview = useCallback(async (rule: string, epochMs: number): Promise<MergeNamePreview> => {
    const sourcePath = playerMode
      ? (patchPlayerCurrentEntry?.sourcePath ?? patchPlayerEntries.find((entry) => entry.sourcePath != null)?.sourcePath)
      : filePath;
    if (sourcePath == null || fileFormat == null) return { error: i18n.t('No clips to merge') };
    const workRoot = resolveWorkRootForPath({ path: sourcePath, workRoot: patchWork?.workRoot, dirNames: patchWork?.dirNames ?? defaultPatchDirNames });
    if (workRoot == null) return { error: i18n.t('Please select a working directory first') };
    // patch: the merge writes into the work area of this root (`patchMergeCutResults` ensures the
    // same directories), and the root falls back to the source folder when no working directory is
    // set. The provider's `workDirs` cannot be used here: they are derived from the open file, and
    // the results window opens none, so they would be empty exactly where this dialog is used.
    const mergedDir = pathJoin(workRoot, getPatchWorkDirNames(patchWork?.dirNames ?? defaultPatchDirNames).mergedDir);

    const manifest = await readExportManifest(workRoot);
    const recordKey = findManifestFileKey(manifest.files, sourcePath, { caseInsensitive: manifestPathCaseInsensitive }) ?? sourcePath;
    // The merge skips a result the user deleted by hand, and the rendered name can depend on the
    // labels: use the same list, or the dialog promises a name built from clips that will not be
    // merged (see `patchMergeCutResults`).
    const clips = collectMergeClips(manifest.files[recordKey]);
    const present = (await Promise.all(clips.map(async (clip) => ((await fileExists(clip.path)) ? clip : undefined))))
      .filter((clip): clip is PatchMergeClip => clip != null);
    if (present.length === 0) return { error: i18n.t('No clips to merge') };

    const result = resolvePatchMergedName({
      rule,
      sourcePath,
      labels: present.map((clip) => clip.label),
      outputDir: mergedDir,
      ext: getOutFileExtension({ isCustomFormatSelected, outFormat: fileFormat, filePath: sourcePath }),
      epochMs,
      exportCount,
      labelSeparator: patchMergedName.labelSeparator,
      maxLabelLength,
      isWindows,
    });
    if ('problem' in result) return { error: mergedNameProblemMessage(result.problem) };
    return { fileName: result.fileName };
  }, [exportCount, fileFormat, filePath, isCustomFormatSelected, maxLabelLength, patchMergedName.labelSeparator, patchPlayerCurrentEntry, patchPlayerEntries, patchWork?.dirNames, patchWork?.workRoot, playerMode]);

  // patch: "busy" for the patch flows that must not run during an export. The export's own run
  // state counts, because the shared `working` slot only covers it until something clears it.
  const patchMergeName = usePatchMergeName({
    enabled: patchMode && !mergedMode,
    isWorking: patchIsWorking,
    rule: patchMergedName.rule,
    setRule: patchMergedName.setRule,
    labelSeparator: patchMergedName.labelSeparator,
    setLabelSeparator: patchMergedName.setLabelSeparator,
    generatePreview: patchGenerateMergeNamePreview,
    onMerge: patchMergeCutResults,
  });

  // patch: the export dialog shows the same merged name the export will write (the labels are the
  // segments being exported, not the manifest's clips: this export may cut them again).
  const patchExportMergedNamePreview = useMemo<MergeNamePreview>(() => {
    const result = resolvePatchExportMergedName(patchExportNameEpochMs);
    if (result == null) return {};
    if ('problem' in result) return { error: mergedNameProblemMessage(result.problem) };
    return { fileName: result.fileName };
  }, [resolvePatchExportMergedName, patchExportNameEpochMs]);

  // patch: the export dialog edits the same rule the merge dialog uses (the upstream `${}` template
  // editor would be the wrong syntax in patch mode).
  const patchMergedNameEditor = patchMode ? (
    <NameRuleEditor
      mode="merge"
      rule={patchMergedName.rule}
      setRule={patchMergedName.setRule}
      defaultRule={patchMergedName.defaultRule}
      presets={mergedNamePresets}
      labelSeparator={patchMergedName.labelSeparator}
      setLabelSeparator={patchMergedName.setLabelSeparator}
      previewFileName={patchExportMergedNamePreview.fileName}
      previewError={patchExportMergedNamePreview.error}
      loading={false}
      collisionProne={!ruleHasUniqueToken(patchMergedName.rule)}
    />
  ) : undefined;

  // patch: the names this export will write for the cut results (the same call the export makes,
  // with the same timestamp), so the dialog can show them before anything is written.
  const patchExportCutNamePreview = useMemo<{
    lines: string[];
    error?: string | undefined;
    suffixed: boolean;
  }>(() => {
    const cutNames = resolvePatchCutExportNames(patchExportNameEpochMs);
    if (cutNames == null) return { lines: [], suffixed: false };
    const { resolved } = cutNames;
    if ('problem' in resolved) {
      return { lines: [], error: cutNameProblemMessage(resolved.problem), suffixed: false };
    }
    return {
      lines: resolved.names,
      suffixed: resolved.suffixes.some((suffix) => suffix !== ''),
    };
  }, [resolvePatchCutExportNames, patchExportNameEpochMs]);

  // patch: the export dialog edits the cut results' rule (the upstream `${}` template editor would
  // be the wrong syntax in patch mode).
  const patchCutNameEditor = patchMode ? (
    <NameRuleEditor
      mode="cut"
      rule={patchCutName.rule}
      setRule={patchCutName.setRule}
      defaultRule={patchCutName.defaultRule}
      presets={cutNamePresets}
      labelSeparator={patchCutName.labelSeparator}
      setLabelSeparator={patchCutName.setLabelSeparator}
      previewLines={patchExportCutNamePreview.lines}
      previewWarning={patchExportCutNamePreview.suffixed ? t('A number and the time were appended to the names above, because two cut results would have the same name.') : undefined}
      previewError={patchExportCutNamePreview.error}
      loading={false}
      collisionProne={!cutRuleSeparatesClips(patchCutName.rule)}
    />
  ) : undefined;

  // patch: the source window stops at the end (it does not advance to another file); pressing play
  // again restarts it, see `togglePlay`.
  const onPatchSourceEnded = useCallback(() => { onStopPlaying(); }, [onStopPlaying]);

  // patch: the player window plays the cut results as a playlist: a clip starts as soon as it is
  // ready and the player continues with the next result when one ends. Upstream opens files
  // paused and stops at the end, which is exactly right for the editor.
  const onPlayerClipReady = useCallback(() => play(), [play]);

  // patch: `Shift+PgUp` / `Shift+PgDn` open a source and play it. The request waits for the load, so
  // `play()` never runs against the outgoing file; the path decides, so a refused or failed open
  // (the old file stays) simply stays paused.
  const onPatchSourceLoaded = useCallback(() => {
    const requestedPath = pendingAutoPlayPathRef.current;
    pendingAutoPlayPathRef.current = undefined;
    if (shouldAutoPlayAfterOpen({ requestedPath, loadedPath: filePath, caseInsensitive: manifestPathCaseInsensitive })) play();
  }, [filePath, play]);
  const onPlayerClipEnded = useCallback(() => {
    onStopPlaying();
    patchPlaylistNext();
  }, [onStopPlaying, patchPlaylistNext]);

  // patch: resume/toggle the results windows for the current source (command console).
  const patchResume = usePatchResumeWindows({
    filePath,
    workRoot: patchWork?.workRoot,
    playerMode,
    mergedMode,
    caseInsensitive: manifestPathCaseInsensitive,
  });

  // patch: the collapsible "other videos" section below the results playlist. The check player is a
  // closed list (the check set), so it keeps the section off: its files are the playlist.
  const patchResultsOthers = usePatchResultsOthers({ playerMode: playerMode && !inspectMode, mergedMode, entries: patchPlayerEntries });
  const openPatchOtherResult = useCallback((path: string) => {
    patchPlayerOpen({ path });
  }, [patchPlayerOpen]);

  const patchReleasePlayer = useCallback(() => {
    // Only let go of the file: the segments, selection and history stay, so the user can keep going
    // after a finish job moved the source (the old `resetPlayer` cleared the whole editor).
    const video = videoRef.current;
    // patch: the seek that waits for its `seeked` event belongs to the outgoing file. Its event never
    // comes here, so the pending target would land on the next source - clamped to its duration, which
    // opened every auto-loaded file at its very end (see `resetPendingSeek`).
    resetPendingSeek();
    if (video == null) return;
    video.pause();
    video.removeAttribute('src');
    video.load();
  }, [resetPendingSeek, videoRef]);

  const patchReloadPlayer = useCallback(() => { setCacheBuster((v) => v + 1); }, []);

  const patchReloadSourcePath = useCallback((path: string) => {
    // patch: the same URL is reloaded with a new cache buster, so the element keeps its pending seek
    // unless it is dropped here.
    resetPendingSeek();
    setFilePath(path);
    setCacheBuster((v) => v + 1);
    setCommandedTime(0);
  }, [resetPendingSeek, setCacheBuster, setCommandedTime]);

  // patch: the finish job reports where it moved the source. The entry follows it (taking its new
  // name), and rows that now name the same file are folded into one - listing the moved file twice
  // is exactly how a source ended up with two identical rows in the list.
  const patchUpdateBatchSourcePath = useCallback((from: string, to: string) => {
    const caseInsensitive = manifestPathCaseInsensitive;
    setBatchFiles((existing) => updateBatchPath(existing, { from, to, caseInsensitive }));
    setSelectedBatchFiles((selected) => dedupePaths(
      selected.map((path) => (isSamePath(path, from, { caseInsensitive }) ? to : path)),
      { caseInsensitive },
    ));
  }, []);

  // patch: the finish flow (`Shift+E`, `zm` / `zc`, `opl`). The source list owns the paths, so the
  // job updates the entry in place and then opens the next source. With no next source the last one
  // stays open (patch mode): the user may still want to change a cut, and replaying starts at 0.
  const patchFinishOnJobFinished = useCallback(async ({ previousSourcePath, report, next, playerReleased }: {
    previousSourcePath: string;
    report: PatchFinishReport;
    next: PatchFinishNextChoice;
    playerReleased: boolean;
  }) => {
    let nextPath: string | undefined;
    if (next === 'next') {
      const index = batchFiles.findIndex((file) => isSamePath(file.path, previousSourcePath, { caseInsensitive: manifestPathCaseInsensitive }));
      const candidates = index === -1 ? [] : batchFiles.slice(index + 1);
      for (const candidate of candidates) {
        // eslint-disable-next-line no-await-in-loop
        if (await mainApi.pathExists(candidate.path)) {
          nextPath = candidate.path;
          break;
        }
      }
    }

    const continuation = planFinishContinuation({
      next,
      nextPath,
      previousSourcePath,
      newSourcePath: report.newSourcePath,
      playerReleased,
    });

    if (continuation.kind === 'open-next') {
      setSelectedBatchFiles([continuation.path]);
      await batchOpenSingleFile(continuation.path);
      return;
    }

    if (continuation.reload) patchReloadSourcePath(continuation.sourcePath);
    else seekAbs(0);

    if (next === 'next' && nextPath == null) {
      getSwal().toast.fire({ icon: 'info', text: i18n.t('No next video. This video stays open.') });
    }
  }, [batchFiles, batchOpenSingleFile, patchReloadSourcePath, seekAbs]);

  // patch: a discarded source leaves the batch (it is parked, not finished) and the next one opens.
  // With no next source the cutting window goes back to the landing page: unlike the finish flow
  // there is nothing left to keep open, the file the window showed has moved.
  const patchDiscardOnDiscarded = useCallback(async ({ previousSourcePath }: { previousSourcePath: string }) => {
    const isPrevious = (path: string) => isSamePath(path, previousSourcePath, { caseInsensitive: manifestPathCaseInsensitive });
    const index = batchFiles.findIndex((file) => isPrevious(file.path));
    const candidates = index === -1 ? [] : batchFiles.slice(index + 1);

    setBatchFiles((existing) => existing.filter((file) => !isPrevious(file.path)));
    setSelectedBatchFiles((selected) => selected.filter((path) => !isPrevious(path)));

    let nextPath: string | undefined;
    for (const candidate of candidates) {
      // eslint-disable-next-line no-await-in-loop
      if (await mainApi.pathExists(candidate.path)) {
        nextPath = candidate.path;
        break;
      }
    }

    if (nextPath != null) {
      setSelectedBatchFiles([nextPath]);
      await batchOpenSingleFile(nextPath);
      return;
    }

    await flushProjectSave().catch((err: unknown) => { console.warn('Failed to save the project file before returning to the landing page', err); });
    if (patchMode && !playerMode && !mergedMode) {
      await mainApi.patchReleaseSourceClaims().catch((err: unknown) => { console.warn('Failed to release the source claim', err); });
    }
    resetState();
    clearSegments();
  }, [batchFiles, batchOpenSingleFile, clearSegments, flushProjectSave, mergedMode, patchMode, playerMode, resetState]);

  // patch: the finish hook announces its job before its first `await`, so the export guard below
  // cannot miss it in the gap before `busy` is rendered.
  const markFinishJobRunning = useCallback((running: boolean) => {
    patchFinishExecutingRef.current = running;
  }, []);

  const patchFinish = usePatchFinish({
    filePath,
    workRoot: patchWork?.effectiveRoot,
    projectFilePath: projectFileSavePath,
    patchMode,
    playerMode,
    mergedMode,
    resultSourcePath: patchPlayerCurrentEntry?.sourcePath ?? patchPlayerEntries.find((entry) => entry.sourcePath != null)?.sourcePath,
    caseInsensitive: manifestPathCaseInsensitive,
    // `workingRef` holds a boolean (not a state object), so it must be read as one: `!= null` is
    // always true and would block the finish dialog forever.
    isWorking: patchIsWorking,
    // patch: a finish is a real save: write the project file even when the cut list came from a
    // video-named `.llc` and nothing changed since it was opened.
    flushProjectSave: flushProjectSaveForced,
    updateBatchSourcePath: patchUpdateBatchSourcePath,
    releasePlayer: patchReleasePlayer,
    reloadPlayer: patchReloadPlayer,
    reloadSource: patchReloadSourcePath,
    suspendPreview: patchSuspendPreview,
    resumePreview: patchResumePreview,
    onJobFinished: (params) => { patchFinishOnJobFinished(params).catch((err: unknown) => { console.error('Failed to continue after the finish job', err); }); },
    // patch: the finish rename renders with the same naming inputs the export dialog uses.
    cutRenameNaming: { maxLabelLength, minZeroPadding: outputFileNameMinZeroPadding, isWindows },
    // patch: the summary names the key that confirms it when `Shift+F` opened the step.
    skipConfirmKeys: keyBindingByAction['finishKeepSource']?.keys,
    // patch: the export guard must see the job from its first instant, not from the first render
    // that shows `busy` (see `patchFinishExecutingRef`).
    onJobRunningChange: markFinishJobRunning,
  });
  const patchEnsureSourceOutsideWorkArea = patchFinish.ensureSourceOutsideWorkArea;
  useEffect(() => {
    patchFinishGuardRef.current = patchEnsureSourceOutsideWorkArea;
  }, [patchEnsureSourceOutsideWorkArea]);
  // patch: `Ctrl+Delete` sets a source aside instead of finishing it (fork-owned, features/patchDiscard).
  // It reuses the finish executor in `discard` mode, so the work-area lock, the file-in-use guard
  // and the result windows behave exactly like `Shift+E`.
  const patchDiscard = useDiscardSource({
    filePath,
    workRoot: patchWork?.effectiveRoot,
    projectFilePath: projectFileSavePath,
    enabled: patchMode && !playerMode && !mergedMode,
    isWorking: patchIsWorking,
    // patch: a discard moves the source and its `.llc`, so the project file has to exist.
    flushProjectSave: flushProjectSaveForced,
    releasePlayer: patchReleasePlayer,
    reloadPlayer: patchReloadPlayer,
    reloadSource: patchReloadSourcePath,
    suspendPreview: patchSuspendPreview,
    resumePreview: patchResumePreview,
    discardKey: keyBindingByAction['discardSource']?.keys,
    updateBatchSourcePath: patchUpdateBatchSourcePath,
    onDiscarded: (params) => { patchDiscardOnDiscarded(params).catch((err: unknown) => { console.error('Failed to continue after a discard', err); }); },
  });

  // patch: the finish and discard jobs keep their own `busy` flag (they do not fill the shared
  // `working` slot), and they move the very files an export would write. Mirrored into the ref
  // declared above so the export guard can read it without depending on the hooks.
  useEffect(() => {
    patchFinishJobRunningRef.current = (patchFinish.dialogProps?.busy ?? false) || (patchDiscard.dialog?.busy ?? false);
    patchFinishDialogOpenRef.current = patchFinish.dialogProps?.isShown ?? false;
  }, [patchFinish.dialogProps?.busy, patchFinish.dialogProps?.isShown, patchDiscard.dialog?.busy]);

  const onBatchFileSelect = useCallback((path: string) => {
    // patch: the selection is compared the way the file system compares (base mode: exact string).
    const isSelected = selectedBatchFiles.some((selected) => (patchMode
      ? isSamePath(selected, path, { caseInsensitive: manifestPathCaseInsensitive })
      : selected === path));
    if (isSelected) batchOpenSingleFile(path);
    else setSelectedBatchFiles([path]);
  }, [batchOpenSingleFile, patchMode, selectedBatchFiles]);

  const goToTimecode = useCallback(async () => {
    if (!filePath) return;
    const initialValue = formatTimecode({ seconds: commandedTimeRef.current });

    // patch: patch mode gets its own dialog (format help + the compact/plain swap); base mode keeps
    // the upstream one untouched. The effective bindings go along so the dialog can show the keys
    // that reopen/close it (the user may have rebound them).
    const timecode = patchMode
      ? await promptPatchTimecode({
        initialValue,
        title: i18n.t('Seek to timecode'),
        inputPlaceholder: timecodePlaceholder,
        allowRelative: true,
        parseTimecode,
        timecodeFormat,
        showGenericDialog,
        keyBindings: effectiveKeyBindings,
      })
      : await promptTimecode({
        initialValue,
        title: i18n.t('Seek to timecode'),
        description: i18n.t('Use + and - for relative seek'),
        allowRelative: true,
        inputPlaceholder: timecodePlaceholder,
      });

    if (timecode === undefined) return;

    if (timecode.relDirection != null) seekRel(timecode.duration * timecode.relDirection);
    else seekAbs(timecode.duration);
  }, [filePath, promptTimecode, formatTimecode, commandedTimeRef, timecodePlaceholder, seekRel, seekAbs, patchMode, parseTimecode, timecodeFormat, showGenericDialog, effectiveKeyBindings]);

  const goToTimecodeDirect = useCallback(async ({ time: timeStr }: { time: string }) => {
    if (!filePath) return;
    invariant(timeStr != null);
    const timecode = parseTimecode(timeStr);
    invariant(timecode != null);
    seekAbs(timecode);
  }, [filePath, parseTimecode, seekAbs]);

  const toggleStreamsSelector = useCallback(() => setStreamsSelectorShown((v) => !v), []);

  const handleShowStreamsSelectorClick = useCallback(() => {
    // patch: the overlay no longer covers the title bar, and the export's tracks are part of its
    // snapshot: opening the selector mid-export is refused like every other export-locked action.
    if (isPatchExporting()) {
      warnExportRunning();
      return;
    }
    setStreamsSelectorShown(true);
  }, [isPatchExporting, warnExportRunning]);

  const extractAllStreams = useCallback(async () => {
    if (
      !filePath
      || !(await confirmDialog({ focusConfirm: true, description: t('Please confirm that you want to extract all tracks as separate files'), confirmButtonText: t('Extract all tracks') }))
      || workingRef.current
    ) return;
    try {
      setWorking({ text: i18n.t('Extracting all streams') });
      setStreamsSelectorShown(false);
      const [firstExtractedPath] = await extractStreams({ customOutDir, streams: mainCopiedStreams });
      if (!hideAllNotifications && firstExtractedPath != null) {
        showOsNotification(i18n.t('All tracks have been extracted'));
        openExportFinishedDialog({ filePath: firstExtractedPath, children: i18n.t('All streams have been extracted as separate files') });
      }
    } catch (err) {
      showOsNotification(i18n.t('Failed to extract tracks'));

      if (err instanceof RefuseOverwriteError) {
        showRefuseToOverwrite();
      } else if (err instanceof UserFacingError) {
        errorToast(err.message);
      } else {
        errorToast(i18n.t('Failed to extract all streams'));
        console.error('Failed to extract all streams', err);
      }
    } finally {
      setWorking(undefined);
    }
  }, [confirmDialog, customOutDir, extractStreams, filePath, hideAllNotifications, mainCopiedStreams, openExportFinishedDialog, setWorking, showOsNotification, t, workingRef]);


  const askStartTimeOffset = useCallback(async () => {
    const newStartTimeOffset = await promptTimecode({
      initialValue: startTimeOffset !== undefined ? formatTimecode({ seconds: startTimeOffset }) : undefined,
      title: i18n.t('Set custom start time offset'),
      description: i18n.t('Instead of video apparently starting at 0, you can offset by a specified value. This only applies to the preview inside LosslessCut and does not modify the file in any way. (Useful for viewing/cutting videos according to timecodes)'),
      inputPlaceholder: timecodePlaceholder,
      allowRelative: true,
    });

    if (newStartTimeOffset === undefined || newStartTimeOffset.duration < 0) return;

    const duration = newStartTimeOffset.relDirection != null ? newStartTimeOffset.duration * newStartTimeOffset.relDirection : newStartTimeOffset.duration;
    setStartTimeOffset(duration);
  }, [formatTimecode, promptTimecode, startTimeOffset, timecodePlaceholder]);

  const toggleKeyboardShortcuts = useCallback(() => setKeyboardShortcutsVisible((v) => !v), []);

  const runAndReloadFile = useCallback(async ({ operation, loadingText, errorText = i18n.t('The operation failed'), nameSuffix }: { operation: (params: { filePath: string, outPath: string }) => Promise<string>, loadingText: string, errorText?: string, nameSuffix: string }) => {
    if (!checkFileOpened() || workingRef.current) return;
    try {
      setWorking({ text: loadingText });
      setProgress(0);
      await withErrorHandling(async () => {
        invariant(fileFormat != null);
        invariant(filePath != null);
        const ext = getOutFileExtension({ outFormat: fileFormat, filePath });
        // patch: patch mode writes into `clips/`, so a temporary repair output (`-reformatted`,
        // `-decimated`) goes to its own folder instead of looking like a cut result.
        const fileName = getSuffixedFileName(filePath, `${nameSuffix}${ext}`);
        const outPath = getOutPath({ customOutDir, filePath, fileName: patchMode ? getPatchRepairTmpFileName(fileName) : fileName });
        const newPath = await operation({ filePath, outPath });
        await transferTimestamps({ inPath: filePath, outPath, duration: undefined, treatInputFileModifiedTimeAsStart, treatOutputFileModifiedTimeAsStart });

        await loadMedia({ filePath: newPath });
      }, errorText);
    } finally {
      setWorking(undefined);
      setProgress(undefined);
    }
  }, [checkFileOpened, customOutDir, fileFormat, filePath, loadMedia, patchMode, setWorking, treatInputFileModifiedTimeAsStart, treatOutputFileModifiedTimeAsStart, withErrorHandling, workingRef]);

  const tryFixInvalidDuration = useCallback(async () => runAndReloadFile({
    operation: async ({ filePath: fp, outPath }) => {
      const path = await fixInvalidDuration({ filePath: fp, outPath, onProgress: setProgress });
      showNotification({ icon: 'info', text: i18n.t('Duration has been fixed') });
      return path;
    },
    loadingText: i18n.t('Fixing file duration'),
    nameSuffix: 'reformatted',
  }), [fixInvalidDuration, runAndReloadFile, showNotification]);

  const tryDecimate = useCallback(async () => {
    if (!checkFileOpened()) return;
    const params = await openDecimateDialog();
    if (params == null) return;
    await runAndReloadFile({
      operation: async ({ filePath: fp, outPath }) => decimate({ filePath: fp, outPath, ...params }),
      loadingText: i18n.t('Decimating video'),
      nameSuffix: 'decimated',
    });
  }, [checkFileOpened, decimate, openDecimateDialog, runAndReloadFile]);

  const addStreamSourceFile = useCallback(async (path: string) => {
    if (allFilesMeta[path]) return undefined; // Already added?
    const fileMeta = await readFileFfprobeMeta(path);
    // console.log('streams', fileMeta.streams);
    setExternalFilesMeta((old) => ({ ...old, [path]: fileMeta }));
    setCopyStreamIdsForPath(path, () => fromPairs(fileMeta.streams.map(({ index }) => [index, true])));
    return fileMeta;
  }, [allFilesMeta, setCopyStreamIdsForPath]);

  const hvc1NeededStreams = useMemo(() => copyFileStreams.flatMap(({ path, streamIds }) => (allFilesMeta[path]?.streams ?? []).filter((stream) => streamIds.includes(stream.index) && needsHvc1Tag({ stream, outFormat: fileFormat, customTag: paramsByFile.get(path)?.paramsByStream.get(stream.index)?.tag }))), [allFilesMeta, copyFileStreams, fileFormat, paramsByFile]);

  const updateStreamParams = useCallback<Parameters<typeof StreamsSelector>[0]['updateStreamParams']>((fileId, streamId, setter) => setParamsByFile(produce((draft) => {
    if (!draft.has(fileId)) draft.set(fileId, { metadata: {}, paramsByStream: new Map() });
    const fileMap = draft.get(fileId);
    invariant(fileMap != null);
    if (!fileMap.paramsByStream.has(streamId)) fileMap.paramsByStream.set(streamId, { metadata: {} });

    const params = fileMap.paramsByStream.get(streamId);
    invariant(params != null);
    setter(params);
  })), [setParamsByFile]);

  const captureSnapshotAsCoverArt = useCallback(async () => {
    if (!filePath) return;
    await withErrorHandling(async () => {
      const currentTime = getRelevantTime();
      const path = await captureFrameFromFfmpeg({ customOutDir, filePath, time: currentTime, captureFormat, quality: captureFrameQuality });
      const fileMeta = await addStreamSourceFile(path);
      if (!fileMeta) return;
      const firstIndex = fileMeta.streams[0]!.index;
      // eslint-disable-next-line no-param-reassign
      updateStreamParams(path, firstIndex, (params) => { params.disposition = 'attached_pic'; });
      showNotification({ text: i18n.t('Current frame has been set as cover art') });
    }, i18n.t('Failed to capture frame'));
  }, [addStreamSourceFile, captureFormat, captureFrameFromFfmpeg, captureFrameQuality, customOutDir, filePath, getRelevantTime, showNotification, updateStreamParams, withErrorHandling]);

  const batchLoadPaths = useCallback((newPaths: string[], append?: boolean) => {
    setBatchFiles((existingFiles) => {
      const mapPathsToFiles = (paths: string[]) => paths.map((path) => ({ path, name: basename(path) }));
      // patch: the list holds one row per file. The same file can arrive in another spelling
      // (`C:\a.mp4` vs `c:/a.mp4`) from a drop, the file dialog, the API or a moved source, and the
      // upstream exact-string list would show it twice. Base mode keeps that list untouched.
      if (patchMode) {
        const caseInsensitive = manifestPathCaseInsensitive;
        const newFiles = mapPathsToFiles(newPaths);
        if (append) {
          const nextFiles = appendBatchPaths(existingFiles, newFiles, { caseInsensitive });
          const firstNewFile = nextFiles.find((file) => existingFiles.every((existing) => !isSamePath(existing.path, file.path, { caseInsensitive })));
          // Nothing new: only write back when a duplicate row was healed by the append.
          if (firstNewFile == null) return nextFiles.length === existingFiles.length ? existingFiles : nextFiles;
          setSelectedBatchFiles([firstNewFile.path]);
          return nextFiles;
        }
        const nextFiles = dedupeBatchPaths(newFiles, { caseInsensitive });
        const [firstNewFile] = nextFiles;
        if (firstNewFile == null) return existingFiles;
        setSelectedBatchFiles([firstNewFile.path]);
        return nextFiles;
      }
      if (append) {
        const newUniquePaths = newPaths.filter((newPath) => existingFiles.every(({ path: existingPath }) => newPath !== existingPath));
        const [firstNewUniquePath] = newUniquePaths;
        if (firstNewUniquePath == null) return existingFiles;
        setSelectedBatchFiles([firstNewUniquePath]);
        return [...existingFiles, ...mapPathsToFiles(newUniquePaths)];
      }
      const [firstNewPath] = newPaths;
      invariant(firstNewPath != null);
      setSelectedBatchFiles([firstNewPath]);
      return mapPathsToFiles(newPaths);
    });
  }, [patchMode]);

  const userOpenFiles = useCallback(async (newFilePathsIn?: string[], { fromDrop = false }: { fromDrop?: boolean } = {}) => {
    // patch: opening a file replaces the export's source (and the segments). The dialog, a drop, the
    // menu and the HTTP API all end up here.
    if (patchMode && isPatchExportBlocked()) {
      warnExportRunning();
      return;
    }
    await withErrorHandling(async () => {
      let newFilePaths = newFilePathsIn;
      if (!newFilePaths || newFilePaths.length === 0) return;

      console.log('userOpenFiles');
      console.log(newFilePaths.join('\n'));

      lastOpenedPathRef.current = newFilePaths[0]!;

      let firstNewFilePath = newFilePaths[0]!;

      // first check if it is a single directory, and if so, read it recursively
      if (newFilePaths.length === 1 && (await lstat(firstNewFilePath)).isDirectory()) {
        console.log('Reading directory...');
        invariant(firstNewFilePath != null);
        newFilePaths = await readDirRecursively(firstNewFilePath);
      }

      // Only allow opening regular files
      for (const path of newFilePaths) {
        const fileStat = await lstat(path);

        if (!fileStat.isFile()) {
          errorToast(i18n.t('Cannot open anything else than regular files'));
          console.warn('Not a file:', path);
          return;
        }
      }

      if (newFilePaths.length > 1 && alwaysConcatMultipleFiles) {
        // patch: only media files are concatenated: a non-media file cannot be played.
        const concatFilter = patchMode ? filterPatchMediaPaths(newFilePaths) : undefined;
        if (concatFilter != null) notifySkippedMediaFiles(concatFilter.skipped);
        const concatPaths = concatFilter == null ? newFilePaths : concatFilter.media;
        if (concatPaths.length === 0) return;
        batchLoadPaths(concatPaths);
        setConcatDialogOpen(true);
        return;
      }

      firstNewFilePath = newFilePaths[0]!;
      invariant(firstNewFilePath != null);

      // https://en.wikibooks.org/wiki/Inside_DVD-Video/Directory_Structure
      if (newFilePaths.length === 1 && /^video_ts$/i.test(basename(firstNewFilePath))) {
        if (mustDisallowVob()) return;
        newFilePaths = await readVideoTs(firstNewFilePath);
      }

      // patch: the source list only accepts media. This split is used wherever a batch is filled
      // below; projects / subtitles / other documents keep their own flows untouched.
      const patchMediaPaths = patchMode ? filterPatchMediaPaths(newFilePaths) : undefined;

      if (workingRef.current) return;
      try {
        setWorking({ text: i18n.t('Loading file') });

        // If it's a project file (not llc) and we have an already opened file, import segments from the project
        const matchingImportProjectType = getImportProjectType(firstNewFilePath);
        if (matchingImportProjectType) {
          if (!checkFileOpened()) return;
          await loadEdlFile({ path: firstNewFilePath, type: matchingImportProjectType, append: true });
          return;
        }

        const filePathLowerCase = firstNewFilePath.toLowerCase();
        const isLlcProject = filePathLowerCase.endsWith('.llc');

        // patch: a drop that holds no playable media has nothing to open (the project /
        // subtitle flows above already took their files).
        if (patchMediaPaths != null && !isFileOpened && patchMediaPaths.media.length === 0 && !isLlcProject) {
          notifySkippedMediaFiles(patchMediaPaths.skipped);
          return;
        }

        // patch: a drop opens its first media file only when nothing is open; with a file already
        // open it only appends, so a drop never replaces the file being played (patch drop policy).
        // patch: only media files are added: a non-media file cannot be played.
        const patchDropPaths = patchMediaPaths == null ? newFilePaths : patchMediaPaths.media;
        const firstDroppedPath = patchDropPaths[0];
        const patchOpensFirst = fromDrop && patchMode && !playerMode && firstDroppedPath != null && !isFileOpened && !(newFilePaths.length === 1 && isLlcProject);
        const patchAppendsOnly = fromDrop && patchMode && !playerMode && isFileOpened && patchDropPaths.length > 1;

        if (patchOpensFirst || patchAppendsOnly) {
          if (patchMediaPaths != null) notifySkippedMediaFiles(patchMediaPaths.skipped);
          batchLoadPaths(patchDropPaths, true);
          if (patchOpensFirst && firstDroppedPath != null) {
            setWorking(undefined); // `workingRef` is already set; `batchOpenSingleFile` bails on it.
            await batchOpenSingleFile(firstDroppedPath);
          }
          return;
        }

        // Need to ask the user what to do if more than one option
        const inputOptions: { open?: string, project?: string, tracks?: string, subtitles?: string, addToBatch?: string, mergeWithCurrentFile?: string } = {};

        if (newFilePaths.length === 1) {
          inputOptions.open = i18n.t(isFileOpened ? 'Open the file instead of the current one' : 'Open the file');
        }

        if (isFileOpened && newFilePaths.length === 1) {
          if (isLlcProject) inputOptions.project = i18n.t('Load segments from the new file, but keep the current media');
          else if (filePathLowerCase.endsWith('.srt')) inputOptions.subtitles = i18n.t('Convert subtitiles into segments');
          inputOptions.tracks = i18n.t('Include all tracks from the new file');
        }

        if (isFileOpened) inputOptions.mergeWithCurrentFile = i18n.t('Merge/concatenate with current file');
        if (batchFiles.length > 0 || newFilePaths.length > 1) inputOptions.addToBatch = i18n.t('Add the file to the batch list');

        const inputOptionsKeys = Object.keys(inputOptions) as (keyof typeof inputOptions)[];

        let openFileResponse: OpenFileResponse | undefined;
        if (inputOptionsKeys.length === 1) [openFileResponse] = inputOptionsKeys;
        if (!enableAskForFileOpenAction && inputOptionsKeys.length > 1) openFileResponse = 'addToBatch';
        if (enableAskForFileOpenAction && inputOptionsKeys.length > 1) openFileResponse = await askForFileOpenAction(Object.entries(inputOptions) as [OpenFileResponse, string][]);
        else if (newFilePaths.length === 1) openFileResponse = 'open';

        if (openFileResponse === 'open') {
          // patch: patch mode keeps the source file list populated even for a single file, so the
          // list is always there to walk through (base mode only batches multiple files).
          // patch: only a media file is listed (a project / subtitle file is not playable).
          if (patchModeConsole != null) {
            const openBatchPaths = patchMediaPaths == null ? [firstNewFilePath] : patchMediaPaths.media.slice(0, 1);
            if (openBatchPaths.length > 0) batchLoadPaths(openBatchPaths, true);
          }
          await userOpenSingleFile({ path: firstNewFilePath, isLlcProject });
          return;
        }
        if (openFileResponse === 'project') {
          await loadEdlFile({ path: firstNewFilePath, type: 'llc' });
          return;
        }
        if (openFileResponse === 'subtitles') {
          await loadEdlFile({ path: firstNewFilePath, type: 'srt' });
          return;
        }
        if (openFileResponse === 'tracks') {
          await addStreamSourceFile(firstNewFilePath);
          setStreamsSelectorShown(true);
          return;
        }
        if (openFileResponse === 'addToBatch') {
          if (patchMediaPaths != null) {
            notifySkippedMediaFiles(patchMediaPaths.skipped);
            batchLoadPaths(patchMediaPaths.media, true);
          } else {
            batchLoadPaths(newFilePaths, true);
          }
          return;
        }
        if (openFileResponse === 'mergeWithCurrentFile') {
          // patch: the same file can arrive with another spelling (`C:\a.mp4` vs `c:/a.mp4`), so
          // patch mode deduplicates the way the file system compares paths, like every other place.
          // Base mode keeps upstream's exact-string set.
          const batchPaths: string[] = [];
          const addBatchPath = (path: string) => {
            if (batchPaths.every((existing) => !(patchMode
              ? isSamePath(existing, path, { caseInsensitive: manifestPathCaseInsensitive })
              : existing === path))) batchPaths.push(path);
          };
          if (filePath) addBatchPath(filePath);
          // patch: only media files are merged in (the list is not a general file list).
          if (patchMediaPaths != null) {
            notifySkippedMediaFiles(patchMediaPaths.skipped);
            for (const path of patchMediaPaths.media) addBatchPath(path);
          } else {
            for (const path of newFilePaths) addBatchPath(path);
          }
          batchLoadPaths(batchPaths);
          if (batchPaths.length > 1) setConcatDialogOpen(true);
        }
        // else: no match means dialog canceled or nothing useful to do:
      } finally {
        setWorking(undefined);
      }
    }, i18n.t('Failed to open file'));
  }, [withErrorHandling, alwaysConcatMultipleFiles, workingRef, batchLoadPaths, batchOpenSingleFile, setWorking, isFileOpened, batchFiles.length, enableAskForFileOpenAction, checkFileOpened, loadEdlFile, userOpenSingleFile, addStreamSourceFile, filePath, patchModeConsole, patchMode, playerMode, notifySkippedMediaFiles, isPatchExportBlocked, warnExportRunning]);

  const openFilesDialog = useCallback(async () => {
    // On Windows and Linux an open dialog can not be both a file selector and a directory selector, so if you set `properties` to `['openFile', 'openDirectory']` on these platforms, a directory selector will be shown. #1995
    const { canceled, filePaths } = await showOpenDialog({ properties: ['openFile', 'multiSelections'], defaultPath: lastOpenedPathRef.current!, title: t('Open file') });
    if (canceled) return;
    userOpenFiles(filePaths);
  }, [t, userOpenFiles]);

  const openDirDialog = useCallback(async () => {
    const { canceled, filePaths } = await showOpenDialog({ properties: ['openDirectory', 'multiSelections'], defaultPath: lastOpenedPathRef.current!, title: t('Open folder') });
    if (canceled) return;
    userOpenFiles(filePaths);
  }, [t, userOpenFiles]);

  const concatBatch = useCallback(() => {
    if (batchFiles.length < 2) {
      openFilesDialog();
      return;
    }

    setConcatDialogOpen(true);
  }, [batchFiles.length, openFilesDialog]);

  const togglePlaySelectedSegments = useCallback(() => togglePlay({ resetPlaybackRate: false, requestPlaybackMode: 'play-selected-segments' }), [togglePlay]);
  const toggleLoopSelectedSegments = useCallback(() => togglePlay({ resetPlaybackRate: false, requestPlaybackMode: 'loop-selected-segments' }), [togglePlay]);

  const copySegmentsToClipboard = useCallback(async () => {
    if (!isFileOpened || selectedSegments.length === 0) return;
    mainApi.writeClipboardText(formatTsvHuman(selectedSegments));
  }, [isFileOpened, selectedSegments]);

  const showIncludeExternalStreamsDialog = useCallback(async () => {
    await withErrorHandling(async () => {
      const { canceled, filePaths } = await showOpenDialog({
        properties: ['openFile'],
        title: t('Include more tracks from other file'),
        ...(filePath != null && { defaultPath: dirname(filePath) }),
      });
      const [firstFilePath] = filePaths;
      if (canceled || firstFilePath == null) return;
      await addStreamSourceFile(firstFilePath);
    }, i18n.t('Failed to include track'));
  }, [addStreamSourceFile, filePath, t, withErrorHandling]);

  const toggleFullscreenVideo = useCallback(async () => {
    if (!screenfull.isEnabled) {
      console.warn('Fullscreen not allowed');
      return;
    }
    try {
      if (videoRef.current == null) {
        console.warn('No video tag to full screen');
        return;
      }
      invariant(videoContainerRef.current != null);
      await screenfull.toggle(videoContainerRef.current, { navigationUI: 'hide' });
    } catch (err) {
      console.error('Failed to toggle fullscreen', err);
    }
  }, [videoContainerRef, videoRef]);

  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(screenfull.isFullscreen);
    if (!screenfull.isEnabled) return undefined;
    screenfull.on('change', onFullscreenChange);
    return () => screenfull.off('change', onFullscreenChange);
  }, []);

  const onEditSegmentTags = useCallback((index: number) => {
    setEditingSegmentTagsSegmentIndex(index);
    const seg = cutSegments[index];
    invariant(seg != null);
    setEditingSegmentTags(getSegmentTags(seg));
  }, [cutSegments]);

  const editCurrentSegmentTags = useCallback(() => {
    onEditSegmentTags(currentSegIndexSafe);
  }, [currentSegIndexSafe, onEditSegmentTags]);

  const promptDownloadMediaUrlWrapper = useCallback(async () => {
    try {
      setWorking({ text: t('Downloading URL') });
      await withErrorHandling(async () => {
        const newCustomOutDir = await ensureWritableOutDir({ outDir: customOutDir });
        if (newCustomOutDir == null) {
          errorToast(i18n.t('Please select a working directory first'));
          return;
        }
        const outPath = getDownloadMediaOutPath(newCustomOutDir, `downloaded-media-${Date.now()}.mkv`);
        const downloaded = await promptDownloadMediaUrl(outPath);
        if (downloaded) await loadMedia({ filePath: outPath });
      }, i18n.t('Failed to download URL'));
    } finally {
      setWorking();
    }
  }, [customOutDir, ensureWritableOutDir, loadMedia, setWorking, t, withErrorHandling]);

  type MainKeyboardAction = Exclude<KeyboardAction, 'goToTimecodeDirect'>;

  const mainActions = useMemo(() => {
    async function exportYouTube() {
      if (!checkFileOpened()) return;
      await openYouTubeChaptersDialog(formatYouTube(cutSegments));
    }

    function seekRelAccelerated(amount: number) {
      seekRel(seekAccelerationRef.current * amount);
      seekAccelerationRef.current *= keyboardSeekAccFactor;
    }

    const ret: Record<MainKeyboardAction, () => void> = {
      // NOTE: Do not change these keys because users have bound keys by these names in their config files
      // For actions, see also KeyboardShortcuts.jsx
      togglePlayNoResetSpeed: () => togglePlay(),
      togglePlayResetSpeed: () => togglePlay({ resetPlaybackRate: true }),
      // patch: patch mode's K slot: reset the playback speed to 1x without playing or pausing.
      resetPlaybackRate: () => setPlaybackRate(1),
      // patch: patch mode's Z slot: toggle between 1x and the last speed the user chose.
      // In base mode the key is upstream's comfort zoom, so this action is unreachable there
      // unless the user bound it; bound explicitly, it does the same thing either way.
      togglePlaybackRate: () => playbackRateMemory.toggle(videoRef.current?.playbackRate ?? playbackRate, setPlaybackRate),
      // patch: the console listens for its own binding (see features/patchConsole/PatchCommandLayer),
      // so this entry only keeps the action map complete.
      togglePatchCommandConsole: () => undefined,
      togglePlayOnlyCurrentSegment: () => togglePlay({ resetPlaybackRate: true, requestPlaybackMode: 'play-segment-once' }),
      toggleLoopOnlyCurrentSegment: () => togglePlay({ resetPlaybackRate: true, requestPlaybackMode: 'loop-segment' }),
      toggleLoopStartEndOnlyCurrentSegment: () => togglePlay({ resetPlaybackRate: true, requestPlaybackMode: 'loop-segment-start-end' }),
      togglePlaySelectedSegments,
      toggleLoopSelectedSegments,
      play: () => play(),
      pause,
      reducePlaybackRate: () => userChangePlaybackRate(-1),
      reducePlaybackRateMore: () => userChangePlaybackRate(-1, 2),
      increasePlaybackRate: () => userChangePlaybackRate(1),
      increasePlaybackRateMore: () => userChangePlaybackRate(1, 2),
      timelineToggleComfortZoom,
      captureSnapshot,
      captureSnapshotAsCoverArt,
      captureSnapshotToClipboard,
      setCutStart,
      setCutEnd,
      cleanupFilesDialog,
      splitCurrentSegment,
      focusSegmentAtCursor,
      selectSegmentsAtCursor,
      increaseRotation,
      goToTimecode: () => goToTimecode(),
      seekBackwards: () => seekRelAccelerated(-keyboardNormalSeekSpeed),
      seekBackwards2: () => seekRelAccelerated(-keyboardSeekSpeed2),
      seekBackwards3: () => seekRelAccelerated(-keyboardSeekSpeed3),
      seekForwards: () => seekRelAccelerated(keyboardNormalSeekSpeed),
      seekForwards2: () => seekRelAccelerated(keyboardSeekSpeed2),
      seekForwards3: () => seekRelAccelerated(keyboardSeekSpeed3),
      seekBackwardsPercent: () => seekRelPercent(-0.01),
      seekForwardsPercent: () => seekRelPercent(0.01),
      seekBackwardsKeyframe: () => seekClosestKeyframe(-1),
      seekForwardsKeyframe: () => seekClosestKeyframe(1),
      seekPreviousFrame: () => shortStep(-1),
      seekNextFrame: () => shortStep(1),
      jumpPrevSegment: () => jumpSeg({ rel: -1 }),
      jumpSeekPrevSegment: () => jumpSeg({ rel: -1, seek: true }),
      jumpNextSegment: () => jumpSeg({ rel: 1 }),
      jumpSeekNextSegment: () => jumpSeg({ rel: 1, seek: true }),
      jumpFirstSegment: () => jumpSeg({ abs: 0 }),
      jumpSeekFirstSegment: () => jumpSeg({ abs: 0, seek: true }),
      jumpLastSegment: () => jumpSeg({ abs: cutSegments.length - 1 }),
      jumpSeekLastSegment: () => jumpSeg({ abs: cutSegments.length - 1, seek: true }),
      jumpCutStart,
      jumpCutEnd,
      jumpSegmentEndPreview,
      jumpTimelineStart,
      jumpTimelineEnd,
      timelineZoomIn: () => zoomRel(1),
      timelineZoomOut: () => zoomRel(-1),
      batchPreviousFile: () => batchFileJump(-1, false),
      batchNextFile: () => batchFileJump(1, false),
      batchOpenPreviousFile: () => batchFileJump(-1, true),
      batchOpenNextFile: () => batchFileJump(1, true),
      // patch: `Shift+PgUp` / `Shift+PgDn`: the same switch, and the opened source starts playing.
      batchOpenPlayPreviousFile: () => batchFileJump(-1, true, true),
      batchOpenPlayNextFile: () => batchFileJump(1, true, true),
      batchOpenSelectedFile,
      // patch: the player window's cut-results playlist and its result renames.
      playlistPrev: patchPlaylistPrev,
      playlistNext: patchPlaylistNext,
      playlistFirst: patchPlaylistFirst,
      playlistLast: patchPlaylistLast,
      renameResultLabel: () => openPatchRenameDialog('label'),
      renameResultFull: () => openPatchRenameDialog('full'),
      closeBatch,
      removeCurrentSegment: () => removeSegment(currentSegIndexSafe, true),
      removeCurrentCutpoint: () => removeSegment(currentSegIndexSafe),
      undo: () => cutSegmentsHistory.back(),
      redo: () => cutSegmentsHistory.forward(),
      labelCurrentSegment: () => labelSegment(currentSegIndexSafe),
      addSegment,
      // patch: `Alt+/` arms the next in point to add a segment instead of moving the current one
      // (see features/patchCutMark). Pressing it again cancels the arm.
      toggleNewSegmentMark: () => {
        const armed = toggleNewSegmentMark();
        showNotification({ text: i18n.t(armed ? 'The next in point starts a new segment.' : 'The in point moves the current segment again.') });
      },
      // patch: the cut queue puts the copy right after the segment it was copied from.
      duplicateCurrentSegment: patchMode ? () => duplicateCurrentSegment({ insertAfter: true }) : duplicateCurrentSegment,
      toggleLastCommands,
      export: () => onExportPress(),
      // patch: re-cut everything without asking (the console's `exportforce`). It skips the export
      // sheet, so the merged name is timestamped when it starts (see `patchExportNameEpochRef`).
      exportForce: () => {
        beginPatchExportName();
        onExportConfirm({ force: true }).catch((err: unknown) => { console.error('Failed to force the export', err); });
      },
      // patch: merge the cut results into one file (the results window's `e`, the console's `merge`).
      mergeCutResults: patchMergeName.request,
      // patch: end the job (Shift+E, the console's `zm` / `zc`).
      finish: () => patchFinish.openFinish('auto'),
      finishMerge: () => patchFinish.openFinish('merge'),
      finishCut: () => patchFinish.openFinish('cut'),
      // patch: `Shift+F`, the skip workflow: same dialog and job, but the video is skipped (it is
      // not cut) and its own remembered choices are used - `Shift+E` keeps its own (see
      // features/patchFinish/flow).
      finishKeepSource: () => patchFinish.openFinish('auto', 'keepSource'),
      // patch: `Ctrl+Delete` sets the source aside (waiting-for-deletion folder), asking about its
      // results on the way (features/patchDiscard).
      discardSource: () => { patchDiscard.open().catch((err: unknown) => { console.error('Failed to open the discard dialog', err); }); },
      extractCurrentSegmentFramesAsImages,
      extractSelectedSegmentsFramesAsImages,
      reorderSegsByStartTime,
      invertAllSegments,
      fillSegmentsGaps,
      combineOverlappingSegments,
      combineSelectedSegments,
      createFixedDurationSegments,
      createNumSegments,
      createFixedByteSizedSegments,
      createRandomSegments,
      alignSegmentTimesToKeyframes,
      shuffleSegments,
      clearSegments,
      toggleSegmentsList,
      toggleStreamsSelector,
      extractAllStreams,
      convertFormatCurrentFile: () => userHtml5ifyCurrentFile(),
      convertFormatBatch,
      concatBatch,
      toggleKeyframeCutMode: () => toggleKeyframeCut(true),
      toggleCaptureFormat,
      toggleStripAudio,
      toggleStripVideo,
      toggleStripSubtitle,
      toggleStripThumbnail,
      toggleStripCurrentFilter: () => applyEnabledStreamsFilter(),
      toggleStripAll,
      toggleDarkMode,
      setStartTimeOffset: askStartTimeOffset,
      deselectAllSegments,
      selectAllSegments,
      selectOnlyCurrentSegment,
      editCurrentSegmentTags,
      toggleCurrentSegmentSelected,
      invertSelectedSegments,
      removeSelectedSegments,
      fixInvalidDuration: tryFixInvalidDuration,
      decimate: tryDecimate,
      shiftAllSegmentTimes,
      increaseVolume: () => setPlaybackVolume((val) => Math.min(1, val + 0.07)),
      decreaseVolume: () => setPlaybackVolume((val) => Math.max(0, val - 0.07)),
      makeCursorTimeZero: () => setStartTimeOffset(-commandedTimeRef.current),
      toggleMuted,
      copySegmentsToClipboard,
      reloadFile: () => setCacheBuster((v) => v + 1),
      quit: () => mainApi.quitApp(),
      closeCurrentFile: () => { closeFileWithConfirm(); },
      exportYouTube,
      showStreamsSelector: handleShowStreamsSelectorClick,
      html5ify: () => userHtml5ifyCurrentFile({ ignoreRememberedValue: true }),
      openFilesDialog,
      openDirDialog,
      toggleSettings,
      openSendReportDialog: () => { openSendReportDialogWithState(); },
      detectBlackScenes,
      detectSilentScenes,
      detectSceneChanges,
      readAllKeyframes,
      createSegmentsFromKeyframes,
      toggleWaveformMode,
      toggleShowThumbnails,
      toggleShowKeyframes,
      showIncludeExternalStreamsDialog,
      toggleFullscreenVideo,
      selectAllMarkers,
      selectSegmentsByLabel,
      selectSegmentsByExpr,
      labelSelectedSegments,
      mutateSegmentsByExpr,

      // also called from menu (note: no longer a toggle. Esc must be used to close it because it's a dialog now):
      toggleKeyboardShortcuts,
      generateOverviewWaveform,
      // patch: `Alt+Q` shows/hides the app menu bar. The bar stays hidden in patch mode, so a bare
      // Alt cannot take the focus away from the cutting keys; the results windows do not get it
      // (their menu items would act on the cutting window).
      togglePatchMenuBar: () => {
        if (playerMode || mergedMode) return;
        mainApi.patchToggleMenuBar().catch((err: unknown) => { console.error('Failed to toggle the menu bar', err); });
      },
    };

    // patch: resume/toggle the results windows for the current source (`rsw`/`tcw`/`tmw`).
    // Extra keys beyond `MainKeyboardAction`: the console runs them by name via `baseActionNames`.
    const patchExtraActions = {
      resumewindows: () => { patchResume.resumeWindows().catch((err: unknown) => { console.error('Failed to resume windows', err); }); },
      toggleclipswindow: () => { patchResume.toggleClipsWindow().catch((err: unknown) => { console.error('Failed to toggle clips window', err); }); },
      togglemergedwindow: () => { patchResume.toggleMergedWindow().catch((err: unknown) => { console.error('Failed to toggle merged window', err); }); },
      // patch: the escape hatch (`Tools -> Unlock cutting`). It clears the export locks for good
      // until the next export starts - the running export itself is not touched.
      unlockcutting: () => {
        forceUnlockedRef.current = true;
        showNotification({ icon: 'info', text: i18n.t('Cutting is unlocked.') });
      },
      // patch: the time converter (`Tools -> Time convert...`). Also reachable by typing its name in
      // the console, because the console runs any base action name (features/patchTimeConvert).
      opentimeconvert: patchTimeConvert.open,
    };
    Object.assign(ret, patchExtraActions);

    // patch: a source inside the work area or the finished folder is read-only. Every action that
    // would change the cut list or produce/move files is replaced with the folder dialog; playback,
    // seeking, the view controls, segment selection/navigation and opening another file stay
    // untouched (see `patchWorkAreaLockedActions`). Repeated keys only show one dialog.
    if (patchReadOnlySource != null) {
      const showWorkAreaDialog = () => {
        patchFinishGuardRef.current().catch((err: unknown) => { console.error('Failed to show the work-directory dialog', err); });
      };
      return replacePatchWorkAreaActions(ret, showWorkAreaDialog);
    }

    // patch: the player window is a viewer - it plays the cut results, it does not produce them.
    // The merged window additionally locks its derived chapters: they are strictly read-only.
    if (mergedMode) return disablePatchMergedActions(disablePatchPlayerActions(ret));
    return playerMode ? disablePatchPlayerActions(ret) : ret;
  }, [playerMode, mergedMode, patchMode, playbackRate, playbackRateMemory, videoRef, patchReadOnlySource, patchResume, patchFinish, patchDiscard, patchMergeName, patchTimeConvert, patchPlaylistPrev, patchPlaylistNext, patchPlaylistFirst, patchPlaylistLast, openPatchRenameDialog, beginPatchExportName, onExportConfirm, togglePlaySelectedSegments, toggleLoopSelectedSegments, pause, setPlaybackRate, timelineToggleComfortZoom, captureSnapshot, captureSnapshotAsCoverArt, captureSnapshotToClipboard, setCutStart, setCutEnd, toggleNewSegmentMark, showNotification, cleanupFilesDialog, splitCurrentSegment, focusSegmentAtCursor, selectSegmentsAtCursor, increaseRotation, jumpCutStart, jumpCutEnd, jumpSegmentEndPreview, jumpTimelineStart, jumpTimelineEnd, batchOpenSelectedFile, closeBatch, addSegment, duplicateCurrentSegment, toggleLastCommands, extractCurrentSegmentFramesAsImages, extractSelectedSegmentsFramesAsImages, reorderSegsByStartTime, invertAllSegments, fillSegmentsGaps, combineOverlappingSegments, combineSelectedSegments, createFixedDurationSegments, createNumSegments, createFixedByteSizedSegments, createRandomSegments, alignSegmentTimesToKeyframes, shuffleSegments, clearSegments, toggleSegmentsList, toggleStreamsSelector, extractAllStreams, convertFormatBatch, concatBatch, toggleCaptureFormat, toggleStripAudio, toggleStripVideo, toggleStripSubtitle, toggleStripThumbnail, toggleStripAll, toggleDarkMode, askStartTimeOffset, deselectAllSegments, selectAllSegments, selectOnlyCurrentSegment, editCurrentSegmentTags, toggleCurrentSegmentSelected, invertSelectedSegments, removeSelectedSegments, tryFixInvalidDuration, tryDecimate, shiftAllSegmentTimes, toggleMuted, copySegmentsToClipboard, handleShowStreamsSelectorClick, openFilesDialog, openDirDialog, toggleSettings, detectBlackScenes, detectSilentScenes, detectSceneChanges, readAllKeyframes, createSegmentsFromKeyframes, toggleWaveformMode, toggleShowThumbnails, toggleShowKeyframes, showIncludeExternalStreamsDialog, toggleFullscreenVideo, selectAllMarkers, selectSegmentsByLabel, selectSegmentsByExpr, labelSelectedSegments, mutateSegmentsByExpr, toggleKeyboardShortcuts, generateOverviewWaveform, checkFileOpened, cutSegments, seekRel, keyboardSeekAccFactor, togglePlay, play, userChangePlaybackRate, goToTimecode, keyboardNormalSeekSpeed, keyboardSeekSpeed2, keyboardSeekSpeed3, seekRelPercent, seekClosestKeyframe, shortStep, jumpSeg, zoomRel, batchFileJump, removeSegment, currentSegIndexSafe, cutSegmentsHistory, labelSegment, onExportPress, userHtml5ifyCurrentFile, toggleKeyframeCut, applyEnabledStreamsFilter, setPlaybackVolume, commandedTimeRef, closeFileWithConfirm, openSendReportDialogWithState]);

  // patch: a key bound to a patch-only action does nothing in base mode. Say so instead of leaving
  // the user with a silent dead key. The action names come from the practice labels, which already
  // cover every action in one place.
  const actionLabels = useMemo(() => buildActionLabels(t), [t]);
  const patchOnlyNoticeOpenRef = useRef(false);
  const showPatchOnlyNotice = useCallback((action: KeyboardAction) => {
    // One at a time: a held key repeats, and a second dialog cannot open over the first.
    if (patchOnlyNoticeOpenRef.current || genericDialog != null) return;
    patchOnlyNoticeOpenRef.current = true;

    openNoticeDialog({
      title: t('No action in base mode'),
      description: (
        <div>
          <div style={{ marginBottom: '.5em' }}>
            <ActionKeys keyBindings={effectiveKeyBindings} action={action} />
            {' '}
            <span style={{ opacity: 0.8 }}>{actionLabels[action] ?? action}</span>
          </div>
          <div>{t('This shortcut has no action in base mode: it only works in patch mode.')}</div>
        </div>
      ),
    }).catch((err: unknown) => {
      console.error('Failed to show the base-mode shortcut notice', err);
    }).finally(() => {
      patchOnlyNoticeOpenRef.current = false;
    });
  }, [actionLabels, effectiveKeyBindings, genericDialog, openNoticeDialog, t]);

  const baseModePatchOnlyNotices = useMemo(() => Object.fromEntries(
    [...patchModeOnlyActions].map((action) => [action, () => { showPatchOnlyNotice(action); }]),
  ) as Partial<Record<MainKeyboardAction, () => void>>, [showPatchOnlyNotice]);

  // patch: every dispatch path (keyboard, menu / HTTP API / IPC, the command console) gets the same
  // export locks from one wrapper, so a new entry point cannot bypass them.
  const guardedMainActions = useMemo<Record<MainKeyboardAction, () => void>>(() => {
    if (patchMode) {
      return guardPatchExportActions({
        actions: mainActions,
        isBlocked: isPatchExportBlocked,
        onBlocked: () => { warnExportRunning(); },
      });
    }
    // Base mode runs the patch flows as nothing; announce that instead of swallowing the key.
    return { ...mainActions, ...baseModePatchOnlyNotices };
  }, [baseModePatchOnlyNotices, isPatchExportBlocked, mainActions, patchMode, warnExportRunning]);

  const getKeyboardAction = useCallback((action: MainKeyboardAction) => guardedMainActions[action], [guardedMainActions]);

  // patch: the practice notes pause the preview while they are open, and put it back before the
  // pending action runs so the action behaves as if the notes had never paused it.
  const practicePreview = useMemo<PracticePreviewControl>(() => ({
    isPlaying: () => playingRef.current,
    pause: () => pause(),
    restore: (wasPlaying: boolean) => {
      if (!wasPlaying) return;
      // Set the ref directly: `play()` only becomes visible through `playingRef` once the video
      // fires its `playing` event, and the pending action runs synchronously right after this.
      playingRef.current = true;
      videoRef.current?.play().catch(() => undefined);
    },
  }), [pause, playingRef, videoRef]);

  const keyUpActions = useMemo(() => {
    function seekReset() {
      seekAccelerationRef.current = 1;
    }
    return {
      seekBackwards: () => seekReset(),
      seekBackwards2: () => seekReset(),
      seekBackwards3: () => seekReset(),
      seekForwards: () => seekReset(),
      seekForwards2: () => seekReset(),
      seekForwards3: () => seekReset(),
    };
  }, []);

  const { keyboardLayoutMap, updateKeyboardLayout } = useKeyboard({ keyBindings: effectiveKeyBindings, keyUpActions, getKeyboardAction, closeExportConfirm, exportConfirmOpen });

  useEffect(() => {
    // eslint-disable-next-line unicorn/prefer-add-event-listener
    document.ondragover = dragPreventer;
    // eslint-disable-next-line unicorn/prefer-add-event-listener
    document.ondragend = dragPreventer;

    ipcRenderer.send('renderer-ready');
  }, []);

  useEffect(() => {
    ipcRenderer.send('setAskBeforeClose', askBeforeClose && isFileOpened);
  }, [askBeforeClose, isFileOpened]);

  const extractSingleStream = useCallback(async (index: number) => {
    if (!filePath || workingRef.current) return;
    try {
      setWorking({ text: i18n.t('Extracting track') });
      // setStreamsSelectorShown(false);
      const [firstExtractedPath] = await extractStreams({ customOutDir, streams: mainStreams.filter((s) => s.index === index) });
      if (!hideAllNotifications && firstExtractedPath != null) {
        showOsNotification(i18n.t('Track has been extracted'));
        openExportFinishedDialog({ filePath: firstExtractedPath, children: i18n.t('Track has been extracted') });
      }
    } catch (err) {
      showOsNotification(i18n.t('Failed to extract track'));

      if (err instanceof RefuseOverwriteError) {
        showRefuseToOverwrite();
      } else if (err instanceof UserFacingError) {
        errorToast(err.message);
      } else {
        errorToast(i18n.t('Failed to extract track'));
        console.error('Failed to extract track', err);
      }
    } finally {
      setWorking(undefined);
    }
  }, [customOutDir, extractStreams, filePath, hideAllNotifications, mainStreams, openExportFinishedDialog, setWorking, showOsNotification, workingRef]);

  const batchFilePaths = useMemo(() => batchFiles.map((f) => f.path), [batchFiles]);

  const onVideoError = useCallback(async () => {
    const error = videoRef.current?.error;
    if (!error) return;

    console.error('onVideoError', error.message, error.code);

    try {
      const PIPELINE_ERROR_READ = 2; // e.g. file has been moved after opening https://github.com/mifi/lossless-cut/issues/2423
      const PIPELINE_ERROR_DECODE = 3; // This usually happens when the user presses play or seeks, but the video is not actually playable. To reproduce: "RX100VII PCM audio timecode.MP4" or see https://github.com/mifi/lossless-cut/issues/804
      const MEDIA_ERR_SRC_NOT_SUPPORTED = 4; // Test: issue-668-3.20.1.m2ts - NOTE: DEMUXER_ERROR_COULD_NOT_OPEN and DEMUXER_ERROR_NO_SUPPORTED_STREAMS is also 4

      if (
        (
          (
            // MEDIA_ERR_SRC_NOT_SUPPORTED generally means we need to convert to supported format,
            error.code === MEDIA_ERR_SRC_NOT_SUPPORTED
            // _however_ this error can also happen half way into playback if the file has some corruption
            // but in that case we also get: "DEMUXER_ERROR_COULD_NOT_PARSE: FFmpegDemuxer: PTS is not defined 4"
            // and we don't want to auto convert in that case:
            && !error.message?.startsWith('DEMUXER_ERROR_COULD_NOT_PARSE')
          )
          || error.code === PIPELINE_ERROR_DECODE
        )
        && !usingPreviewFile // if we are already using preview file, we shouldn't try to do it again
        && filePath
        && !(error.code === MEDIA_ERR_SRC_NOT_SUPPORTED && error.message?.startsWith('DEMUXER_ERROR_COULD_NOT_PARSE'))
      ) {
        if (workingRef.current) return;
        try {
          setWorking({ text: i18n.t('Converting to supported format') });

          console.log('Trying to convert to supported format');

          // A valid duration is needed to create a html5ified dummy (`fastest`).
          if (!isDurationValid(parseFfprobeDuration(mainFileFormat?.duration))) {
            throw new UserFacingError(i18n.t('Invalid duration'));
          }

          if (hasVideo || hasAudio) {
            await html5ifyAndLoadWithPreferences(customOutDir, filePath, 'fastest', hasVideo, hasAudio);
            showNotNativelySupportedMessage();
          }
        } catch (err) {
          if (err instanceof UserFacingError) {
            throw err;
          }
          console.error(err);
          showPlaybackFailedMessage();
        } finally {
          setWorking(undefined);
        }
      } else if (error.code === PIPELINE_ERROR_READ) { // file is not readable or was removed
        getSwal().toast.fire({ icon: 'error', timer: 10000, text: i18n.t('Failed to read file. Perhaps it has been moved?') });
      }
    } catch (err) {
      toastError(err);
    }
  }, [videoRef, usingPreviewFile, filePath, workingRef, setWorking, mainFileFormat?.duration, hasVideo, hasAudio, html5ifyAndLoadWithPreferences, customOutDir, showNotNativelySupportedMessage]);

  const onVideoFocus = useCallback<FocusEventHandler<HTMLVideoElement>>((e) => {
    // prevent video element from stealing focus in fullscreen mode https://github.com/mifi/lossless-cut/issues/543#issuecomment-1868167775
    e.target.blur();
  }, []);

  const onVideoClick = useCallback(() => togglePlay(), [togglePlay]);

  const tryExportEdlFile = useCallback(async (type: EdlExportType) => {
    if (!checkFileOpened() || selectedSegments.length === 0) return;
    await withErrorHandling(async () => {
      // patch: the EDL exports follow upstream like the project file does (the upstream custom
      // output directory, otherwise next to the source video), not the patch work area.
      await exportEdlFile({ type, cutSegments: selectedSegments, customOutDir: upstreamOutDir, filePath, getFrameCount, llcTimeFormat });
    }, i18n.t('Failed to export project'));
  }, [checkFileOpened, upstreamOutDir, filePath, getFrameCount, selectedSegments, withErrorHandling, llcTimeFormat]);

  const importEdlFile = useCallback(async (type: EdlImportType) => {
    if (!checkFileOpened()) return;
    // patch: importing a cut list replaces the export's snapshot; it is gated like the other edits.
    if (patchMode && isPatchExportBlocked()) {
      warnExportRunning();
      return;
    }

    await withErrorHandling(async () => {
      const edl = await askForEdlImport({ type, fps: detectedFps, fileDuration, defaultPath: type === 'llc' ? getOutDir(customOutDir, filePath) : getFileDir(filePath) });
      if (edl.length > 0) loadCutSegments({ segments: edl, append: true, clampDuration: fileDuration });
    }, i18n.t('Failed to import project file'));
  }, [checkFileOpened, customOutDir, detectedFps, fileDuration, filePath, isPatchExportBlocked, loadCutSegments, patchMode, warnExportRunning, withErrorHandling]);
  useEffect(() => {
    const openFiles = async (filePaths: string[]) => userOpenFiles(filePaths.map((p) => resolvePathIfNeeded(p)));

    async function actionWithCatch(fn: () => Promise<void>) {
      try {
        await fn();
      } catch (err) {
        handleError({ err });
      }
    }

    const allActions = [
      // actions with arguments:
      [
        'openFiles',
        async (...argsRaw: unknown[]) => {
          await openFiles(...openFilesActionArgsSchema.parse(argsRaw));
        },
      ] as const,
      [
        'goToTimecodeDirect',
        async (...argsRaw: unknown[]) => {
          await goToTimecodeDirect(...goToTimecodeDirectArgsSchema.parse(argsRaw));
        },
      ] as const,
      ...Object.entries({
        // todo separate actions per type and move them into mainActions? https://github.com/mifi/lossless-cut/issues/254#issuecomment-932649424
        importEdlFile,
        exportEdlFile: tryExportEdlFile,
        promptDownloadMediaUrl: promptDownloadMediaUrlWrapper,
      }).map(([key, fn]) => [
        key,
        async (...args: unknown[]) => {
          await (fn as (...args2: unknown[]) => Promise<void>)(...args);
        },
      ] as const),
      // all main actions (no arguments):
      ...Object.entries(guardedMainActions).map(([key, fn]) => [
        key,
        async () => {
          fn();
        },
      ] as const),
    ];

    const allActionsMap = Object.fromEntries(allActions);

    const actionsWithCatch = allActions.map(([key, fn]) => [
      key,
      (...args: Parameters<typeof fn>) => actionWithCatch(() => fn(...args)),
    ] as const);

    async function tryApiAction(event: IpcRendererEvent, { id, action, args }: ApiActionRequest) {
      console.log('API action:', action, args);
      try {
        const fn = allActionsMap[action];
        if (!fn) throw new Error(`Action not found: ${action}`);
        // todo validate arguments
        await (args != null ? fn(...args) : fn());
      } catch (err) {
        console.error(err);
      } finally {
        // todo correlation ids
        event.sender.send('apiActionResponse', { id });
      }
    }

    const ipcActions = actionsWithCatch.map(([key, fn]) => [
      key,
      (_event: IpcRendererEvent, ...args: Parameters<typeof fn>) => actionWithCatch(() => fn(...args)),
    ] as const);

    ipcActions.forEach(([key, action]) => ipcRenderer.on(key, action));
    ipcRenderer.on('apiAction', tryApiAction);

    return () => {
      ipcActions.forEach(([key, action]) => ipcRenderer.off(key, action));
      ipcRenderer.off('apiAction', tryApiAction);
    };
  }, [checkFileOpened, customOutDir, detectedFps, filePath, getFrameCount, getKeyboardAction, goToTimecodeDirect, guardedMainActions, handleError, importEdlFile, loadCutSegments, mainActions, promptDownloadMediaUrlWrapper, selectedSegments, toggleKeyboardShortcuts, tryExportEdlFile, userOpenFiles]);

  // patch: the player window's playlist is owned by `usePatchPlayerPlaylist` (features/patchPlayer):
  // it receives it over IPC, opens the first result prompt-free and keeps the current result when a
  // new export replaces the playlist.

  // patch: another window may move or rename a result while this playlist is open. When the window
  // gets focus the paths are checked again, so a row that is gone is greyed out instead of failing.
  // Both sections of the list are rows, so both are checked (`getShownResultPaths`).
  const missingResultPaths = useResultFilesExist({
    enabled: patchMode && (playerMode || mergedMode),
    paths: getShownResultPaths({ entries: patchPlayerEntries, others: patchResultsOthers.others }),
  });

  const handleBatchFilesDrop = useCallback<DragEventHandler<HTMLDivElement>>(async (ev) => {
    ev.preventDefault();
    if (!ev.dataTransfer) return;
    await withErrorHandling(async () => {
      const filePaths = [...ev.dataTransfer.files].map((f) => webUtils.getPathForFile(f));
      await mainApi.focusWindow();
      // patch: dropping onto the batch list only appends, and starts the first dropped file only
      // when nothing is open yet (the user asked not to switch away from an open file).
      // patch: the list only holds media files - anything else cannot be played, so it is left out
      // (and the user is told).
      const { media, skipped } = patchMode ? filterPatchMediaPaths(filePaths) : { media: filePaths, skipped: [] };
      // The first new path is only used to open a dropped file in patch mode; base mode keeps its
      // upstream exact-string comparison untouched.
      const firstNewPath = patchMode
        ? media.find((path) => batchFiles.every((file) => !isSamePath(file.path, path, { caseInsensitive: manifestPathCaseInsensitive })))
        : undefined;
      batchLoadPaths(media, true);
      if (patchMode) notifySkippedMediaFiles(skipped);
      if (patchMode && !isFileOpened && firstNewPath != null) await batchOpenSingleFile(firstNewPath);
    });
  }, [batchFiles, batchLoadPaths, batchOpenSingleFile, isFileOpened, patchMode, notifySkippedMediaFiles, withErrorHandling]);

  const handleStreamSourceFileDrop = useCallback<DragEventHandler<HTMLDivElement>>(async (ev) => {
    ev.preventDefault();
    if (!ev.dataTransfer) return;
    await withErrorHandling(async () => {
      const filePaths = [...ev.dataTransfer.files].map((f) => webUtils.getPathForFile(f));
      if (filePaths.length !== 1) return;
      await mainApi.focusWindow();
      addStreamSourceFile(filePaths[0]!);
    });
  }, [addStreamSourceFile, withErrorHandling]);

  useEffect(() => {
    async function onDrop(ev: DragEvent) {
      ev.preventDefault();
      if (!ev.dataTransfer) return;
      const filePaths = [...ev.dataTransfer.files].map((f) => webUtils.getPathForFile(f));
      await mainApi.focusWindow();
      userOpenFiles(filePaths, { fromDrop: true });
    }
    const element = videoContainerRef.current;
    element?.addEventListener('drop', onDrop);
    return () => element?.removeEventListener('drop', onDrop);
  }, [userOpenFiles, videoContainerRef]);

  useEffect(() => {
    function onDrop(ev: DragEvent) {
      // default drop handler to prevent new electron window from popping up https://github.com/electron/electron/issues/39839
      ev.preventDefault();
    }
    document.body.addEventListener('drop', onDrop);
    return () => document.body.removeEventListener('drop', onDrop);
  }, []);

  const renderOutFmt = useCallback((style: CSSProperties) => (
    <OutputFormatSelect style={style} detectedFileFormat={detectedFileFormat} fileFormat={fileFormat} onOutputFormatUserChange={onOutputFormatUserChange} />
  ), [detectedFileFormat, fileFormat, onOutputFormatUserChange]);

  const onTunerRequested = useCallback((type: TunerType) => {
    setSettingsVisible(false);
    setTunerVisible(type);
    if (type === 'waveformHeight') {
      setWaveformMode('waveform');
    }
  }, [setWaveformMode]);

  useEffect(() => {
    // patch: fork never requests or shows the sponsor link, in patch and base mode. The
    // upstream fetch below is kept verbatim behind this permanent false so an upstream
    // sync does not resurrect it; flip to true to restore upstream's behaviour.
    const showUpstreamSponsor = false;
    if (!showUpstreamSponsor || patchMode) return;
    if (!isStoreBuild && !hasDisabledNetworking()) loadMifiLink().then(setMifiLink);
  }, [patchMode]);

  useEffect(() => {
    (async () => {
      setFfmpegInfo(await runStartupCheck({ customFfPath, onError: ({ title, message }) => setGenericError({ title, err: message }) }));
    })();
  }, [customFfPath, setGenericError]);

  const appContext = useMemo<AppContextType>(() => ({
    working,
    setWorking,
    handleError,
    showGenericDialog,
    confirmDialog,
    keyboardLayoutMap,
    updateKeyboardLayout,
  }), [confirmDialog, handleError, keyboardLayoutMap, setWorking, showGenericDialog, updateKeyboardLayout, working]);


  // patch: in patch mode the list can be hidden without losing it (`batchFilesListVisible`); base
  // mode keeps the upstream rule verbatim because `patchModeConsole` is undefined there.
  // patch: the cutting window also keeps an empty list while a video is open, so its context menu
  // (with the greyed "Clear the source file list") stays reachable right after clearing it. It also
  // shows the empty list before the first video: the panel is where files are dropped, and the
  // top bar's button is the same switch, so hiding it is the only way it should disappear.
  const showLeftBar = playerMode
    ? patchPlayerEntries.length > 0 && (patchModeConsole == null || patchModeConsole.batchFilesListVisible)
    : (patchModeConsole != null
      ? patchModeConsole.batchFilesListVisible
      : batchFiles.length > 0);

  // patch: the player window has no segment list. Its clips already carry their cuts, so the list
  // would only ever be empty (and the sidebar toggle is hidden with it). The merged window is the
  // exception: it shows the same list as the cutting window, but its chapters are read-only.
  const showSegmentList = showRightBar && (!playerMode || mergedMode);

  function renderSubtitles() {
    if (!activeSubtitle) return null;
    return <track default kind="subtitles" label={activeSubtitle.lang} srcLang="en" src={activeSubtitle.url} />;
  }

  // throw new Error('Test error boundary');

  const baseColorStyle = useMemo(() => ({ color: 'var(--gray-12)', background: 'var(--gray-1)', colorScheme: darkMode ? 'only dark' : 'only light' }), [darkMode]);

  const rootClass = useMemo(() => [
    ...(darkMode ? ['dark-theme'] : []),
    ...(prefersReducedMotion ? ['no-animations'] : []),
  ].join(' '), [darkMode, prefersReducedMotion]);

  const rootStyle = useMemo<CSSProperties>(() => ({ ...baseColorStyle, display: 'flex', flexDirection: 'column', height: '100vh', transition: darkModeTransition }), [baseColorStyle]);

  return (
    <Theme appearance={darkMode ? 'dark' : 'light'} accentColor="cyan">
      <MotionConfig reducedMotion={reducedMotion}>
        <AppContext value={appContext}>
          <SegColorsContext value={segColorsContext}>
            <UserSettingsContext value={userSettingsContext}>
              <div className={rootClass} style={rootStyle} id="app-root">
                <TopMenu
                  filePath={filePath}
                  fileFormat={fileFormat}
                  changeEnabledStreamsFilter={changeEnabledStreamsFilter}
                  applyEnabledStreamsFilter={applyEnabledStreamsFilter}
                  enabledStreamsFilter={enabledStreamsFilter}
                  isCustomFormatSelected={isCustomFormatSelected}
                  renderOutFmt={renderOutFmt}
                  toggleSettings={toggleSettings}
                  numStreamsToCopy={numStreamsToCopy}
                  numStreamsTotal={numStreamsTotal}
                  setStreamsSelectorShown={setStreamsSelectorShown}
                  selectedSegments={segmentsOrInverse.selected}
                  toggleDarkMode={toggleDarkMode}
                  patchSourceListToggle={patchMode && !playerMode && !mergedMode && patchModeConsole != null
                    ? { visible: patchModeConsole.batchFilesListVisible, onToggle: patchModeConsole.toggleBatchFilesList }
                    : undefined}
                />

                <div style={{ flexGrow: 1, display: 'flex', overflowY: 'hidden' }}>
                  <AnimatePresence>
                    {showLeftBar && (playerMode ? (
                      <PatchCutResultsList
                        entries={patchPlayerEntries}
                        currentPath={filePath}
                        width={leftBarWidth}
                        onSelect={patchPlayerOpen}
                        title={mergedMode ? t('Merge results') : (inspectMode ? t('Check list ({{count}})', { count: patchPlayerEntries.length }) : undefined)}
                        others={inspectMode ? undefined : patchResultsOthers.others}
                        othersTitle={t(mergedMode ? 'Other merged videos ({{count}})' : 'Other clips ({{count}})', { count: patchResultsOthers.others.length })}
                        onSelectOther={openPatchOtherResult}
                        missingPaths={missingResultPaths}
                      />
                    ) : (
                      <BatchFilesList
                        selectedBatchFiles={selectedBatchFiles}
                        filePath={filePath}
                        width={leftBarWidth}
                        batchFiles={batchFiles}
                        setBatchFiles={setBatchFiles}
                        onBatchFileSelect={onBatchFileSelect}
                        batchListRemoveFile={batchListRemoveFile}
                        closeBatch={closeBatch}
                        onMergeFilesClick={concatBatch}
                        onBatchConvertToSupportedFormatClick={convertFormatBatch}
                        onDrop={handleBatchFilesDrop}
                        patchMode={patchMode}
                        getExtraMenuItems={patchMode ? getBatchFileMenuItems : undefined}
                        panelMenuItems={batchListMenuItems}
                      />
                    ))}
                  </AnimatePresence>

                  {/* Middle part (also shown in fullscreen): */}
                  <div style={{ position: 'relative', flexGrow: 1, overflow: 'hidden' }} ref={videoContainerRef}>
                    {!isFileOpened && <NoFileLoaded patchMode={patchMode} mifiLink={mifiLink} currentCutSeg={currentCutSeg} onClick={openFilesDialog} darkMode={darkMode} keyBindingByAction={keyBindingByAction} keyBindings={effectiveKeyBindings} />}

                    <div className="no-user-select" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, visibility: !isFileOpened || !hasVideo || bigWaveformEnabled ? 'hidden' : undefined }} onWheel={onViewerWheel}>
                      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                      <video
                        className={styles['video']}
                        tabIndex={-1}
                        muted={playbackVolume === 0 || compatPlayerEnabled}
                        ref={videoRef}
                        style={mainVideoStyle}
                        onPlay={onStartPlaying}
                        onPause={onStopPlaying}
                        onAbort={onVideoAbort}
                        onDurationChange={onDurationChange}
                        onTimeUpdate={onTimeUpdate}
                        onError={onVideoError}
                        onClick={onVideoClick}
                        onDoubleClick={toggleFullscreenVideo}
                        onFocusCapture={onVideoFocus}
                        onSeeked={onSeeked}
                        onLoadedMetadata={playerMode ? onPlayerClipReady : (patchMode ? onPatchSourceLoaded : undefined)}
                        onEnded={playerMode ? onPlayerClipEnded : (patchMode ? onPatchSourceEnded : undefined)}
                      >
                        {renderSubtitles()}
                      </video>

                      {filePath != null && patchCompatPlayerEnabled && <MediaSourcePlayer rotate={effectiveRotation} filePath={filePath} videoStream={activeVideoStream} audioStreams={activeAudioStreams} masterVideoRef={videoRef} mediaSourceQuality={effectiveMediaSourceQuality} ffmpegHwaccel={ffmpegHwaccel} repairTimestamps={damagePolicy.playbackNeedsTranscode} baseVideoStyle={mainVideoStyle} />}
                    </div>

                    {bigWaveformEnabled && <BigWaveform waveforms={waveforms} relevantTime={relevantTime} playing={playing} fileDurationNonZero={fileDurationNonZero} zoom={zoomUnrounded} seekRel={seekRel} darkMode={darkMode} />}

                    {compatPlayerEnabled && (
                      <div style={{ position: 'absolute', top: 0, right: 0, left: 0, marginTop: '1em', marginLeft: '1em', color: 'var(--gray-12)', opacity: 0.7, display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
                        {isRotationSet ? (
                          <>
                            <MdRotate90DegreesCcw size={26} style={{ marginRight: 5 }} />
                            {t('Rotation preview')}
                          </>
                        ) : (
                          <>
                            {t('FFmpeg-assisted playback')}
                          </>
                        )}

                        {!damagedSource.hasDamage && (
                          <div style={{ cursor: 'pointer', pointerEvents: 'initial', color: 'var(--gray-12)', opacity: 0.7, padding: '.2em', marginLeft: '.5em' }} role="button" onClick={() => incrementMediaSourceQuality()} title={t('Select playback quality')}>{mediaSourceQualities[mediaSourceQuality]}</div>
                        )}

                        {/* patch: a damaged source has one control for this, next to the volume
                            (features/damagedSource); a second one here would disagree with it. */}
                        {!compatPlayerRequired && !damagedSource.hasDamage && <FaRegTimesCircle role="button" style={{ cursor: 'pointer', pointerEvents: 'initial', verticalAlign: 'middle', padding: '.2em' }} onClick={handleHideCompatPlayerClick} />}
                      </div>
                    )}

                    {/* patch: the source sits in `.losslesscut_work` or `losslesscut_finished`, so it
                        is almost always a video whose finish job already ran. Cutting is disabled
                        below; this says why before the user tries. */}
                    {patchReadOnlySourceCopy != null && (
                      <div
                        className="no-user-select"
                        title={patchReadOnlySourceCopy.tooltip}
                        style={{ position: 'absolute', top: 0, left: 0, marginTop: '1em', marginLeft: '1em', padding: '.25em .6em', borderRadius: '.3em', background: 'var(--yellow-9)', color: '#111', fontSize: '.8em', fontWeight: 'bold', pointerEvents: 'none', zIndex: 1 }}
                      >
                        {patchReadOnlySourceCopy.badge}
                      </div>
                    )}

                    {isFileOpened && (
                      <div className="no-user-select" style={{ position: 'absolute', right: 0, bottom: 0, marginBottom: 10, display: 'flex', alignItems: 'flex-end' }}>
                        <VolumeControl playbackVolume={playbackVolume} setPlaybackVolume={setPlaybackVolume} onToggleMutedClick={toggleMuted} revealOnVolumeChange={patchMode} />

                        {shouldShowPlaybackStreamSelector && (
                          <PlaybackStreamSelector subtitleStreams={subtitleStreams} videoStreams={videoStreams} audioStreams={audioStreams} activeSubtitleStreamIndex={activeSubtitleStreamIndex} activeVideoStreamIndex={activeVideoStreamIndex} activeAudioStreamIndexes={activeAudioStreamIndexes} onActiveSubtitleChange={onActiveSubtitleChange} onActiveVideoStreamChange={onActiveVideoStreamChange} onActiveAudioStreamsChange={onActiveAudioStreamsChange} />
                        )}

                        {!showSegmentList && (!playerMode || mergedMode) && (
                          <IoMdMenu
                            title={t('Show sidebar')}
                            size={30}
                            role="button"
                            style={{ marginRight: 10, color: 'var(--gray-12)', opacity: 0.7 }}
                            onClick={toggleSegmentsList}
                          />
                        )}
                      </div>
                    )}

                    {fullscreen && (
                      <div style={{ position: 'absolute', bottom: 0, left: 0, height: '.1em', backgroundColor: 'var(--red-9)', width: calculateTimelinePercent(playerTime, fileDuration) }} />
                    )}
                  </div>

                  <AnimatePresence>
                    {showSegmentList && isFileOpened && filePath != null && (
                      <SegmentList
                        width={rightBarWidth}
                        currentSegIndex={currentSegIndexSafe}
                        cutSegments={cutSegments}
                        inverseCutSegments={inverseCutSegments}
                        getFrameCount={getFrameCount}
                        formatTimecode={formatTimecode}
                        onSegClick={setCurrentSegIndex}
                        updateSegOrder={updateSegOrder}
                        updateSegOrders={updateSegOrders}
                        onLabelSegment={labelSegment}
                        currentCutSeg={currentCutSeg}
                        firstSegmentAtCursor={firstSegmentAtCursor}
                        addSegment={addSegment}
                        onDuplicateSegmentClick={duplicateSegment}
                        removeSegment={removeSegment}
                        onRemoveSelected={removeSelectedSegments}
                        toggleSegmentsList={toggleSegmentsList}
                        splitCurrentSegment={splitCurrentSegment}
                        selectedSegments={segmentsOrInverse.selected}
                        onSelectSingleSegment={selectOnlySegment}
                        onToggleSegmentSelected={toggleSegmentSelected}
                        onDeselectAllSegments={deselectAllSegments}
                        onSelectAllSegments={selectAllSegments}
                        onInvertSelectedSegments={invertSelectedSegments}
                        onExtractSegmentsFramesAsImages={extractSegmentsFramesAsImages}
                        onExtractSelectedSegmentsFramesAsImages={extractSelectedSegmentsFramesAsImages}
                        jumpSegStart={jumpSegStart}
                        jumpSegEnd={jumpSegEnd}
                        onSelectSegmentsByLabel={selectSegmentsByLabel}
                        onSelectSegmentsByExpr={selectSegmentsByExpr}
                        onSelectAllMarkers={selectAllMarkers}
                        onMutateSegmentsByExpr={mutateSegmentsByExpr}
                        onLabelSelectedSegments={labelSelectedSegments}
                        updateSegAtIndex={updateSegAtIndex}
                        editingSegmentTags={editingSegmentTags}
                        editingSegmentTagsSegmentIndex={editingSegmentTagsSegmentIndex}
                        setEditingSegmentTags={setEditingSegmentTags}
                        setEditingSegmentTagsSegmentIndex={setEditingSegmentTagsSegmentIndex}
                        onEditSegmentTags={onEditSegmentTags}
                        getSegEstimatedSize={getSegEstimatedSize}
                        // patch: the queue numbers and the queue's own help (features/patchSegmentQueue).
                        // The help describes cutting/merging the source video, so the results viewer
                        // does not show it. The merged window's chapters carry the numbers the cut
                        // queue showed for the same segments (see features/patchMerged).
                        patchMode={patchMode}
                        patchNumbers={mergedMode ? patchMergedNumbers : patchSegmentNumbers}
                        patchHelp={patchMode && !playerMode ? <SegmentQueueHelp keyBindingByAction={keyBindingByAction} keyBindings={effectiveKeyBindings} multiSelect={!mergedMode && !invertCutSegments} /> : undefined}
                        // patch: while `Alt+/` is armed, the queue shows its "0" row above the
                        // first segment, and that row (not a segment) is the active one.
                        patchLeadRow={patchMode && !playerMode && newSegmentMark ? <PatchNewSegmentRow onCreate={setCutStart} /> : undefined}
                        patchLeadActive={patchMode && !playerMode && newSegmentMark}
                        // patch: the merged window's chapters are read-only, and so is a source that
                        // sits inside the work area (its cuts are already finished; the badge says so).
                        // While the export runs the queue looks locked too: the data layer refuses every
                        // edit, and readOnly keeps jumping and selecting, which stay allowed.
                        readOnly={mergedMode || patchReadOnlySource != null || isPatchExportBlocked()}
                        // patch: "Work folders and results..." (see patchWorkPathListMenuItems).
                        patchExtraMenuItems={patchWorkPathListMenuItems}
                        // patch: the queue's Shift+click multi-selection (features/patchSegmentQueue).
                        patchRowClick={patchMultiSelect.handleRowClick}
                        patchMultiSelectedIds={patchMultiSelect.selection.selectedIds}
                        // patch: a Shift+click on a row belongs to the multi-selection, so it must not
                        // also start a drag (or jump the playhead on a double-click). Only where that
                        // selection exists: the merged window's read-only chapters keep base's gestures.
                        patchMultiSelect={patchMultiSelect.enabled}
                        patchSelectionBar={patchMultiSelect.open ? (
                          <SegmentSelectionBar
                            count={patchMultiSelect.summary.count}
                            exportableCount={patchMultiSelect.summary.exportableCount}
                            duration={patchMultiSelect.summary.duration}
                            formatTimecode={formatTimecode}
                            locked={isPatchExportBlocked()}
                            readOnly={patchReadOnlySource != null}
                            exportSelectionEmpty={isExportSelectionEmpty(cutSegments)}
                            onAction={patchMultiSelect.runAction}
                            onClose={patchMultiSelect.close}
                          />
                        ) : undefined}
                      />
                    )}
                  </AnimatePresence>
                </div>

                <div style={bottomStyle}>
                  <Timeline
                    shouldShowKeyframes={shouldShowKeyframes}
                    waveforms={waveforms}
                    overviewWaveform={overviewWaveform}
                    shouldShowWaveform={shouldShowWaveform}
                    waveformEnabled={waveformEnabled}
                    waveformHeight={waveformHeight}
                    showThumbnails={showThumbnails}
                    neighbouringKeyFrames={neighbouringKeyFrames}
                    thumbnails={thumbnailsSorted}
                    playerTime={playerTime}
                    commandedTime={commandedTime}
                    relevantTime={relevantTime}
                    commandedTimeRef={commandedTimeRef}
                    startTimeOffset={startTimeOffset}
                    zoom={zoom}
                    seekAbs={seekAbs}
                    fileDurationNonZero={fileDurationNonZero}
                    cutSegments={cutSegments}
                    setCurrentSegIndex={setCurrentSegIndex}
                    currentSegIndexSafe={currentSegIndexSafe}
                    currentCutSeg={currentCutSeg}
                    inverseCutSegments={inverseCutSegments}
                    formatTimecode={formatTimecode}
                    zoomWindowStartTime={zoomWindowStartTime}
                    zoomWindowEndTime={zoomWindowEndTime}
                    onZoomWindowStartTimeChange={setZoomWindowStartTime}
                    onGenerateOverviewWaveformClick={generateOverviewWaveform}
                    playing={playing}
                    isFileOpened={isFileOpened}
                    onWheel={onTimelineWheel}
                    goToTimecode={goToTimecode}
                    darkMode={darkMode}
                    setCutTime={playerMode || patchReadOnlySource != null ? noopSetCutTime : setCutTime}
                    setHoveringTime={setHoveringTime}
                    // patch: "Work folders and results..." (see patchWorkPathListMenuItems).
                    patchExtraMenuItems={patchWorkPathListMenuItems}
                  />

                  <BottomBar
                    zoom={zoom}
                    setZoom={zoomAbs}
                    timelineToggleComfortZoom={timelineToggleComfortZoom}
                    hasVideo={hasVideo}
                    isRotationSet={isRotationSet}
                    rotation={rotation}
                    areWeCutting={areWeCutting}
                    increaseRotation={increaseRotation}
                    cleanupFilesDialog={cleanupFilesDialog}
                    captureSnapshot={captureSnapshot}
                    onExportPress={onExportPress}
                    segmentsToExport={segmentsToExport}
                    seekAbs={seekAbs}
                    currentSegIndexSafe={currentSegIndexSafe}
                    cutSegments={cutSegments}
                    currentCutSeg={currentCutSeg}
                    selectedSegments={selectedSegments}
                    setCutStart={setCutStart}
                    setCutEnd={setCutEnd}
                    setCurrentSegIndex={setCurrentSegIndex}
                    jumpCutEnd={jumpCutEnd}
                    jumpCutStart={jumpCutStart}
                    jumpTimelineStart={jumpTimelineStart}
                    jumpTimelineEnd={jumpTimelineEnd}
                    startTimeOffset={startTimeOffset}
                    setCutTime={playerMode || patchReadOnlySource != null ? noopSetCutTime : setCutTime}
                    playing={playing}
                    shortStep={shortStep}
                    seekClosestKeyframe={seekClosestKeyframe}
                    togglePlay={togglePlay}
                    showThumbnails={showThumbnails}
                    toggleShowThumbnails={toggleShowThumbnails}
                    toggleWaveformMode={toggleWaveformMode}
                    waveformMode={waveformMode}
                    hasAudio={hasAudio}
                    keyframesEnabled={keyframesEnabled}
                    toggleShowKeyframes={toggleShowKeyframes}
                    detectedFps={detectedFps}
                    toggleLoopSelectedSegments={toggleLoopSelectedSegments}
                    isFileOpened={isFileOpened}
                    darkMode={darkMode}
                    outputPlaybackRate={outputPlaybackRate}
                    setOutputPlaybackRate={setOutputPlaybackRate}
                    formatTimecode={formatTimecode}
                    parseTimecode={parseTimecode}
                    playbackRate={playbackRate}
                    currentFrame={currentFrame}
                    playbackMode={playbackMode}
                    displayTime={displayTime}
                    fileDurationNonZero={fileDurationNonZero}
                    getFrameCount={getFrameCount}
                    playerMode={playerMode}
                    // patch: a source inside the work area is read-only (see `patchReadOnlySource`).
                    // While the export runs, its cut controls look locked too: the data layer refuses
                    // them anyway (`useSegments`), and the overlay no longer hides the bottom bar.
                    patchCutDisabled={patchReadOnlySource != null || isPatchExportBlocked()}
                    // patch: the tools menu of the open source; hidden in base mode and in result windows,
                    // where there is nothing to repair.
                    sourceRepairControl={patchMode && !playerMode && !mergedMode && isFileOpened ? (
                      <SourceRepairMenu
                        kinds={damagedSource.kinds}
                        repair={damagePolicy.playbackNeedsTranscode}
                        quality={damagePolicy.playbackQuality}
                        exportRepair={damagedSourceExportRepair}
                        onChoice={damagedSource.applyPlaybackChoice}
                        onExportRepair={setDamagedSourceExportRepair}
                      />
                    ) : undefined}
                  />
                </div>

                {tunerVisible != null && <ValueTuners type={tunerVisible} onFinished={() => setTunerVisible(undefined)} />}

                {/* Dialogs */}

                <ExportConfirm areWeCutting={areWeCutting} segmentsOrInverse={segmentsOrInverse} segmentsToExport={segmentsToExport} willMerge={willMerge} visible={exportConfirmOpen} onClosePress={closeExportConfirm} onExportConfirm={onExportConfirm} onExportConfirmForce={patchMode && patchWork?.effectiveRoot != null && !segmentsToChaptersOnly && !segmentsToChapters ? () => { onExportConfirm({ force: true }).catch((err: unknown) => { console.error('Failed to force the export', err); }); } : undefined} renderOutFmt={renderOutFmt} outputDir={outputDir} numStreamsTotal={numStreamsTotal} numStreamsToCopy={numStreamsToCopy} onShowStreamsSelectorClick={handleShowStreamsSelectorClick} outFormat={fileFormat} cutFileTemplate={cutFileTemplateOrDefault} cutMergedFileTemplate={cutMergedFileTemplateOrDefault} generateCutFileNames={generateCutFileNames} generateCutMergedFileNames={generateCutMergedFileNames} currentSegIndexSafe={currentSegIndexSafe} mainCopiedThumbnailStreams={mainCopiedThumbnailStreams} hvc1NeededStreams={hvc1NeededStreams} needSmartCut={effectiveNeedSmartCut} isEncoding={effectiveIsEncoding} encBitrate={encBitrate} setEncBitrate={setEncBitrate} toggleSettings={toggleSettings} outputPlaybackRate={outputPlaybackRate} lossyMode={lossyMode} neighbouringKeyFrames={neighbouringKeyFrames} findNearestKeyFrameTime={findNearestKeyFrameTime} mergeBoundary={patchCutsClips ? { ...mergeBoundary, ...patchGuardInfo, shortestBlocked: patchCutPolicy.shortestBlocked, repairBlockReason: patchCutPolicy.repairBlockReason, extraRemux: patchCutPolicy.splitNonAvStreams } : undefined} sourceDamaged={patchMode && patchSourceDamaged} sourceFrameTimingDamaged={patchMode && damagedSource.hasDamage} mergedNameEditor={patchMergedNameEditor} cutNameEditor={patchNamesCutResults ? patchCutNameEditor : undefined} reorderNote={patchMode && !playerMode && !mergedMode && patchWork?.effectiveRoot != null && !segmentsToChaptersOnly && !segmentsToChapters && mergeBoundary.tailToSourceEnd ? t('Reordering clips is not always a pure rename. A lossless cut is exclusive at its end: the frame sitting exactly at the cut point is left out. For a clip in the middle that\'s fine, because the next clip starts there and supplies that frame. The last clip in the export order has nothing after it, so it keeps the frame at its cut end and the merged video does not lose it. A swap that changes which clip is last therefore cuts that clip again; the rest are reused or renamed, and the merge is just a fast stream copy. A clip that reaches the end of the source is always extended to the real end, whatever its position in the order, so that extension never causes a re-cut. Your cut points and times are unchanged.') : undefined} namingNote={patchNamesCutResults ? t('A result whose name is already used by a file the app does not own is skipped and reported here; it is not renamed automatically. Two results of this export that would share a name already got the position in the export and the time appended.') : undefined} onOutputDirPress={patchMode && !playerMode ? () => patchWork?.setWorkSettingsVisible(true) : undefined} outputDirNote={patchMode && !playerMode ? t('Cut results are written into the work area. Change the working directory to move them.') : undefined} exportKey={patchMode ? keyBindingByAction['export']?.keys : undefined} />

                <Dialog.Root open={streamsSelectorShown} onOpenChange={setStreamsSelectorShown}>
                  <Dialog.Portal>
                    <Dialog.Overlay />
                    <Dialog.Content style={{ width: '80em' }}>
                      <Dialog.Title>{t('Tracks')}</Dialog.Title>
                      <Dialog.Description>{t('Click to select which tracks to keep when exporting:')}</Dialog.Description>

                      {mainStreams && filePath != null && (
                        <StreamsSelector
                          mainFilePath={filePath}
                          mainFileFormat={mainFileFormat}
                          mainFileChapters={mainFileChapters}
                          allFilesMeta={allFilesMeta}
                          externalFilesMeta={externalFilesMeta}
                          setExternalFilesMeta={setExternalFilesMeta}
                          showAddStreamSourceDialog={showIncludeExternalStreamsDialog}
                          mainFileStreams={mainStreams}
                          isCopyingStreamId={isCopyingStreamId}
                          toggleCopyStreamId={toggleCopyStreamId}
                          setCopyStreamIdsForPath={setCopyStreamIdsForPath}
                          onExtractAllStreamsPress={extractAllStreams}
                          onExtractStreamPress={extractSingleStream}
                          shortestFlag={shortestFlag}
                          setShortestFlag={setShortestFlag}
                          nonCopiedExtraStreams={nonCopiedExtraStreams}
                          paramsByFile={paramsByFile}
                          setParamsByFile={setParamsByFile}
                          updateStreamParams={updateStreamParams}
                          formatTimecode={formatTimecode}
                          loadSubtitleTrackToSegments={loadSubtitleTrackToSegments}
                          toggleCopyStreamIds={toggleCopyStreamIds}
                          changeEnabledStreamsFilter={changeEnabledStreamsFilter}
                          toggleCopyAllStreamsForPath={toggleCopyAllStreamsForPath}
                          onStreamSourceFileDrop={handleStreamSourceFileDrop}
                          outFormat={fileFormat}
                          confirmDialog={confirmDialog}
                        />
                      )}

                      <Dialog.CloseButton />
                    </Dialog.Content>
                  </Dialog.Portal>
                </Dialog.Root>

                <LastCommands visible={lastCommandsVisible} onTogglePress={toggleLastCommands} ffmpegCommandLog={ffmpegCommandLog} setFfmpegCommandLog={setFfmpegCommandLog} />

                <Dialog.Root open={settingsVisible} onOpenChange={toggleSettings}>
                  <Dialog.Portal>
                    <Dialog.Overlay />
                    <Dialog.Content style={{ width: '60em' }}>
                      <Dialog.Title>{t('Settings')}</Dialog.Title>
                      <Dialog.Description>{t('Hover mouse over buttons in the main interface to see which function they have')}</Dialog.Description>

                      <Settings
                        onTunerRequested={onTunerRequested}
                        onKeyboardShortcutsDialogRequested={toggleKeyboardShortcuts}
                        askForCleanupChoices={askForCleanupChoices}
                        toggleStoreProjectInWorkingDir={toggleStoreProjectInWorkingDir}
                        showAdvancedSettings={showAdvancedSettings}
                        setShowAdvancedSettings={setShowAdvancedSettings}
                      />
                      <Dialog.CloseButton />
                    </Dialog.Content>
                  </Dialog.Portal>
                </Dialog.Root>

                <ConcatDialog isShown={batchFiles.length > 0 && concatDialogOpen} onHide={() => setConcatDialogOpen(false)} paths={batchFilePaths} mergedFileTemplate={mergedFileTemplateOrDefault} generateMergedFileNames={generateMergedFileNames} onConcat={userConcatFiles} setAlwaysConcatMultipleFiles={setAlwaysConcatMultipleFiles} alwaysConcatMultipleFiles={alwaysConcatMultipleFiles} fileFormat={fileFormat} setFileFormat={setFileFormat} detectedFileFormat={detectedFileFormat} setDetectedFileFormat={setDetectedFileFormat} onOutputFormatUserChange={onOutputFormatUserChange} />

                {/* patch: the shortcut list shows the keys patch mode actually runs (the remapped
                    `effectiveKeyBindings`), while the add/remove buttons still edit the saved list. */}
                <KeyboardShortcuts isShown={keyboardShortcutsVisible} onHide={() => setKeyboardShortcutsVisible(false)} keyBindings={keyBindings} displayKeyBindings={effectiveKeyBindings} setKeyBindings={setKeyBindings} currentCutSeg={currentCutSeg} resetKeyBindings={resetKeyBindings} getKeyboardAction={getKeyboardAction} patchMode={patchMode} />
                {/* patch: the finish dialog (`Shift+E` / `zm` / `zc`), rendered by the window that runs the job. */}
                {patchFinish.dialogProps != null && (
                  <PatchFinishDialog
                    isShown={patchFinish.dialogProps.isShown}
                    loading={patchFinish.dialogProps.loading}
                    busy={patchFinish.dialogProps.busy}
                    mode={patchFinish.dialogProps.mode}
                    flow={patchFinish.dialogProps.flow}
                    preview={patchFinish.dialogProps.preview}
                    options={patchFinish.dialogProps.options}
                    problems={patchFinish.dialogProps.problems}
                    workDirClear={patchFinish.dialogProps.workDirClear}
                    cutRenamePreview={patchFinish.dialogProps.cutRenamePreview}
                    now={patchFinish.dialogProps.now}
                    failure={patchFinish.dialogProps.failure}
                    error={patchFinish.dialogProps.error}
                    executeKeys={patchFinishExecuteKeys}
                    onClose={patchFinish.dialogProps.onClose}
                    onExecute={patchFinish.dialogProps.onExecute}
                    onOptionsChange={patchFinish.dialogProps.onOptionsChange}
                    onRetry={patchFinish.dialogProps.onRetry}
                  />
                )}
                {/* patch: the discard dialog (`Ctrl+Delete`): moves the source aside, asks about its results. */}
                {patchDiscard.dialog != null && (
                  <DiscardSourceDialog
                    isShown
                    preview={patchDiscard.dialog.preview}
                    results={patchDiscard.dialog.results}
                    showResultsChoice={patchDiscard.dialog.showResultsChoice}
                    hasResults={patchDiscard.dialog.hasResults}
                    busy={patchDiscard.dialog.busy}
                    error={patchDiscard.dialog.error}
                    discardKey={patchDiscard.dialog.discardKey}
                    rememberResults={patchDiscard.dialog.rememberResults}
                    confirmSource={patchDiscard.dialog.dontAskAgain}
                    onResultsChange={patchDiscard.dialog.onResultsChange}
                    onRememberResultsChange={patchDiscard.dialog.onRememberResultsChange}
                    onConfirmSourceChange={patchDiscard.dialog.onConfirmSourceChange}
                    onConfirm={patchDiscard.dialog.onConfirm}
                    onCancel={patchDiscard.dialog.onCancel}
                    onOpenCutResultsFolder={patchDiscard.dialog.onOpenCutResultsFolder}
                    onOpenMergedFolder={patchDiscard.dialog.onOpenMergedFolder}
                  />
                )}

                {/* patch: the known issues of patch mode (`Help` → `Known issues`), the landing page's notes. */}
                {patchMode && !playerMode && !mergedMode && (
                  <PatchKnownIssues keyBindings={effectiveKeyBindings} />
                )}

                {/* patch: the time converter (`Tools → Time convert...`, `opentimeconvert`): written
                    time pairs into the cut list / a project file, and a project file back to text. */}
                {patchMode && !playerMode && !mergedMode && !inspectMode && (
                  <PatchTimeConvertDialog
                    isShown={patchTimeConvert.isShown}
                    onHide={patchTimeConvert.close}
                    filePath={filePath}
                    batchFilePaths={batchFilePaths}
                    maxLabelLength={maxLabelLength}
                    readOnlySource={patchReadOnlySource != null}
                    exportRunning={isPatchExporting()}
                    hasCutSegments={cutSegments.some((seg) => !seg.initial)}
                    onLoadRows={patchTimeConvertLoad}
                  />
                )}

                {/* patch: name the merged file before the cut results are merged (rule + preview). */}
                <MergeNameDialog
                  isShown={patchMergeName.dialogProps.isShown}
                  rule={patchMergeName.dialogProps.rule}
                  setRule={patchMergeName.dialogProps.setRule}
                  defaultRule={patchMergeName.dialogProps.defaultRule}
                  presets={patchMergeName.dialogProps.presets}
                  labelSeparator={patchMergeName.dialogProps.labelSeparator}
                  setLabelSeparator={patchMergeName.dialogProps.setLabelSeparator}
                  loading={patchMergeName.dialogProps.loading}
                  previewFileName={patchMergeName.dialogProps.previewFileName}
                  previewError={patchMergeName.dialogProps.previewError}
                  collisionProne={patchMergeName.dialogProps.collisionProne}
                  overwrite={patchMergeName.dialogProps.overwrite}
                  confirmKeys={patchMergeExecuteKeys}
                  onOverwriteChange={patchMergeName.dialogProps.onOverwriteChange}
                  onClose={patchMergeName.dialogProps.onClose}
                  onConfirm={patchMergeName.dialogProps.onConfirm}
                />

                {/* patch: the player window renames a cut result (label or full file name). */}
                {patchRenameRequest != null && (
                  <PatchRenameDialog
                    kind={patchRenameRequest.kind}
                    defaultValue={patchRenameRequest.defaultValue}
                    onSubmit={onPatchRenameSubmit}
                    onClose={() => setPatchRenameRequest(undefined)}
                  />
                )}

                {/* patch: patch-mode command console + alias editor (base mode renders nothing). */}
                {patchMode && <PatchCommandLayer keyBindingByAction={keyBindingByAction} baseActions={guardedMainActions} />}

                {/* patch: keyboard practice mode (base mode renders nothing). */}
                {patchMode && <KeyboardPracticeLayer keyBindings={effectiveKeyBindings} getKeyboardAction={getKeyboardAction} preview={practicePreview} disabledActions={playerMode ? patchPlayerDisabledActions : undefined} />}

                {/* This should probably be last, so that it's always on top */}
                <AnimatePresence>
                  {/* patch: an export draws the same overlay as base, but from its own run state
                      (`features/patchExportRun`). The shared `working` slot can be overwritten by a
                      read-only operation, and the overlay must not vanish while the cutter runs. */}
                  {patchMode && exportRun?.run?.phase === 'running'
                    ? <Working patchExportOverlay text={t('Exporting')} progress={exportRun.run.progress} onAbortClick={abortWorking} />
                    : working && <Working text={working.text} progress={progress} onAbortClick={abortWorking} />}
                </AnimatePresence>

                <GenericDialog dialog={genericDialog} onOpenChange={(open) => !open && closeGenericDialog()} />

                <WhatsNew />

                <ErrorDialog error={genericError} onOpenChange={(open) => !open && setGenericError(undefined)} />
              </div>

              <SwalContainer darkMode={darkMode} style={baseColorStyle} />
            </UserSettingsContext>
          </SegColorsContext>
        </AppContext>
      </MotionConfig>
    </Theme>
  );
}

export default memo(App);
