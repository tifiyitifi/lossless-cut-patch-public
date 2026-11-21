import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { PatchDirNames, PatchWorkDirs } from '../../../../common/features/patchWork';
import { resolveWorkRootForPath } from '../../../../common/features/patchFinish';
import type { PatchHistoryLockMode } from '../../../../common/features/patchPrivacyLock';
import { clampHistoryLockIdleMinutes, parseHistoryLockMode } from '../../../../common/features/patchPrivacyLock';
import { resolvePatchDirNames, resolvePatchWorkRoot } from '../../../../common/features/patchWork';
import { defaultPatchSettings } from '../../../../common/features/patchData/settings';
import type { PatchDiscardResultsAction } from '../../../../common/features/patchData/settings';
import type { PatchPlaybackRateStepMode } from '../../../../common/features/patchTransport/playbackRate';
import { parsePlaybackRateStepMode } from '../../../../common/features/patchTransport/playbackRate';

import { usePatchPrivacyLock } from '../patchPrivacyLock/PatchPrivacyLockProvider';
import PatchWorkSettingsDialog from './PatchWorkSettingsDialog';
import PatchWorkPathListDialog from './PatchWorkPathListDialog';
import PatchWorkFoldersDialog from './PatchWorkFoldersDialog';
import patchConfig from './patchConfigApi';
import { patchLegacyDialogsEnabled } from './patchLegacyDialogsPolicy';
import { showWorkDirTrashFailureDialog } from './trashFailureDialog';
import { usePatchExportRun } from '../patchExportRun/PatchExportRunProvider';
import getSwal from '../../swal';

const { ipcRenderer } = window.require('electron');
const { patchGetWorkDirs } = window.require('@electron/remote').require('./index.js');

/**
Patch working directory state (fork-owned).

The user can pick one working directory; the app keeps a work area of its own inside it
(`<working directory>/.losslesscut_work`, see `common/features/patchWork`) and writes the cut
results there.

Without a working directory the work area is created next to the source file instead, so patch
mode never writes its results into the source folder itself (base mode keeps doing that).

The provider is mounted by the patch shell, so it exists in both entry modes. Only patch mode
reads it (the upstream seams ask for the work directory explicitly).
*/
export interface PatchWorkContextType {
  /** The configured working directory, `undefined` when none is set. */
  workRoot: string | undefined;
  /** The configured folder names of the work area and the finished sibling. */
  dirNames: PatchDirNames;
  /** Change both folder names (persisted; the names are applied to the next job). */
  setDirNames: (dirNames: PatchDirNames) => void;
  /** The directories of the work area in effect (working directory, else the source folder). */
  workDirs: PatchWorkDirs | undefined;
  /** The root the work area is actually created in, see `resolvePatchWorkRoot`. */
  effectiveRoot: string | undefined;
  /** The source file that is open, so the work area can fall back to its folder. */
  setSourcePath: (sourcePath: string | undefined) => void;
  /** Open a player window with the cut results right after an export. */
  autoOpenPlayer: boolean;
  /** Pause the other results window when one of them starts playing. */
  singleWindowPlayback: boolean;
  /** Reload a results window that never finished loading (see `features/patchPlayer`). */
  reloadResultsWindow: boolean;
  /** Seconds before the segment end that `Shift+Right` stops (both windows). */
  segmentLeadInSeconds: number;
  /** How the speed keys change the rate: base multiplier or fixed 0.1 steps. */
  playbackRateStep: PatchPlaybackRateStepMode;
  /** Ask before a finish job permanently deletes files (see `features/patchFinish`). */
  confirmFinishPermanentDelete: boolean;
  /** Ask before the detached-source check deletes a source for good (see `features/patchDeletable`). */
  confirmDetachedSrcPermanentDelete: boolean;
  /** Ask before `Ctrl+Delete` moves the source to the waiting-for-deletion folder. */
  confirmDiscardSource: boolean;
  /** Ask before the source file list is cleared from its context menu. */
  confirmClearFileList: boolean;
  /** What `Ctrl+Delete` does with the results the source already has. */
  discardResultsAction: PatchDiscardResultsAction;
  setWorkRoot: (workRoot: string | undefined) => void;
  setAutoOpenPlayer: (value: boolean) => void;
  setSingleWindowPlayback: (value: boolean) => void;
  setReloadResultsWindow: (value: boolean) => void;
  setSegmentLeadInSeconds: (value: number) => void;
  setPlaybackRateStep: (value: PatchPlaybackRateStepMode) => void;
  setConfirmFinishPermanentDelete: (value: boolean) => void;
  setConfirmDetachedSrcPermanentDelete: (value: boolean) => void;
  setConfirmDiscardSource: (value: boolean) => void;
  setConfirmClearFileList: (value: boolean) => void;
  setDiscardResultsAction: (value: PatchDiscardResultsAction) => void;
  /** When the work history locks itself (fork-owned; it never unlocks). */
  historyLockMode: PatchHistoryLockMode;
  /** Minutes of idle time before the history locks again, when the mode is `idle`. */
  historyLockIdleMinutes: number;
  setHistoryLockMode: (mode: PatchHistoryLockMode) => void;
  setHistoryLockIdleMinutes: (minutes: number) => void;
  /** Forget the incremental-export manifest (the next export regenerates all results). */
  clearExportManifest: () => Promise<void>;
  /** Move work areas that contain nothing but whitelisted entries to the recycle bin (`cewd`). */
  clearEmptyWorkDirs: () => Promise<void>;
  /** Create the work area if it is missing (called when the working directory changes). */
  ensureWorkDirs: () => Promise<void>;
  /** Is the working directory dialog shown? */
  workSettingsVisible: boolean;
  setWorkSettingsVisible: (visible: boolean) => void;
  toggleWorkSettings: () => void;
  /** Is the list of work folders shown (`open-workpath-list`)? */
  workPathListVisible: boolean;
  setWorkPathListVisible: (visible: boolean) => void;
  toggleWorkPathList: () => void;
}

const PatchWorkContext = createContext<PatchWorkContextType | undefined>(undefined);

export function PatchWorkProvider({ children, enabled = true }: { children: ReactNode, enabled?: boolean }) {
  const exportRun = usePatchExportRun();
  const exporting = exportRun?.isRunning() ?? false;
  const [workRoot, setWorkRootState] = useState<string | undefined>(() => patchConfig.getPatchSetting('workRoot'));
  const [dirNames, setDirNamesState] = useState<PatchDirNames>(() => resolvePatchDirNames({
    workDir: patchConfig.getPatchSetting('workDirName'),
    finishedDir: patchConfig.getPatchSetting('finishedDirName'),
  }));
  const [sourcePath, setSourcePath] = useState<string | undefined>(undefined);
  const [autoOpenPlayer, setAutoOpenPlayerState] = useState<boolean>(() => patchConfig.getPatchSetting('autoOpenPlayer') ?? true);
  const [singleWindowPlayback, setSingleWindowPlaybackState] = useState<boolean>(() => patchConfig.getPatchSetting('singleWindowPlayback') ?? true);
  const [reloadResultsWindow, setReloadResultsWindowState] = useState<boolean>(() => patchConfig.getPatchSetting('reloadResultsWindow') ?? true);
  const [segmentLeadInSeconds, setSegmentLeadInSecondsState] = useState<number>(() => patchConfig.getPatchSetting('segmentLeadInSeconds') ?? defaultPatchSettings.segmentLeadInSeconds);
  const [playbackRateStep, setPlaybackRateStepState] = useState<PatchPlaybackRateStepMode>(() => parsePlaybackRateStepMode(patchConfig.getPatchSetting('playbackRateStep')));
  const [confirmFinishPermanentDelete, setConfirmFinishPermanentDeleteState] = useState<boolean>(() => patchConfig.getPatchSetting('confirmFinishPermanentDelete') ?? true);
  const [confirmDetachedSrcPermanentDelete, setConfirmDetachedSrcPermanentDeleteState] = useState<boolean>(() => patchConfig.getPatchSetting('confirmDetachedSrcPermanentDelete') ?? true);
  const [confirmDiscardSource, setConfirmDiscardSourceState] = useState<boolean>(() => patchConfig.getPatchSetting('confirmDiscardSource') ?? true);
  const [confirmClearFileList, setConfirmClearFileListState] = useState<boolean>(() => patchConfig.getPatchSetting('confirmClearFileList') ?? true);
  const [discardResultsAction, setDiscardResultsActionState] = useState<PatchDiscardResultsAction>(() => patchConfig.getPatchSetting('discardResultsAction') ?? 'ask');
  const [historyLockMode, setHistoryLockModeState] = useState<PatchHistoryLockMode>(() => parseHistoryLockMode(patchConfig.getPatchSetting('historyLockMode')));
  const [historyLockIdleMinutes, setHistoryLockIdleMinutesState] = useState<number>(() => clampHistoryLockIdleMinutes(patchConfig.getPatchSetting('historyLockIdleMinutes')));
  const [workSettingsVisible, setWorkSettingsVisible] = useState(false);
  const [workPathListVisible, setWorkPathListVisible] = useState(false);

  const privacyLock = usePatchPrivacyLock();

  const { t } = useTranslation();

  // patch: the source folder is the work root when no working directory is chosen. A source that
  // already sits inside a work area (a finished source reopened, for instance) belongs to the root
  // above that work area: creating another work area inside it would nest them.
  const effectiveRoot = useMemo(() => (
    sourcePath != null
      ? resolveWorkRootForPath({ path: sourcePath, workRoot, dirNames })
      : resolvePatchWorkRoot({ workRoot, sourceDir: undefined })
  ), [dirNames, sourcePath, workRoot]);

  const workDirs = useMemo(() => (effectiveRoot != null ? (patchGetWorkDirs(effectiveRoot, dirNames)) : undefined), [dirNames, effectiveRoot]);

  /**
  The work root the work-folders dialog may show while the privacy lock is engaged.

  The lock hides the history, not the video the user is working on: the root of the open video
  stays visible (and its results are read). With no video open there is no current root, so the
  dialog only shows the locked line. The main process drops the history for the same reason; this
  value only decides whether a `fallbackRoot` is sent at all.
  */
  const historyLocked = privacyLock?.status.enabled === true && !privacyLock.status.unlocked;
  /** Until the main process answered, do not send a root for a dialog with no open video. */
  const historyLockUnknown = privacyLock != null && privacyLock.loading;
  const visibleRoot = (historyLocked || historyLockUnknown) && sourcePath == null ? undefined : effectiveRoot;

  const ensureWorkDirs = useCallback(async () => {
    // patch: base mode must not write anything into the source folder. The provider is mounted by
    // the shared shell in both entry modes, so it has to be told which one is active.
    if (!enabled || effectiveRoot == null) return;
    try {
      await window.electron.patchEnsureWorkDirs(effectiveRoot);
    } catch (err) {
      console.error('Failed to create the work area', err);
    }
  }, [enabled, effectiveRoot]);

  const setWorkRoot = useCallback((newWorkRoot: string | undefined) => {
    setWorkRootState(newWorkRoot);
    patchConfig.setPatchSetting('workRoot', newWorkRoot);
  }, []);

  const setDirNames = useCallback((next: PatchDirNames) => {
    const safe = resolvePatchDirNames(next);
    setDirNamesState(safe);
    patchConfig.setPatchSetting('workDirName', safe.workDir);
    patchConfig.setPatchSetting('finishedDirName', safe.finishedDir);
  }, []);

  const setAutoOpenPlayer = useCallback((value: boolean) => {
    setAutoOpenPlayerState(value);
    patchConfig.setPatchSetting('autoOpenPlayer', value);
  }, []);

  const setSingleWindowPlayback = useCallback((value: boolean) => {
    setSingleWindowPlaybackState(value);
    patchConfig.setPatchSetting('singleWindowPlayback', value);
  }, []);

  const setReloadResultsWindow = useCallback((value: boolean) => {
    setReloadResultsWindowState(value);
    patchConfig.setPatchSetting('reloadResultsWindow', value);
  }, []);

  const setSegmentLeadInSeconds = useCallback((value: number) => {
    setSegmentLeadInSecondsState(value);
    patchConfig.setPatchSetting('segmentLeadInSeconds', value);
  }, []);

  const setPlaybackRateStep = useCallback((value: PatchPlaybackRateStepMode) => {
    setPlaybackRateStepState(value);
    patchConfig.setPatchSetting('playbackRateStep', value);
  }, []);

  const setConfirmFinishPermanentDelete = useCallback((value: boolean) => {
    setConfirmFinishPermanentDeleteState(value);
    patchConfig.setPatchSetting('confirmFinishPermanentDelete', value);
  }, []);

  const setConfirmDetachedSrcPermanentDelete = useCallback((value: boolean) => {
    setConfirmDetachedSrcPermanentDeleteState(value);
    patchConfig.setPatchSetting('confirmDetachedSrcPermanentDelete', value);
  }, []);

  const setConfirmDiscardSource = useCallback((value: boolean) => {
    setConfirmDiscardSourceState(value);
    patchConfig.setPatchSetting('confirmDiscardSource', value);
  }, []);

  const setConfirmClearFileList = useCallback((value: boolean) => {
    setConfirmClearFileListState(value);
    patchConfig.setPatchSetting('confirmClearFileList', value);
  }, []);

  const setDiscardResultsAction = useCallback((value: PatchDiscardResultsAction) => {
    setDiscardResultsActionState(value);
    patchConfig.setPatchSetting('discardResultsAction', value);
  }, []);

  const setHistoryLockMode = useCallback((value: PatchHistoryLockMode) => {
    const safe = parseHistoryLockMode(value);
    setHistoryLockModeState(safe);
    patchConfig.setPatchSetting('historyLockMode', safe);
  }, []);

  const setHistoryLockIdleMinutes = useCallback((value: number) => {
    const safe = clampHistoryLockIdleMinutes(value);
    setHistoryLockIdleMinutesState(safe);
    patchConfig.setPatchSetting('historyLockIdleMinutes', safe);
  }, []);

  const clearExportManifest = useCallback(async () => {
    if (effectiveRoot == null) return;
    // patch: the export and the finish job write this manifest for the whole run. Clearing it in the
    // middle of one would delete the records it is writing, so the cleanup waits like they do.
    const lock = await window.electron.patchAcquireWorkLock({ workRoot: effectiveRoot, owner: 'cleanup' });
    if (!lock.ok) {
      getSwal().toast.fire({
        icon: 'info',
        text: lock.reason === 'busy'
          ? t('Another window is using this work folder. Wait for its export to finish.')
          : lock.message,
      });
      return;
    }
    try {
      await window.electron.patchClearExportManifest(effectiveRoot);
    } finally {
      await window.electron.patchReleaseWorkLock({ workRoot: effectiveRoot, owner: 'cleanup' })
        .catch((err: unknown) => { console.error('Failed to release the work-area lock', err); });
    }
  }, [effectiveRoot, t]);

  /**
  `cewd`: move every whitelisted empty work folder to the recycle bin.

  The cleanup deletes no file: a folder with anything the user made (even an empty
  `.txt`) is kept, and a refused recycle bin leaves the folder untouched. The window below is
  only a report plus a shortcut to the folder; the user can finish the cleanup by hand. Kept
  folders are counted in the toast, so "no empty work folders" only means there really were none.
  */
  const clearEmptyWorkDirs = useCallback(async () => {
    try {
      const result = await window.electron.patchClearEmptyWorkDirs();
      if (result.failed.length > 0) {
        await showWorkDirTrashFailureDialog({ t, failures: result.failed, clearedCount: result.cleared.length });
        return;
      }
      if (result.cleared.length === 0) {
        // A folder that still holds anything (even an empty file the user made) is kept by the
        // whitelist: "no empty work folders" would hide that the command did look at them.
        getSwal().toast.fire({
          icon: 'info',
          text: result.kept.length > 0
            ? t('{{kept}} work folder(s) still contain files and were left alone.', { kept: result.kept.length })
            : t('No empty work folders were found.'),
        });
        return;
      }
      if (result.kept.length > 0) {
        getSwal().toast.fire({
          icon: 'success',
          text: t('Moved {{cleared}} empty work folder(s) to the recycle bin. {{kept}} work folder(s) still contain files and were left alone.', { cleared: result.cleared.length, kept: result.kept.length }),
        });
        return;
      }
      getSwal().toast.fire({
        icon: 'success',
        text: t('Moved {{count}} empty work folder(s) to the recycle bin. Nothing else was touched.', { count: result.cleared.length }),
      });
    } catch (err) {
      console.error('Failed to clear empty work folders', err);
      getSwal().toast.fire({ icon: 'warning', text: t('The empty work folders could not be checked.') });
    }
  }, [t]);

  // The work area of every root is kept, so pointing at a new working directory (or opening a file
  // in another folder without one) just creates the next work area. Only patch mode creates it:
  // base mode keeps the source folder untouched.
  useEffect(() => {
    if (!enabled) return;
    ensureWorkDirs();
    // `dirNames` is not read here: the main process looks the configured names up itself. It is a
    // dependency so that a new name creates its work area instead of waiting for the next restart.
  }, [dirNames, enabled, ensureWorkDirs]);

  const toggleWorkSettings = useCallback(() => setWorkSettingsVisible((visible) => !visible), []);
  const toggleWorkPathList = useCallback(() => setWorkPathListVisible((visible) => !visible), []);

  // The app menu ("Mode -> Working directory...") opens the same dialog.
  useEffect(() => {
    const onToggleWorkSettings = () => toggleWorkSettings();
    ipcRenderer.on('togglePatchWorkSettings', onToggleWorkSettings);
    return () => { ipcRenderer.off('togglePatchWorkSettings', onToggleWorkSettings); };
  }, [toggleWorkSettings]);

  // The app menu ("File -> Work folders and results...") opens the list dialog, and so does the
  // context menu of every patch window (the channel the old standalone results overview used).
  useEffect(() => {
    const onOpenWorkPathList = () => setWorkPathListVisible(true);
    ipcRenderer.on('openPatchWorkPathList', onOpenWorkPathList);
    return () => { ipcRenderer.off('openPatchWorkPathList', onOpenWorkPathList); };
  }, []);

  useEffect(() => {
    const onOpenResultsOverview = () => setWorkPathListVisible(true);
    ipcRenderer.on('openPatchResultsOverview', onOpenResultsOverview);
    return () => { ipcRenderer.off('openPatchResultsOverview', onOpenResultsOverview); };
  }, []);

  const value = useMemo<PatchWorkContextType>(() => ({
    workRoot,
    dirNames,
    workDirs,
    effectiveRoot,
    setSourcePath,
    autoOpenPlayer,
    singleWindowPlayback,
    reloadResultsWindow,
    segmentLeadInSeconds,
    playbackRateStep,
    confirmFinishPermanentDelete,
    confirmDetachedSrcPermanentDelete,
    confirmDiscardSource,
    confirmClearFileList,
    discardResultsAction,
    setWorkRoot,
    setDirNames,
    setAutoOpenPlayer,
    setSingleWindowPlayback,
    setReloadResultsWindow,
    setSegmentLeadInSeconds,
    setPlaybackRateStep,
    setConfirmFinishPermanentDelete,
    setConfirmDetachedSrcPermanentDelete,
    setConfirmDiscardSource,
    setConfirmClearFileList,
    setDiscardResultsAction,
    historyLockMode,
    historyLockIdleMinutes,
    setHistoryLockMode,
    setHistoryLockIdleMinutes,
    clearExportManifest,
    clearEmptyWorkDirs,
    ensureWorkDirs,
    workSettingsVisible,
    setWorkSettingsVisible,
    toggleWorkSettings,
    workPathListVisible,
    setWorkPathListVisible,
    toggleWorkPathList,
  }), [autoOpenPlayer, clearEmptyWorkDirs, clearExportManifest, confirmClearFileList, confirmDetachedSrcPermanentDelete, confirmDiscardSource, confirmFinishPermanentDelete, discardResultsAction, dirNames, effectiveRoot, ensureWorkDirs, historyLockIdleMinutes, historyLockMode, playbackRateStep, reloadResultsWindow, segmentLeadInSeconds, setAutoOpenPlayer, setConfirmClearFileList, setConfirmDetachedSrcPermanentDelete, setConfirmDiscardSource, setConfirmFinishPermanentDelete, setDirNames, setDiscardResultsAction, setHistoryLockIdleMinutes, setHistoryLockMode, setPlaybackRateStep, setReloadResultsWindow, setSegmentLeadInSeconds, setSingleWindowPlayback, setWorkRoot, toggleWorkSettings, toggleWorkPathList, workDirs, workRoot, workSettingsVisible, workPathListVisible, singleWindowPlayback]);

  return (
    <PatchWorkContext.Provider value={value}>
      {children}
      {/* patch: the combined work folders + results dialog. The two pre-merge dialogs are frozen;
          see `patchLegacyDialogsPolicy`. The settings gear closes this dialog before the settings
          opens: two Radix modals stacked on each other fight over the focus trap. */}
      {workPathListVisible && (patchLegacyDialogsEnabled
        ? <PatchWorkPathListDialog defaultRoot={visibleRoot} workDirName={dirNames.workDir} onHide={() => setWorkPathListVisible(false)} />
        : (
          <PatchWorkFoldersDialog
            key={historyLocked ? 'history-locked' : 'history-unlocked'}
            defaultRoot={visibleRoot}
            workDirName={dirNames.workDir}
            onHide={() => setWorkPathListVisible(false)}
            onOpenSettings={() => {
              setWorkPathListVisible(false);
              setWorkSettingsVisible(true);
            }}
            keysSuspended={workSettingsVisible}
          />
        ))}
      <PatchWorkSettingsDialog
        key={workSettingsVisible ? 'settings-shown' : 'settings-hidden'}
        isShown={workSettingsVisible}
        onHide={() => setWorkSettingsVisible(false)}
        workRoot={workRoot}
        workDirs={workDirs}
        dirNames={dirNames}
        exporting={exporting}
        autoOpenPlayer={autoOpenPlayer}
        singleWindowPlayback={singleWindowPlayback}
        reloadResultsWindow={reloadResultsWindow}
        segmentLeadInSeconds={segmentLeadInSeconds}
        playbackRateStep={playbackRateStep}
        confirmFinishPermanentDelete={confirmFinishPermanentDelete}
        confirmDetachedSrcPermanentDelete={confirmDetachedSrcPermanentDelete}
        confirmDiscardSource={confirmDiscardSource}
        confirmClearFileList={confirmClearFileList}
        discardResultsAction={discardResultsAction}
        historyLockMode={historyLockMode}
        historyLockIdleMinutes={historyLockIdleMinutes}
        setWorkRoot={setWorkRoot}
        setDirNames={setDirNames}
        setAutoOpenPlayer={setAutoOpenPlayer}
        setSingleWindowPlayback={setSingleWindowPlayback}
        setReloadResultsWindow={setReloadResultsWindow}
        setSegmentLeadInSeconds={setSegmentLeadInSeconds}
        setPlaybackRateStep={setPlaybackRateStep}
        setConfirmFinishPermanentDelete={setConfirmFinishPermanentDelete}
        setConfirmDetachedSrcPermanentDelete={setConfirmDetachedSrcPermanentDelete}
        setConfirmDiscardSource={setConfirmDiscardSource}
        setConfirmClearFileList={setConfirmClearFileList}
        setDiscardResultsAction={setDiscardResultsAction}
        setHistoryLockMode={setHistoryLockMode}
        setHistoryLockIdleMinutes={setHistoryLockIdleMinutes}
        clearExportManifest={clearExportManifest}
      />
    </PatchWorkContext.Provider>
  );
}

/**
The patch working directory. Returns `undefined` outside the patch shell (base mode), which is
what the upstream seams check before touching any patch behavior.
*/
export function usePatchWork() {
  return useContext(PatchWorkContext);
}
