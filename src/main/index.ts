process.traceDeprecation = true;
process.traceProcessWarnings = true;

/* eslint-disable import/first */
// eslint-disable-next-line import-js/no-extraneous-dependencies
import electron, { BrowserWindow, nativeTheme, shell, app, ipcMain, Notification, powerMonitor } from 'electron';
import type { BrowserWindowConstructorOptions, NotificationConstructorOptions } from 'electron';
import i18n, { t } from 'i18next';
// eslint-disable-next-line import-js/no-extraneous-dependencies
import debounce from 'lodash/debounce.js';
import yargsParser from 'yargs-parser';
import JSON5 from 'json5';
import remote from '@electron/remote/main/index.js';
import { readFile, rename, stat, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import assert from 'node:assert';
import timers from 'node:timers/promises';
import { z } from 'zod';
import { fileURLToPath, pathToFileURL } from 'node:url';
import electronUnhandled from 'electron-unhandled';
import { fileTypeFromFile } from 'file-type';
import type { Asyncify } from 'type-fest';
// eslint-disable-next-line import-js/no-extraneous-dependencies
import { downloadChromeExtension } from 'electron-devtools-installer/dist/downloadChromeExtension.js';
import mitt from 'mitt';

import logger from './logger.js';
import menu from './menu.js';
import * as configStore from './configStore.js';
import { getBackgroundColor } from './theme.js';
import { isLinux, isWindows, isMac, platform, arch, pathExists, resolveCliFileArgs, parseCliKeyboardActionArgs, parseSettingsJson } from './util.js';
import { appName } from './common.js';
import attachContextMenu from './contextMenu.js';
import HttpServer from './httpServer.js';
import isDev from './isDev.js';
import isStoreBuild from './isStoreBuild.js';
import { getAboutPanelOptions } from './aboutPanel.js';
import { checkNewVersion } from './updateChecker.js';
import { reportPreviousUpdate, runUpdateCheck } from './features/updater/flow.js';
import type { UpdateFlowEnvironment } from './features/updater/flow.js';
import type { UpdatePrompt, UpdateTranslate } from './features/updater/prompt.js';
import { patchFlushBeforeUpdateChannel, patchFlushBeforeUpdateDoneChannel } from '../common/features/updater/ipc.js';
import * as i18nCommon from './i18nCommon.js';
import './i18n.js';
import type { ApiActionRequest, Config } from '../common/types.js';
import * as ffmpeg from './ffmpeg.js';
import * as compatPlayer from './compatPlayer.js';
import { downloadMediaUrl } from './ffmpeg.js';
import { hasDisabledNetworking, setDisableNetworking } from './networking.js';
import * as patchConfig from './features/patch/patchConfig.js';
import { listVideoFiles } from './features/patch/videoFiles.js';
import { patchReadBatchDurations } from './features/batchSort/index.js';
import { createPatchPostProcessSource } from './features/patch/postProcess.js';
import { ensurePatchWorkDirs, getPatchFinishDirs, getPatchWorkDirs } from './features/patchWork/workDirs.js';
import getConfiguredPatchDirNames from './features/patchWork/dirNames.js';
import { clearEmptyWorkDirs, scanPatchWorkDirEntries } from './features/patchWork/emptyWorkDirs.js';
import { acquirePatchWorkLock, patchWorkLockHolderIdForWebContents, releaseAllPatchWorkLocks, releasePatchWorkLock, releasePatchWorkLocksForHolder, removeStalePatchWorkLock } from './features/patchWork/exportLock.js';
import { claimPatchSource, patchSourceClaimsDirName, releasePatchSourceClaims, sweepStalePatchSourceClaims } from './features/patchSourceClaim/sourceClaim.js';
import { claimPatchResultFile, findResultFilesClaimedElsewhere, patchResultClaimsDirName, releaseAllPatchResultClaims, releasePatchResultClaims, sweepStalePatchResultClaims } from './features/patchPlayer/resultClaims.js';
import type { PatchResultKind } from './features/patchPlayer/resultClaims.js';
import { initPatchWindowPaths, isPatchPathOpenInAnyWindow } from './features/patchWork/windowPaths.js';
import { initPatchPlayerWindow, getPatchResultsWindowKindBySender, maybeOpenPatchPlayerWindow, openPatchMergedWindow, openPatchPlayerWindow, closePatchClipsWindow, closePatchMergedWindow, closePatchInspectWindow, isPatchClipsWindowOpen, isPatchInspectWindowOpen, isPatchMergedWindowOpen, linkPatchResultsWindowsToMain, openPatchInspectWindow, pausePatchResultsWindows, resendPatchResultsPlaylists, setPatchResultsWindowsBackgroundColor, unloadPatchInspectWindow, unloadPatchMergedWindow, unloadPatchPlayerWindow, updateResultsWindowPlaylistPaths } from './features/patchPlayer/playerWindow.js';
// patch: the detached-source check (fork-owned) - the panel, the delete and the deep decode check.
import { deletePatchDetachedSources } from './features/patchDeletable/delete.js';
import { runPatchDeepCheck } from './features/patchDeletable/deepCheck.js';
import { runFfmpegDecodeCheck } from './features/patchDeletable/runDeepCheck.js';
import { buildPatchDetachableReport, parsePatchDetachExtraDeletableReasons } from '../common/features/patchDeletable/index.js';
import { closePatchDetachableWindow, initPatchDetachableWindow, isPatchDetachableWindowOpen, onPatchDetachableWindowClosed, openPatchDetachableWindow, sendPatchDetachableDeepCheck, setPatchDetachableWindowBackgroundColor } from './features/patchDeletable/window.js';
import type { PatchCutResultEntry } from '../common/features/patchPlayer/playerMode.js';
import { planPlaybackPause } from '../common/features/patchPlayer/playback.js';
import type { PatchMergedChapter } from '../common/features/patchMerged/mergedChapters.js';
import { patchPlayerPlaybackChannel, patchSourcePauseChannel, patchSourcePlaybackChannel } from '../common/features/patchPlayer/playerMode.js';
import { clearPatchExportManifest, readPatchExportManifest, removePatchExportManifestSourceRecord, updatePatchExportManifest, updatePatchExportManifestAfterFinish, updatePatchExportManifestResultPath } from './features/patchExport/manifest.js';
import { renameResultLocked, resolveRenameWorkRoot } from './features/patchExport/renameResult.js';
import { listFfmpegEncoders } from './features/patchExport/ffmpegEncoders.js';
import { buildPatchFinishPreview } from './features/patchFinish/preview.js';
import { createPatchFinishDeps, executePatchFinish } from './features/patchFinish/execute.js';
import { getPatchInstallDir, resolvePatchProjectStores, canWriteDir } from './features/patchFinish/projectStores.js';
import { getPatchWorkHistory, recordPatchWorkRoot } from './features/patchFinish/workHistory.js';
import { listPatchWorkRoots } from './features/patchFinish/workRoots.js';
import { createPatchOverviewCache } from './features/patchResultsOverview/cache.js';
import { buildPatchResultsOverview } from './features/patchResultsOverview/scan.js';
import { readPatchFinishLedger, recordPatchFinishLedgerEntry, renamePatchFinishLedgerEntry } from './features/patchResultsOverview/ledgerStore.js';
import { readPatchSourceFingerprint } from './features/patchResultsOverview/fingerprint.js';
// patch: a downloaded source can have a damaged head GOP (features/patchSourceHealth).
import { scanPatchSourceHealth } from './features/patchSourceHealth/scan.js';
// patch: some sources are stored so that the built-in player cannot show them correctly
// (features/damagedSource).
import { probeSourceDamage } from './features/damagedSource/probe.js';
import { claimSourceDamageAsk, setSourceDamagePlaybackOverride } from './features/damagedSource/askState.js';
import { setSourceRepairMenuState } from './features/damagedSource/repairMenu.js';
import type { SourceRepairMenuState } from '../common/features/damagedSource/index.js';
import { getFinishTouchedPaths, getMergedResultFolderCandidates, leavesCutResultsInWorkArea, parsePatchFinishCutOptions, parsePatchFinishDiscardOptions, parsePatchFinishMergeOptions, patchFinishBusyMarker, patchFinishDialogRequestChannel, resolveWorkRootForPath } from '../common/features/patchFinish/index.js';
import type { PatchFinishDialogRequest, PatchFinishJobParams, PatchFinishPreviewParams, PatchFinishReport } from '../common/features/patchFinish/index.js';
import { findManifestFileKey } from '../common/features/patchExport/index.js';
import type { PatchExportRecordPatch } from '../common/features/patchExport/index.js';
import { buildFinishLedgerEntry } from '../common/features/patchResultsOverview/index.js';
import { stopFfmpegChildrenReading } from './ffmpegChildren.js';
import { createPatchHistoryLockService } from './features/patchPrivacyLock/service.js';
import type { PatchHistoryLockService } from './features/patchPrivacyLock/service.js';
import { resolvePatchHistoryLockPath } from './features/patchPrivacyLock/passwordFile.js';
import {
  clampHistoryLockIdleMinutes,
  parseHistoryLockEvents,
  parseHistoryLockMode,
  patchPrivacyLockChangedChannel,
} from '../common/features/patchPrivacyLock/index.js';

/**
The extra kinds the deletion check may delete (fork-owned).

Both the report the panel shows and the fresh report the delete re-checks read the setting through
this one helper, so the two can never disagree about which sources are deletable.
*/
function getPatchDetachExtraDeletableReasons() {
  return parsePatchDetachExtraDeletableReasons(patchConfig.getPatchSetting('detachExtraDeletableReasons'));
}


electronUnhandled({ showDialog: true, logger: (err) => logger.error('electron-unhandled', err) });

// https://chromestatus.com/feature/5748496434987008
// https://peter.sh/experiments/chromium-command-line-switches/
// https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/runtime_enabled_features.json5
app.commandLine.appendSwitch('enable-blink-features', 'AudioVideoTracks');
// OS media keys / media session don't work properly with our player (play only a single frame), so disable them https://github.com/mifi/lossless-cut/issues/3028
// appendSwitch replaces any existing value, e.g. one passed on the command line, so keep it
app.commandLine.appendSwitch('disable-features', [app.commandLine.getSwitchValue('disable-features'), 'HardwareMediaKeyHandling', 'MediaSessionService'].filter(Boolean).join(','));

// patch: the renderer loads its modules from the Vite dev server over HTTP, so Chromium's HTTP disk
// cache sits between them. A cache that fails to write its index (the `net\disk_cache` errors in the
// log) then serves byte ranges of other entries as a module body, and the whole renderer fails to
// parse ("Uncaught SyntaxError: Unexpected identifier '<sourcemap base64>'"), leaving a blank
// window - the cutting window or a results window. Dev never needs that cache.
if (isDev) app.commandLine.appendSwitch('disable-http-cache');

remote.initialize();


app.name = appName;

if (isWindows) {
  // in order to set the title on OS notifications on Windows, this needs to be set to app.name
  // https://github.com/mifi/lossless-cut/pull/2139
  // https://stackoverflow.com/a/65863174/6519037
  app.setAppUserModelId(app.name);
}

let filesToOpen: string[] = [];

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow: BrowserWindow | null;

let askBeforeClose = false;
let rendererReady = false;
let newVersion: string | undefined;
// Set while the app is closing itself to install an update: the ordinary close confirmation would
// otherwise stop the quit after the user already confirmed it in the update dialog.
let quittingForUpdate = false;

// patch: one finish job at a time (features/patchFinish). Two requests would move and delete the
// same files: the dialog disables its button, but a retried RPC or another window must not slip in.
let patchFinishJobRunning = false;

const openFiles = (paths: string[]) => mainWindow!.webContents.send('openFiles', paths);

let apiActionRequestsId = 0;
const apiActionRequests = new Map<number, () => void>();

// Not using installExtension from electron-devtools-installer because it calls deprecated Electron session APIs
async function installReactDevTools() {
  const id = 'fmkadmapgofadopljbjfkapdkoienihi';
  let extensionFolder = await downloadChromeExtension(id);
  // The downloaded copy is cached forever, so replace it if it's an old Manifest V2 build
  const { manifest_version: manifestVersion } = JSON.parse(await readFile(join(extensionFolder, 'manifest.json'), 'utf8'));
  if (manifestVersion < 3) extensionFolder = await downloadChromeExtension(id, { forceDownload: true });
  return electron.session.defaultSession.extensions.loadExtension(extensionFolder);
}

async function sendApiAction(action: string, args?: unknown[]) {
  try {
    const id = apiActionRequestsId;
    apiActionRequestsId += 1;
    mainWindow!.webContents.send('apiAction', { id, action, args } satisfies ApiActionRequest);
    await new Promise<void>((resolve) => { apiActionRequests.set(id, resolve); });
  } catch (err) {
    logger.error('sendApiAction', err);
  }
}

export type AppEvent = {
  eventName: 'export-complete',
  paths?: string[],
  /** patch: the cut results with their labels and name contexts (see features/patchPlayer). */
  entries?: PatchCutResultEntry[],
} | {
  eventName: 'export-start',
  path: string,
} | {
  /** patch: a merge starts writing a merged result; the merged-result window must let go of it. */
  eventName: 'merge-start',
};

const appEventEmitter = mitt<{ appEvent: AppEvent }>();

// patch: the deep decode checks the check panel asked for, by lower-cased path (fork-owned). One at a
// time per file; a closing panel or a delete aborts them.
const patchDeepChecks = new Map<string, AbortController>();

ipcMain.on('appEvent', (_e, appEvent: AppEvent) => {
  appEventEmitter.emit('appEvent', appEvent);
  // patch: in patch mode the cut results are reviewed in the player window (features/patchPlayer).
  switch (appEvent.eventName) {
    case 'export-complete': {
      // patch: the player opens at the cutting window's size (features/patchPlayer).
      maybeOpenPatchPlayerWindow(
        appEvent.entries ?? appEvent.paths?.map((path) => ({ path })),
        mainWindow != null && !mainWindow.isDestroyed() ? mainWindow.getBounds() : undefined,
      );
      break;
    }
    case 'export-start': {
      // The export renames/regenerates result files, which Windows forbids while the player has them
      // open. The player releases its video but keeps the window (it reloads on the next playlist).
      unloadPatchPlayerWindow();
      // patch: the check player may show a file the export overwrites (it plays sources and results).
      unloadPatchInspectWindow();
      break;
    }
    case 'merge-start': {
      // Same file lock: the merged-result window may be playing the file the merge is about to rewrite.
      unloadPatchMergedWindow();
      break;
    }
    default: {
      break;
    }
  }
});

// patch: the cut results are played in their own window, so the source in the cutting window would
// keep playing at the same time. A results window announces that it started playing a result, and
// the cutting window pauses its source. When `singleWindowPlayback` is on (the default), the other
// results window pauses too, so only one of the three windows plays at a time.
ipcMain.on(patchPlayerPlaybackChannel, (event) => {
  const source = getPatchResultsWindowKindBySender(event.sender);
  if (source == null) return;
  const plan = planPlaybackPause({ source, singleWindowPlayback: patchConfig.getPatchSetting('singleWindowPlayback') });
  if (plan.pauseSource && mainWindow != null && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(patchSourcePauseChannel);
  }
  pausePatchResultsWindows(plan.pauseResults);
});

// patch: the other direction - the cutting window started playing the source, so the results
// windows pause their result. Otherwise both windows would play audio at the same time.
ipcMain.on(patchSourcePlaybackChannel, (event) => {
  if (mainWindow == null || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return;
  const plan = planPlaybackPause({ source: 'source', singleWindowPlayback: patchConfig.getPatchSetting('singleWindowPlayback') });
  pausePatchResultsWindows(plan.pauseResults);
});

async function onAwaitAppEvent(awaitEventName: string, signal: AbortSignal) {
  return new Promise<AppEvent>((resolve, reject) => {
    const handler = (appEvent: AppEvent) => {
      if (appEvent.eventName === awaitEventName) {
        appEventEmitter.off('appEvent', handler);
        resolve(appEvent);
      }
    };
    appEventEmitter.on('appEvent', handler);
    signal.addEventListener('abort', () => {
      appEventEmitter.off('appEvent', handler);
      reject(new Error('Aborted'));
    });
  });
}

// https://github.com/electron/electron/issues/526#issuecomment-563010533
function getSavedBounds() {
  const bounds = configStore.get('windowBounds');
  const options: BrowserWindowConstructorOptions = {};
  if (bounds) {
    const area = electron.screen.getDisplayMatching(bounds).workArea;
    // If the saved position still valid (the window is entirely inside the display area), use it.
    if (
      bounds.x >= area.x
      && bounds.y >= area.y
      && bounds.x + bounds.width <= area.x + area.width
      && bounds.y + bounds.height <= area.y + area.height
    ) {
      options.x = bounds.x;
      options.y = bounds.y;
    }
    // If the saved size is still valid, use it.
    if (bounds.width <= area.width || bounds.height <= area.height) {
      options.width = bounds.width;
      options.height = bounds.height;
    }
  }
  return {
    options,
    isMaximized: bounds != null ? bounds.isMaximized : false,
  };
}

function createWindow() {
  const savedBounds = getSavedBounds();

  mainWindow = new BrowserWindow({
    ...savedBounds.options,
    darkTheme: true,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      // https://github.com/electron/electron/issues/5107
      webSecurity: !isDev,
      preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
    },
    backgroundColor: getBackgroundColor(),
    minWidth: 300,
    minHeight: 300,
  });

  if (savedBounds.isMaximized) mainWindow.maximize();

  remote.enable(mainWindow.webContents);

  attachContextMenu(mainWindow);

  if (isDev) mainWindow.loadURL('http://localhost:3001');
  // Need to useloadFile for special characters https://github.com/mifi/lossless-cut/issues/40
  else mainWindow.loadFile('out/renderer/index.html');

  // Open the DevTools.
  // mainWindow.webContents.openDevTools()

  // Emitted when the window is closed.
  // patch: the results windows and the check panel belong to the cutting window, so they close with it.
  linkPatchResultsWindowsToMain(mainWindow);
  mainWindow.on('closed', () => {
    // patch: the detached-source check panel is a window of this one as well.
    closePatchDetachableWindow();
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null;
  });

  // https://stackoverflow.com/questions/39574636/prompt-to-save-quit-before-closing-window/47434365
  mainWindow.on('close', (e) => {
    // patch: a quit the updater started is already confirmed in the update dialog; asking again
    // would cancel the hand-over the user agreed to.
    if (!askBeforeClose || quittingForUpdate) return;

    assert.ok(mainWindow);
    const choice = electron.dialog.showMessageBoxSync(mainWindow, {
      type: 'question',
      buttons: ['Yes', 'No'],
      title: i18n.t('Confirm quit'),
      message: i18n.t('Are you sure you want to quit?'),
    });
    if (choice === 1) {
      e.preventDefault();
    }
  });

  // TODO replace with `windowStatePersistence` in the future? https://github.com/electron/rfcs/pull/16
  const debouncedSaveWindowState = debounce(() => {
    if (!mainWindow || !configStore.get('storeWindowBounds')) return;
    const { x, y, width, height } = mainWindow.getNormalBounds();
    const isMaximized = mainWindow.isMaximized();
    configStore.set('windowBounds', { x, y, width, height, isMaximized });
  }, 500);

  mainWindow.on('maximize', debouncedSaveWindowState);
  mainWindow.on('unmaximize', debouncedSaveWindowState);
  mainWindow.on('resize', debouncedSaveWindowState);
  mainWindow.on('move', debouncedSaveWindowState);
}

async function openExternal(url: string) {
  if (hasDisabledNetworking()) {
    logger.warn('openExternal blocked because networking is disabled', url);
    return;
  }
  await shell.openExternal(url);
}

/** Shows one update dialog and returns the index of the button the user chose. */
async function showUpdatePrompt(prompt: UpdatePrompt) {
  if (mainWindow == null) return prompt.buttons.length - 1;
  const { response } = await electron.dialog.showMessageBox(mainWindow, {
    type: prompt.type,
    title: prompt.title,
    message: prompt.message,
    ...(prompt.detail != null && { detail: prompt.detail }),
    buttons: prompt.buttons,
    defaultId: 0,
    cancelId: prompt.buttons.length - 1,
  });
  return response;
}

// patch: the updater asks the renderer for a last save before it closes the app to replace the
// files (features/updater + the `patchFlushBeforeUpdate*` channels). The timeout keeps a hung window
// from blocking the update forever; it resolves `false`, which refuses the update instead of
// closing on unsaved work.
let pendingUpdateFlush: ((saved: boolean) => void) | undefined;

function flushRendererBeforeUpdate(): Promise<boolean> {
  if (mainWindow == null) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (saved: boolean) => {
      if (settled) return;
      settled = true;
      pendingUpdateFlush = undefined;
      resolve(saved);
    };
    pendingUpdateFlush = finish;
    mainWindow!.webContents.send(patchFlushBeforeUpdateChannel);
    setTimeout(() => finish(false), 15_000);
  });
}

function buildUpdateEnvironment(): UpdateFlowEnvironment {
  const exePath = app.getPath('exe');
  const feedOverride = process.env['LLC_UPDATE_RELEASE_URL'];
  if (feedOverride != null && feedOverride !== '') {
    logger.warn('Using the LLC_UPDATE_RELEASE_URL override for update checks', feedOverride);
  }

  return {
    currentVersion: app.getVersion(),
    userDataDir: app.getPath('userData'),
    installDir: getPatchInstallDir({
      portableDir: process.env['PORTABLE_EXECUTABLE_DIR'],
      exePath,
    }),
    // Packaged: `build.extraFiles` puts the updater next to the executable (and thus in the zip).
    shippedScriptPath: isDev
      ? join(app.getAppPath(), 'script', 'win', 'patch_update.ps1')
      : join(dirname(exePath), 'patch_update.ps1'),
    isPackaged: app.isPackaged,
    windowsStore: Boolean(process.windowsStore),
    networkingDisabled: hasDisabledNetworking(),
    t: t as unknown as UpdateTranslate,
    showPrompt: (prompt) => showUpdatePrompt(prompt),
    openExternal: async (url) => openExternal(url),
    setProgress: (fraction) => mainWindow?.setProgressBar(fraction ?? -1),
    flushRenderer: flushRendererBeforeUpdate,
    quit: () => {
      quittingForUpdate = true;
      app.quit();
    },
    log: logger,
    ...(feedOverride != null && feedOverride !== '' && { latestReleaseUrl: feedOverride }),
  };
}

// patch: fork-only manual update check (features/updater). The startup check only decides whether
// the menu offers "New version!"; this run reports the full outcome, including why GitHub could not
// be asked, so "nothing happened" is never the entire answer. When the release publishes checksums
// it also downloads, verifies and installs the package (features/updater/flow.ts).
async function promptForUpdates() {
  await runUpdateCheck({ env: buildUpdateEnvironment() });
}

// patch: a visible app menu bar takes the focus when a bare Alt is released (Electron's own
// Windows behaviour), which would steal the Alt combinations the cutting window uses. Patch mode
// therefore keeps the bar hidden and lets `Alt+Q` show/hide it; base mode keeps the upstream bar.
// The visibility is tracked here because fullscreen and `Menu.setApplicationMenu` also touch it.
let lastPatchEntryMode: string | undefined;
let patchMenuBarVisible = false;

function applyPatchMenuBarVisibility() {
  if (mainWindow == null || mainWindow.isDestroyed()) return;
  const entryMode = configStore.get('entryMode');
  if (entryMode !== lastPatchEntryMode) {
    lastPatchEntryMode = entryMode;
    // A mode switch starts from the default: hidden in patch mode, visible in base mode.
    if (entryMode === 'patch') patchMenuBarVisible = false;
  }
  mainWindow.setMenuBarVisibility(entryMode !== 'patch' || patchMenuBarVisible);
}

function togglePatchMenuBar() {
  // Only the cutting window owns the app menu: its items act on that window, and the results
  // windows hide the bar. Do not pop it up over a viewer. Base mode keeps the upstream Alt.
  if (
    mainWindow == null
    || mainWindow.isDestroyed()
    || configStore.get('entryMode') !== 'patch'
    || BrowserWindow.getFocusedWindow() !== mainWindow
  ) return;
  patchMenuBarVisible = !patchMenuBarVisible;
  mainWindow.setMenuBarVisibility(patchMenuBarVisible);
}

function updateMenu() {
  assert.ok(mainWindow);
  menu({ app, mainWindow, newVersion, isStoreBuild, openExternal, checkForUpdates: promptForUpdates });
  // patch: runs after the menu exists; `setMenuBarVisibility` is a no-op before the first menu.
  applyPatchMenuBarVisibility();
}

async function changeLanguage(language: string | null) {
  try {
    await i18n.changeLanguage(language ?? undefined);
    updateMenu();
    // https://www.electronjs.org/docs/latest/api/app#appsetaboutpaneloptionsoptions
    app.setAboutPanelOptions(getAboutPanelOptions());
  } catch (err) {
    logger.error('Failed to set language', err);
  }
}

function openFilesEventually(paths: string[]) {
  if (rendererReady) openFiles(paths);
  else filesToOpen = paths;
}

// https://github.com/electron/electron/issues/3657
// https://github.com/mifi/lossless-cut/issues/357
// https://github.com/mifi/lossless-cut/issues/639
// https://github.com/mifi/lossless-cut/issues/591
function parseCliArgs(rawArgv = process.argv) {
  const ignoreFirstArgs = process.defaultApp ? 2 : 1;
  // production: First arg is the LosslessCut executable
  // dev: First 2 args are electron and the index.js
  const argsWithoutAppName = rawArgv.length > ignoreFirstArgs ? rawArgv.slice(ignoreFirstArgs) : [];

  return yargsParser(argsWithoutAppName, {
    boolean: ['disable-networking'],
    string: ['settings-json', 'config-dir', 'lossy-mode', 'keyboard-action'],
  });
}

const argv = parseCliArgs();

const lossyModeSchema = z.object({ videoEncoder: z.union([z.literal('libx264'), z.literal('libx265'), z.literal('libsvtav1')]) });
const lossyMode = argv['lossyMode'] ? lossyModeSchema.parse(JSON5.parse(argv['lossyMode'])) : undefined;

export type LossyMode = z.infer<typeof lossyModeSchema>;

if (argv['localesPath'] != null) i18nCommon.setCustomLocalesPath(argv['localesPath']);


function safeRequestSingleInstanceLock(additionalData: Record<string, unknown>) {
  if (process.mas) return true; // todo remove when dropping support for MacOS 13 https://github.com/electron/electron/issues/35540#issuecomment-2173130321

  // using additionalData because the built in "argv" passing is a bit broken:
  // https://github.com/electron/electron/issues/20322
  return app.requestSingleInstanceLock(additionalData);
}

// This promise will be fulfilled when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
// Call this immediately, to make sure we don't miss it (race condition)
const readyPromise = app.whenReady();

async function init() {
  try {
    logger.info('LosslessCut version', app.getVersion(), { isDev });
    await configStore.init({ customConfigDir: argv['configDir'] });
    logger.info('Initialized config store');

    const allowMultipleInstances = configStore.get('allowMultipleInstances');
    const language = configStore.get('language');

    if (!allowMultipleInstances && !safeRequestSingleInstanceLock({ argv: process.argv })) {
      logger.info('Found running instance, quitting');
      app.quit();
      return;
    }

    // patch: with several windows allowed, a claim left behind by a crashed window would refuse the
    // video for good. Sweep the dead ones once at startup (a live window keeps its claims).
    if (allowMultipleInstances) {
      const claimsRoot = () => join(dirname(configStore.getConfigPath()));
      await sweepStalePatchSourceClaims({ claimsDir: join(claimsRoot(), patchSourceClaimsDirName) })
        .catch((err: unknown) => { logger.warn('Failed to sweep stale source claims', err); });
      await sweepStalePatchResultClaims({ claimsDir: join(claimsRoot(), patchResultClaimsDirName) })
        .catch((err: unknown) => { logger.warn('Failed to sweep stale result claims', err); });
      app.on('will-quit', () => {
        // Best effort: a failed release leaves a claim behind, which the next start sweeps.
        releasePatchSourceClaims().catch(() => undefined);
        releaseAllPatchResultClaims().catch(() => undefined);
        releaseAllPatchWorkLocks().catch(() => undefined);
      });
    }

    // patch: a page that is gone (a reload, a crash) cannot release its work-area lock, and the lock
    // file names this live process, so no other window would ever take it over. Release what the
    // page still held as soon as its web contents is gone.
    app.on('web-contents-created', (_event, contents) => {
      const holderId = patchWorkLockHolderIdForWebContents(contents.id);
      const release = () => {
        releasePatchWorkLocksForHolder(holderId).catch((err: unknown) => { logger.warn('Failed to release the work-area locks of a closed window', err); });
      };
      contents.on('render-process-gone', release);
      contents.on('destroyed', release);
    });

    // On macOS, the system enforces single instance automatically when users try to open a second instance of your app in Finder, and the open-file and open-url events will be emitted for that.
    // However when users start your app in command line, the system's single instance mechanism will be bypassed, and you have to use this method to ensure single instance.
    // This can be tested with one terminal: npx electron .
    // and another terminal: npx electron . path/to/file.mp4
    app.on('second-instance', (_event, _commandLine, workingDirectory, additionalData) => {
      // Someone tried to run a second instance, we should focus our window.
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }

      const parsedAdditionalData = z.object({ argv: z.string().array() }).safeParse(additionalData);
      if (!parsedAdditionalData.success) return;

      const argv2 = parseCliArgs(parsedAdditionalData.data.argv);

      logger.info('second-instance', argv2);

      const { keyboardAction } = argv2;
      if (keyboardAction) {
        try {
          sendApiAction(keyboardAction, parseCliKeyboardActionArgs(keyboardAction, argv2._, workingDirectory));
        } catch (err) {
          logger.error('Invalid --keyboard-action arguments', err);
        }
      } else if (argv2._ && argv2._.length > 0) openFilesEventually(resolveCliFileArgs(argv2._.map(String), workingDirectory));
    });

    // Quit when all windows are closed.
    app.on('window-all-closed', () => {
      app.quit();
    });

    app.on('activate', () => {
      // On OS X it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (mainWindow === null) {
        createWindow();
      }
    });

    ipcMain.on('renderer-ready', (event) => {
      // patch: a reloaded cutting window cannot be exporting any more - its export died with the
      // renderer, and the work-area lock it took in the main process would look alive for good. Only
      // the locks of the page that (re)loaded are released: a finish job (or another window) keeps
      // its own, and the results windows send this too.
      releasePatchWorkLocksForHolder(patchWorkLockHolderIdForWebContents(event.sender.id))
        .catch((err: unknown) => { logger.warn('Failed to release the work-area locks of a reloaded window', err); });
      rendererReady = true;
      if (filesToOpen.length > 0) openFiles(filesToOpen);
    });

    // patch: the player window asks for the playlist when it is mounted.
    initPatchPlayerWindow();
    // patch: every window reports the video it shows, for the context menu's work-folder item.
    initPatchWindowPaths();
    // patch: the detached-source check panel. A deep decode check only exists for the panel that
    // asked for it, so closing the panel aborts every run still going.
    initPatchDetachableWindow();
    onPatchDetachableWindowClosed(() => {
      for (const controller of patchDeepChecks.values()) controller.abort();
      patchDeepChecks.clear();
    });

    // Mac OS open with LosslessCut
    // Emitted when the user wants to open a file with the application. The open-file event is usually emitted when the application is already open and the OS wants to reuse the application to open the file.
    app.on('open-file', (event, path) => {
      openFilesEventually([path]);
      event.preventDefault(); // recommended in docs https://www.electronjs.org/docs/latest/api/app#event-open-file-macos
    });

    ipcMain.on('setAskBeforeClose', (_e, val) => {
      askBeforeClose = val;
    });

    // patch: the renderer answered the updater's "save now" request (features/updater).
    ipcMain.on(patchFlushBeforeUpdateDoneChannel, () => {
      pendingUpdateFlush?.(true);
    });

    ipcMain.on('setLanguage', (_e, newLanguage) => changeLanguage(newLanguage));

    ipcMain.handle('tryTrashItem', async (_e, path) => {
      try {
        await stat(path);
      } catch (err) {
        if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return;
      }
      await shell.trashItem(path);
    });

    ipcMain.handle('showItemInFolder', (_e, path) => shell.showItemInFolder(path));

    ipcMain.on('apiActionResponse', (_e, { id }) => {
      apiActionRequests.get(id)?.();
    });

    logger.info('Waiting for app to become ready');
    await readyPromise;

    // https://www.electronjs.org/docs/latest/tutorial/dark-mode
    // also affects what `prefers-color-scheme` reports in the renderer
    nativeTheme.themeSource = configStore.get('theme');
    configStore.onDidChange('theme', (theme) => { nativeTheme.themeSource = theme; });
    nativeTheme.on('updated', () => {
      const color = getBackgroundColor();
      mainWindow?.setBackgroundColor(color);
      // The results windows and the check panel follow the same value: their renderer repaints from
      // `prefers-color-scheme`, but the window background shows before that (and behind a reload).
      setPatchResultsWindowsBackgroundColor(color);
      setPatchDetachableWindowBackgroundColor(color);
    });

    logger.info('CLI arguments', argv);
    if (argv['keyboardAction']) logger.warn('--keyboard-action only works with an already running instance (and "Allow multiple instances" disabled), ignoring it and its arguments');
    // Only if no files to open already (open-file might have already added some files)
    else if (filesToOpen.length === 0) filesToOpen = argv._.map(String);
    const { settingsJson } = argv;

    setDisableNetworking(argv['disableNetworking']);

    if (settingsJson != null) {
      logger.info('initializing settings', settingsJson);
      const settings = parseSettingsJson(settingsJson);
      if (settings.success) Object.entries(settings.data).forEach(([key, value]) => configStore.set(key as keyof Config, value));
      else logger.error('Invalid --settings-json, ignoring it', z.prettifyError(settings.error));
    }

    const { httpApi } = argv;

    if (httpApi != null) {
      const port = typeof httpApi === 'number' ? httpApi : 8080;
      const { startHttpServer } = HttpServer({ port, onKeyboardAction: sendApiAction, onAwaitAppEvent });
      await startHttpServer();
      logger.info('HTTP API listening on port', port);
    }


    if (isDev) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires,global-require,import-js/no-extraneous-dependencies
      installReactDevTools()
        .then((extension) => logger.info('Added Extension', extension.name))
        .catch((err: unknown) => logger.error('Failed to add extension', err));
    }

    createWindow();
    // patch: the work-history lock watches for a deleted password file and for an idle computer
    // (features/patchPrivacyLock). It starts with the window, after Electron is ready for
    // powerMonitor.
    // eslint-disable-next-line no-use-before-define -- defined with the lock RPC block below
    startPatchHistoryLockWatchers();
    // will also updateMenu and set about panel options
    await changeLanguage(language);

    const enableUpdateCheck = configStore.get('enableUpdateCheck');

    if (!hasDisabledNetworking() && enableUpdateCheck && !isStoreBuild) {
      // patch: tells the user what became of the last hand-over, once. A finished update deletes
      // the package; a failed one keeps it for a manual retry.
      await reportPreviousUpdate({ env: buildUpdateEnvironment() }).catch((err: unknown) => {
        logger.error('Failed to report the previous update', err);
      });
      newVersion = await checkNewVersion();
      // newVersion = '1.2.3';
      if (newVersion) updateMenu();
    }
  } catch (err) {
    logger.error('Failed to initialize', err);
  }
}

function focusWindow() {
  try {
    app.focus({ steal: true });
  } catch (err) {
    logger.error('Failed to focus window', err);
  }
}

function quitApp() {
  // allow HTTP API to respond etc.
  timers.setTimeout(1000).then(() => electron.app.quit());
}

const setProgressBar = (v: number) => mainWindow?.setProgressBar(v);

function sendOsNotification(options: NotificationConstructorOptions) {
  if (!Notification.isSupported()) return;
  const notification = new Notification(options);
  // Note: For notifications on macOS, your application will need to be code-signed in order for notification events to emit correctly. This requirement stems from the underlying UNNotification API provided by Apple. Unsigned binaries will emit a `failed` event when notification APIs are called.
  // https://www.electronjs.org/docs/latest/tutorial/notifications#macos
  notification.on('failed', (_e, error) => logger.warn('Notification failed', error));
  notification.show();
}

const patchPathCaseInsensitive = isWindows || isMac;

function buildFinishPreview(params: PatchFinishPreviewParams, dirNames = getConfiguredPatchDirNames()) {
  return buildPatchFinishPreview(params, {
    readManifest: (workRoot) => readPatchExportManifest(workRoot, dirNames),
    stat: async (path) => {
      const stats = await stat(path);
      return { size: stats.size, mtimeMs: stats.mtimeMs };
    },
    getDirs: (workRoot) => getPatchFinishDirs(workRoot, dirNames),
    getProjectStores: () => resolvePatchProjectStores({
      userDataDir: app.getPath('userData'),
      installDir: getPatchInstallDir({
        portableDir: process.env['PORTABLE_EXECUTABLE_DIR'],
        exePath: app.getPath('exe'),
      }),
    }),
    scanWorkDir: scanPatchWorkDirEntries,
    findFilesInUse: (paths) => (
      // Only meaningful with several instances; without them nothing can play the file but this window.
      configStore.get('allowMultipleInstances')
        ? findResultFilesClaimedElsewhere({
          claimsDir: join(dirname(configStore.getConfigPath()), patchResultClaimsDirName),
          paths,
          caseInsensitive: patchPathCaseInsensitive,
        })
        : Promise.resolve([])
    ),
    caseInsensitive: patchPathCaseInsensitive,
    dirNames,
  });
}

function createFinishDeps(workRoot: string | undefined, dirNames = getConfiguredPatchDirNames()) {
  return createPatchFinishDeps({
    removeManifestRecord: async (sourcePath) => {
      await removePatchExportManifestSourceRecord(workRoot, sourcePath, dirNames);
    },
    scanWorkDir: scanPatchWorkDirEntries,
    trashDir: async (dir) => {
      await shell.trashItem(dir);
    },
    // patch: one log line per file the job moves or deletes, so a failed job can be read back.
    log: (message) => logger.info(message),
    dirNames,
  });
}

/**
The work-area overview, built once per root and shared for a moment (features/patchResultsOverview).

The work-folders dialog, the deletion check and StrictMode's double mount can all ask within the
same second; a shared scan is one set of round trips instead of three. The scan itself is async, so
a slow network work root no longer blocks the main thread.
*/
const patchOverviewCache = createPatchOverviewCache(async (workRoot) => {
  const dirNames = getConfiguredPatchDirNames();
  const startedAt = Date.now();
  const ledger = await readPatchFinishLedger(workRoot, dirNames);
  const overview = await buildPatchResultsOverview(workRoot, {
    dirNames,
    ledger,
    caseInsensitive: patchPathCaseInsensitive,
    log: (message, ...args) => logger.warn(message, ...args),
  });
  logger.info('patch overview scan', {
    root: workRoot,
    sources: overview.sources.length,
    ms: Date.now() - startedAt,
  });
  return overview;
}, { caseInsensitive: patchPathCaseInsensitive });

/**
The work-history privacy lock (features/patchPrivacyLock, fork-owned).

The lock state lives in the main process so the idle watcher, the missing-file watcher and every
window agree. The service itself is injected with the file, hashing and settings access; see
`features/patchPrivacyLock/service.ts` for the rules.
*/
const patchHistoryLockPollMs = 30_000;
let patchHistoryLockService: PatchHistoryLockService | undefined;
let patchHistoryLockWatcherStarted = false;

function sendPatchPrivacyLockChanged() {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(patchPrivacyLockChangedChannel);
  }
}

function getPatchHistoryLockInstallDir() {
  return getPatchInstallDir({ portableDir: process.env['PORTABLE_EXECUTABLE_DIR'], exePath: app.getPath('exe') });
}

function getPatchHistoryLockService() {
  patchHistoryLockService ??= createPatchHistoryLockService({
    resolveFilePath: () => resolvePatchHistoryLockPath({
      userDataDir: app.getPath('userData'),
      installDir: getPatchHistoryLockInstallDir(),
      isPackaged: app.isPackaged,
      canWrite: canWriteDir,
      exists: pathExists,
    }),
    // The mode and idle time are user settings; the initialized flag, the remembered manual state
    // and the event log belong to the lock itself. All of them live in the patch store so an
    // upgrade does not lose the reset history.
    getSettings: () => ({
      mode: parseHistoryLockMode(patchConfig.getPatchSetting('historyLockMode')),
      idleMinutes: clampHistoryLockIdleMinutes(patchConfig.getPatchSetting('historyLockIdleMinutes')),
      initialized: patchConfig.getPatchSetting('historyLockInitialized'),
      locked: patchConfig.getPatchSetting('historyLockLocked'),
      seedPending: patchConfig.getPatchSetting('historyLockSeedPending'),
      events: parseHistoryLockEvents(patchConfig.getPatchSetting('historyLockEvents')),
    }),
    setSettings: (patch) => {
      if (patch.mode !== undefined) patchConfig.setPatchSetting('historyLockMode', patch.mode);
      if (patch.idleMinutes !== undefined) patchConfig.setPatchSetting('historyLockIdleMinutes', patch.idleMinutes);
      if (patch.initialized !== undefined) patchConfig.setPatchSetting('historyLockInitialized', patch.initialized);
      if (patch.locked !== undefined) patchConfig.setPatchSetting('historyLockLocked', patch.locked);
      if (patch.seedPending !== undefined) patchConfig.setPatchSetting('historyLockSeedPending', patch.seedPending);
      if (patch.events !== undefined) patchConfig.setPatchSetting('historyLockEvents', patch.events);
    },
    notify: sendPatchPrivacyLockChanged,
    log: (message, ...args) => logger.warn(message, ...args),
  });
  return patchHistoryLockService;
}

async function tickPatchHistoryLock() {
  try {
    const service = getPatchHistoryLockService();
    // This status call also restores the default password when the file was deleted. It notifies
    // the windows itself, so an open work-folders dialog collapses without waiting for its next
    // manual refresh.
    await service.status();
    await service.autoLockIfIdle(powerMonitor.getSystemIdleTime());
  } catch (err) {
    logger.warn('Failed to check the work-history lock', err);
  }
}

async function lockPatchHistoryForAway() {
  try {
    await getPatchHistoryLockService().lockForAway();
  } catch (err) {
    logger.warn('Failed to lock the work history when the computer went away', err);
  }
}

function startPatchHistoryLockWatchers() {
  if (patchHistoryLockWatcherStarted) return;
  patchHistoryLockWatcherStarted = true;
  // Check once right away, so the default password exists from the first start and a file deleted
  // while the app was closed is restored before the first dialog opens.
  tickPatchHistoryLock().catch(() => undefined);
  setInterval(() => { tickPatchHistoryLock().catch(() => undefined); }, patchHistoryLockPollMs);
  // The idle setting also covers the two ways Windows tells the app that the user left.
  powerMonitor.on('lock-screen', () => { lockPatchHistoryForAway().catch(() => undefined); });
  powerMonitor.on('suspend', () => { lockPatchHistoryForAway().catch(() => undefined); });
}

const remoteApi = {
  pathExists,
  downloadMediaUrl,
  fileTypeFromFile,
  focusWindow,
  quitApp,
  setProgressBar,
  sendOsNotification,
  writeClipboardText: (text: string) => electron.clipboard.writeText(text),
  readClipboardText: () => electron.clipboard.readText(),
  openExternal,
  patchListVideoFiles: listVideoFiles,
  // patch: the batch list's sort by duration (features/batchSort). The container header is read
  // without a process, and ffprobe only answers the files it declines.
  patchReadBatchDurations,
  patchPostProcessSource: createPatchPostProcessSource((path) => shell.trashItem(path)),
  patchEnsureWorkDirs: async (workRoot: string) => {
    const dirs = await ensurePatchWorkDirs(workRoot, { dirNames: getConfiguredPatchDirNames() });
    // patch: remember where the app has created a work area (`open-workpath-list`).
    recordPatchWorkRoot(workRoot);
    return dirs;
  },
  patchOpenFolder: (path: string) => shell.openPath(path),
  // patch: the export guard for a video inside `.losslesscut_work` offers "open the merged result
  // folder". The export manifest knows the merged result of this source exactly (the finish job
  // keeps the record current when it moves the file); the two standard folders are the fallback for
  // sources the manifest does not know. Returns whether a folder was opened, so the renderer can say
  // that there is none instead of silently doing nothing.
  patchOpenMergedResultFolder: async (sourcePath: string) => {
    const configuredRoot = patchConfig.getPatchSetting('workRoot');
    const dirNames = getConfiguredPatchDirNames();
    const workRoot = resolveWorkRootForPath({ path: sourcePath, workRoot: configuredRoot, dirNames });
    const dirs = getPatchFinishDirs(workRoot, dirNames);
    const manifest = await readPatchExportManifest(workRoot, dirNames);
    const recordKey = findManifestFileKey(manifest.files, sourcePath, { caseInsensitive: patchPathCaseInsensitive });
    const mergedPath = recordKey != null ? manifest.files[recordKey]?.merged?.path : undefined;
    const candidates = getMergedResultFolderCandidates({
      mergedPath,
      finishedMergedDir: dirs?.finishedMergedDir,
      mergedDir: dirs?.mergedDir,
    });
    const dirToOpen = candidates.find((candidate) => existsSync(candidate));
    if (dirToOpen == null) return false;
    const error = await shell.openPath(join(dirToOpen));
    if (error !== '') logger.warn('Failed to open the merged result folder', dirToOpen, error);
    return error === '';
  },
  // patch: "Open the work folder" from a context menu (fork-owned).
  patchOpenWorkFolderForPath: async (path: string) => {
    const configuredRoot = patchConfig.getPatchSetting('workRoot');
    const dirNames = getConfiguredPatchDirNames();
    const workRoot = resolveWorkRootForPath({ path, workRoot: configuredRoot, dirNames });
    const workDirs = getPatchWorkDirs(workRoot, dirNames);
    // Before the first export the work area does not exist yet: open the root the user chose, so
    // "Open the work folder" still leads somewhere instead of only saying there is none.
    const dirToOpen = workDirs != null && existsSync(workDirs.workDir)
      ? workDirs.workDir
      : (configuredRoot != null && configuredRoot.trim() !== '' && existsSync(configuredRoot) ? configuredRoot : undefined);
    if (dirToOpen == null) return { ok: false };
    await shell.openPath(dirToOpen);
    return { ok: true };
  },
  patchOpenMergedResult: (result: { path: string, sourcePath?: string | undefined, mergedChapters?: PatchMergedChapter[] | undefined }) => openPatchMergedWindow(
    [{ path: result.path, ...((result.sourcePath != null) && { sourcePath: result.sourcePath }), ...((result.mergedChapters != null) && { mergedChapters: result.mergedChapters }) }],
    mainWindow != null && !mainWindow.isDestroyed() ? mainWindow.getBounds() : undefined,
  ),
  // patch: resume/toggle the results windows from the command console (fork-owned).
  patchOpenClipsResult: (entries: PatchCutResultEntry[]) => openPatchPlayerWindow(
    entries,
    mainWindow != null && !mainWindow.isDestroyed() ? mainWindow.getBounds() : undefined,
  ),
  patchCloseClipsWindow: () => closePatchClipsWindow(),
  patchCloseMergedWindow: () => closePatchMergedWindow(),
  patchIsClipsWindowOpen: () => isPatchClipsWindowOpen(),
  patchIsMergedWindowOpen: () => isPatchMergedWindowOpen(),
  // patch: the detached-source check plays the whole check list in the check player (fork-owned). The
  // double-clicked file is the focus: the player jumps to its playlist position. The window is reused,
  // so double-clicking a second file replaces both list and focus.
  patchOpenInspectPlayer: (params: { path: string, label?: string | undefined, sourcePath?: string | undefined, playlist?: PatchCutResultEntry[] | undefined, focusPath?: string | undefined }) => {
    const entries = params.playlist != null && params.playlist.length > 0
      ? params.playlist
      : [{ path: params.path, ...(params.label != null && { label: params.label }), ...(params.sourcePath != null && { sourcePath: params.sourcePath }) }];
    return openPatchInspectWindow(
      entries,
      mainWindow != null && !mainWindow.isDestroyed() ? mainWindow.getBounds() : undefined,
      params.focusPath ?? params.path,
    );
  },
  patchCloseInspectWindow: () => closePatchInspectWindow(),
  patchIsInspectWindowOpen: () => isPatchInspectWindowOpen(),
  patchListWorkFolderOthers: async (params: { kind: 'clips' | 'merged', workRoot: string | undefined, sourcePath: string | undefined, excludePaths: readonly string[] }) => {
    const { listPatchWorkFolderOthers } = await import('./features/patchResume/resumeWindows.js');
    const dirNames = getConfiguredPatchDirNames();
    // patch: a source inside a work area belongs to the root above it, never to a nested one.
    const effectiveRoot = params.sourcePath != null
      ? resolveWorkRootForPath({ path: params.sourcePath, workRoot: params.workRoot, dirNames })
      : params.workRoot;
    const workDirs = getPatchWorkDirs(effectiveRoot, dirNames);
    return listPatchWorkFolderOthers(
      { kind: params.kind, excludePaths: params.excludePaths },
      {
        clipsDir: workDirs?.clipsDir,
        mergedDir: workDirs?.mergedDir,
        listFiles: (dir) => listVideoFiles({ dir }),
        caseInsensitive: process.platform === 'win32' || process.platform === 'darwin',
      },
    );
  },
  // patch: probe a source video for a damaged head GOP (cheap: it only reads the header).
  patchScanSourceHealth: (params: { path: string }) => scanPatchSourceHealth(params.path),
  // patch: probe a source for defects that make a lossless copy unusable (features/damagedSource).
  // `claim…Ask` is the once-per-run memory of the "this file is damaged" dialog: both windows that
  // can open the same source get the same answer without asking twice.
  probeSourceDamage: (params: { path: string }) => probeSourceDamage(params.path),
  claimSourceDamageAsk: (params: { path: string }) => claimSourceDamageAsk(params.path),
  setSourceDamagePlaybackOverride: (params: { path: string, repair: boolean | undefined }) => {
    setSourceDamagePlaybackOverride(params.path, params.repair);
  },
  // patch: the Tools > Repair menu is one menu for the whole app, so the focused window reports what
  // it is looking at and the menu is rebuilt (`features/damagedSource`).
  setSourceRepairMenuState: (params: { state: SourceRepairMenuState | undefined }) => {
    setSourceRepairMenuState(params.state);
    if (mainWindow != null && !mainWindow.isDestroyed()) updateMenu();
  },
  // patch: the repair menu only exists in patch mode, so switching modes rebuilds the menu.
  patchRefreshMenu: () => {
    if (mainWindow != null && !mainWindow.isDestroyed()) updateMenu();
  },
  // patch: `Alt+Q` shows/hides the app menu bar in patch mode (see `togglePatchMenuBar`).
  patchToggleMenuBar: () => {
    togglePatchMenuBar();
  },
  patchReadExportManifest: (workRoot: string | undefined) => readPatchExportManifest(workRoot, getConfiguredPatchDirNames()),
  // patch: the manifest write adds or drops cut results, so the results overview shares the new rows
  // instead of its short-lived copy of the old ones (see `features/patchResultsOverview/cache`).
  patchUpdateExportManifest: async (workRoot: string | undefined, sourcePath: string, patch: PatchExportRecordPatch) => {
    const updated = await updatePatchExportManifest(workRoot, sourcePath, patch, getConfiguredPatchDirNames());
    patchOverviewCache.invalidate(workRoot);
    return updated;
  },
  patchClearExportManifest: async (workRoot: string | undefined) => {
    try {
      return await clearPatchExportManifest(workRoot, getConfiguredPatchDirNames());
    } finally {
      patchOverviewCache.invalidate(workRoot);
    }
  },
  // patch: one job at a time per work area, across windows (`allowMultipleInstances`). The export
  // takes the lock for its whole run; the finish job and the cleanup take it themselves. The page
  // load is part of the holder (`webContentsId`): two windows are two jobs, and a reload releases
  // what the page before it still held (see the `renderer-ready` handler).
  patchAcquireWorkLock: (params: { workRoot: string | undefined, owner?: string | undefined }, webContentsId?: number) => acquirePatchWorkLock({ workRoot: params.workRoot, holderId: patchWorkLockHolderIdForWebContents(webContentsId), dirNames: getConfiguredPatchDirNames(), ...((params.owner != null) && { owner: params.owner }) }),
  patchReleaseWorkLock: (params: { workRoot: string | undefined, owner?: string | undefined }, webContentsId?: number) => releasePatchWorkLock({ workRoot: params.workRoot, holderId: patchWorkLockHolderIdForWebContents(webContentsId), ...((params.owner != null) && { owner: params.owner }) }),
  // patch: a video may be open in one window only (a mark writes the project file next to it). Only
  // enforced when several instances are allowed; without the claim nothing changes.
  patchClaimSource: async (params: { path: string }) => {
    if (!configStore.get('allowMultipleInstances')) return { ok: true as const };
    const result = await claimPatchSource({
      path: params.path,
      claimsDir: join(dirname(configStore.getConfigPath()), patchSourceClaimsDirName),
      caseInsensitive: patchPathCaseInsensitive,
    });
    if (!result.ok && result.reason === 'busy') logger.info('Refusing a source another window has open', params.path, result.holder);
    return result;
  },
  patchReleaseSourceClaims: () => releasePatchSourceClaims(),
  // patch: a results window declares the clip it plays, so another window does not move or delete it
  // under the player. Reading a result is never refused: the claim is only checked by the
  // destructive paths (rename / finish / export).
  patchClaimResultFile: async (params: { path: string, kind: PatchResultKind }) => {
    if (!configStore.get('allowMultipleInstances')) return { ok: true as const };
    return claimPatchResultFile({
      path: params.path,
      kind: params.kind,
      claimsDir: join(dirname(configStore.getConfigPath()), patchResultClaimsDirName),
      caseInsensitive: patchPathCaseInsensitive,
    });
  },
  patchReleaseResultClaims: (params: { kind: PatchResultKind }) => releasePatchResultClaims(params.kind),
  // patch: a results window re-checks its playlist when it gets focus: another window's finish job
  // may have moved or renamed a result meanwhile. Only the paths asked about are looked at.
  patchCheckResultFilesExist: async (params: { paths: readonly string[] }) => {
    const missing: string[] = [];
    await Promise.all(params.paths.map(async (path) => {
      if (!(await pathExists(path))) missing.push(path);
    }));
    return { missing };
  },
  patchFindResultFilesInUse: async (params: { paths: readonly string[] }) => {
    if (!configStore.get('allowMultipleInstances') || params.paths.length === 0) return { inUse: [] as string[] };
    return {
      inUse: await findResultFilesClaimedElsewhere({
        claimsDir: join(dirname(configStore.getConfigPath()), patchResultClaimsDirName),
        paths: params.paths,
        caseInsensitive: patchPathCaseInsensitive,
      }),
    };
  },
  // patch: the join repair pins `libx264`; a trimmed ffmpeg build may not have it. The renderer asks
  // once per session (cached for the ffmpeg path in features/patchExport/ffmpegEncoders).
  patchGetFfmpegEncoders: () => listFfmpegEncoders(),
  // patch: the finish flow (fork-owned). The renderer chooses, the main process moves the files.
  patchFinishPreview: (params: PatchFinishPreviewParams) => buildFinishPreview(params),
  // patch: where project files normally go, for the time converter's folder picker
  // (features/patchTimeConvert). Same store resolution the finish dialog uses.
  patchProjectStores: () => resolvePatchProjectStores({
    userDataDir: app.getPath('userData'),
    installDir: getPatchInstallDir({
      portableDir: process.env['PORTABLE_EXECUTABLE_DIR'],
      exePath: app.getPath('exe'),
    }),
  }),
  patchFinishJob: async (params: PatchFinishJobParams) => {
    // The renderer recognizes the marker and shows its own toast: IPC keeps only the message.
    if (patchFinishJobRunning) throw new Error(patchFinishBusyMarker);
    // patch: the folder names are read once for the whole job. A name changed in the settings while
    // this job runs must not split it between two work areas.
    const dirNames = getConfiguredPatchDirNames();
    // patch: another window may be exporting into the same work area; this job moves and deletes
    // the files it is writing.
    const lock = await acquirePatchWorkLock({ workRoot: params.workRoot, owner: 'finish', dirNames });
    if (!lock.ok) {
      if (lock.reason === 'busy') throw new Error(patchFinishBusyMarker);
      throw new Error(lock.message);
    }
    patchFinishJobRunning = true;
    let report: PatchFinishReport | undefined;
    try {
      // patch: the results windows are playing files this job is about to move, and Windows refuses
      // to move a file a player holds open. They let go of the video (and of their result claims),
      // but they are NOT closed: a job that stops halfway must not cost the user the window they
      // were reviewing. A successful job closes them below.
      const hadResultsWindows = isPatchClipsWindowOpen() || isPatchMergedWindowOpen();
      unloadPatchPlayerWindow();
      unloadPatchMergedWindow();
      // patch: the check player may hold the source (or a result) this job moves. It is unloaded like
      // the other two, and it is closed only when the job succeeds.
      unloadPatchInspectWindow();
      // The claims are this process's own bookkeeping (main writes them for the windows), so they can
      // be released here instead of waiting for the renderers to answer the unload message.
      await Promise.all([
        releasePatchResultClaims('cut-results'),
        releasePatchResultClaims('merged'),
      ]).catch((err: unknown) => { logger.warn('Failed to release the result claims before a finish job', err); });
      if (hadResultsWindows) {
        // The unload message is one-way; give the renderers a moment to drop the `<video>` src before
        // the first move (`withLockRetry` in the executor retries a lock that is released later).
        await new Promise<void>((resolve) => { setTimeout(resolve, 250); });
      }
      const preview = await buildFinishPreview(params, dirNames);
      // patch: our own readers keep the files locked (Windows): the repair preview streams the
      // source, and the waveform/thumbnail jobs read it too. Stop the ones that read the files this
      // job touches and wait for them to be gone - an aborted process releases the handle only when
      // it has really exited, and until then the first move still fails with EBUSY. The renderer
      // that runs the job unmounts the cutting window's preview as well; this covers the results
      // windows and anything still winding down.
      const touchedOptions = params.mode === 'merge'
        ? parsePatchFinishMergeOptions(params.options)
        : (params.mode === 'discard' ? parsePatchFinishDiscardOptions(params.options) : parsePatchFinishCutOptions(params.options));
      const stopped = await stopFfmpegChildrenReading({
        paths: [params.sourcePath, ...getFinishTouchedPaths({ mode: params.mode, options: touchedOptions, preview })],
        caseInsensitive: patchPathCaseInsensitive,
        timeoutMs: 2000,
      });
      if (stopped.stopped > 0) logger.info('patch finish: stopped', stopped.stopped, 'ffmpeg process(es) reading the files of this job');
      if (stopped.stillRunning > 0) logger.warn('patch finish:', stopped.stillRunning, 'ffmpeg process(es) still read the files of this job');
      // The dialog resolved its date folders when it opened; reuse that time (see PatchFinishJobParams.now).
      const jobNow = params.now != null ? new Date(params.now) : undefined;
      report = await executePatchFinish({
        params,
        preview,
        deps: createFinishDeps(params.workRoot, dirNames),
        ...(jobNow != null && !Number.isNaN(jobNow.getTime()) && { now: jobNow }),
      });
      // patch: a stopped job keeps the manifest record (the way back into a retry), but the attempt
      // may already have moved the source and some results. Record what it did reach, or the retry
      // would look for the old paths and refuse to continue (`no-record`, `clips-missing`).
      if (!report.ok) {
        await updatePatchExportManifestAfterFinish(params.workRoot, {
          sourcePath: params.sourcePath,
          newSourcePath: report.newSourcePath,
          moved: report.moved,
          deleted: report.deleted,
        }, dirNames).catch((err: unknown) => { logger.warn('Failed to record a stopped finish job in the manifest', err); });
      } else if (leavesCutResultsInWorkArea({ mode: params.mode, options: touchedOptions, preview })) {
        // patch: the job left cut results in the work area (kept for a later pass, or stale results
        // the user kept), so their record survives. What the job did move (the source, the merged
        // result, a project file) leaves the record, and a merged result that was archived is dropped
        // instead of followed: the work area no longer holds it, and the next `auto` would open the
        // merge dialog for a file that is gone.
        await updatePatchExportManifestAfterFinish(params.workRoot, {
          sourcePath: params.sourcePath,
          newSourcePath: report.newSourcePath,
          moved: report.moved,
          deleted: report.deleted,
        }, dirNames, { dropMovedMerged: true }).catch((err: unknown) => {
          logger.warn('Failed to keep the cut results tracked after a finish job', err);
        });
      }
      recordPatchWorkRoot(params.workRoot);
      // patch: the manifest record of this source is about to be gone (the next export starts from
      // scratch), so the results overview needs its own record of what this job produced
      // (features/patchResultsOverview).
      if (report.ok) {
        // patch: the fingerprint lets a later scan pair this job with an earlier one that ran under
        // the old source path (a finish job may move the source inside the work area).
        const sourceIdentity = await readPatchSourceFingerprint(report.newSourcePath ?? params.sourcePath);
        const ledgerEntry = buildFinishLedgerEntry({
          sourcePath: params.sourcePath,
          newSourcePath: report.newSourcePath,
          sourceIdentity,
          clipPaths: preview.clips.map((clip) => clip.path),
          mergedPath: preview.merged?.path,
          moved: report.moved,
          dirs: {
            finishedClipsDir: preview.dirs.finishedClipsDir,
            finishedMergedDir: preview.dirs.finishedMergedDir,
            detachedClipsDir: preview.dirs.detachedClipsDir,
            detachedMergedDir: preview.dirs.detachedMergedDir,
          },
          at: Date.now(),
        }, { caseInsensitive: patchPathCaseInsensitive });
        if (ledgerEntry != null) {
          await recordPatchFinishLedgerEntry({ workRoot: params.workRoot, dirNames, entry: ledgerEntry, caseInsensitive: patchPathCaseInsensitive })
            .catch((err: unknown) => { logger.warn('Failed to record a finished job for the results overview', err); });
        }
      }
      return report;
    } finally {
      patchFinishJobRunning = false;
      // The job moved or deleted files: the next overview scan must not answer with the rows from
      // before it (see `features/patchResultsOverview/cache`). Even a stopped job may have moved
      // some of them, so this runs on every exit.
      patchOverviewCache.invalidate(params.workRoot);
      const succeeded = report?.ok === true;
      try {
        await releasePatchWorkLock({ workRoot: params.workRoot, owner: 'finish' });
      } finally {
        // The windows are handled even if releasing the lock failed: they were unloaded above and
        // must not be left blank (or half-closed) because of it.
        if (succeeded) {
          // patch: the job moved or deleted the files these windows showed, so they close now - a
          // stopped job keeps them (they get their video back, see below).
          closePatchClipsWindow();
          closePatchMergedWindow();
          // patch: the check player's file may be gone as well; it is reopened from the check panel.
          closePatchInspectWindow();
        } else {
          // The players were released to let the files move; the job stopped before (or while) doing
          // that, so the results windows get their video back instead of staying blank.
          await resendPatchResultsPlaylists({ exists: pathExists }).catch((err: unknown) => {
            logger.warn('Failed to hand the results back to the result windows', err);
          });
        }
      }
    }
  },
  // patch: `fallbackRoot` is the current session's work root, so the list also works before the
  // first export (or when the history is still empty). While the privacy lock is engaged the main
  // process drops the history and keeps only that fallback root; the renderer passes none when no
  // video is open (features/patchPrivacyLock).
  patchListWorkRoots: async (fallbackRoot?: string) => {
    const lock = await getPatchHistoryLockService().status();
    return listPatchWorkRoots({
      getHistory: getPatchWorkHistory,
      getDirs: (root) => getPatchFinishDirs(root, getConfiguredPatchDirNames()),
      exists: pathExists,
      fallbackRoot,
      caseInsensitive: patchPathCaseInsensitive,
      historyLocked: lock.enabled && !lock.unlocked,
    });
  },
  // patch: the work-folder privacy lock (features/patchPrivacyLock). The password is verified in
  // the main process; the renderer only sends the typed value and receives a status/reason.
  patchPrivacyLockStatus: () => getPatchHistoryLockService().status(),
  patchPrivacyLockUnlock: (password: string) => getPatchHistoryLockService().unlock(password),
  patchPrivacyLockLock: () => getPatchHistoryLockService().lock(),
  patchPrivacyLockSetPassword: (password: string) => getPatchHistoryLockService().setPassword(password),
  patchPrivacyLockChangePassword: (params: { currentPassword: string, newPassword: string }) => getPatchHistoryLockService().changePassword({
    currentPassword: params.currentPassword,
    newPassword: params.newPassword,
  }),
  // patch: the results overview (features/patchResultsOverview). Reads the stage folders, the
  // finished-job ledger and the project files; the renderer only renders the result. The cache
  // shares one scan between windows (and between StrictMode's two mounts) and lets an explicit
  // refresh skip the short reuse window.
  patchResultsOverview: (workRoot: string | undefined, options?: { force?: boolean }) => patchOverviewCache.get(workRoot, options),
  // patch: the detached-source check (features/patchDeletable). The report is the same work-area
  // overview, narrowed to `detached_src_media` and carrying the reason each row may (not) be
  // deleted. The renderer never decides that on its own.
  patchDetachableReport: (workRoot: string | undefined, options?: { force?: boolean }) => patchOverviewCache.get(workRoot, options).then((overview) => buildPatchDetachableReport(overview, getPatchDetachExtraDeletableReasons())),
  // patch: open the check panel for a work root (it is one reused window).
  patchOpenDetachableWindow: (params: { workRoot: string }) => {
    openPatchDetachableWindow({
      workRoot: params.workRoot,
      ...(mainWindow != null && !mainWindow.isDestroyed() && { mainBounds: mainWindow.getBounds() }),
    });
  },
  patchCloseDetachableWindow: () => closePatchDetachableWindow(),
  patchIsDetachableWindowOpen: () => isPatchDetachableWindowOpen(),
  // patch: delete the selected detached sources for good. Under the work-area lock like every other
  // job that writes there, so an export or a finish job in another window cannot run at the same
  // time; the lock is released even when a file of the batch could not be deleted.
  patchDeleteDetachedSources: async (params: { workRoot: string | undefined, paths: readonly string[] }) => {
    const dirNames = getConfiguredPatchDirNames();
    const lock = await acquirePatchWorkLock({ workRoot: params.workRoot, owner: 'delete', dirNames });
    if (!lock.ok) {
      logger.info('Refusing to delete detached sources: the work area is busy', lock.reason, lock.reason === 'busy' ? lock.holder : lock.message);
      return { ok: false as const, reason: lock.reason };
    }
    try {
      const { outcomes } = await deletePatchDetachedSources({
        workRoot: params.workRoot,
        paths: params.paths,
        caseInsensitive: patchPathCaseInsensitive,
      }, {
        readReport: async (workRoot) => buildPatchDetachableReport(await buildPatchResultsOverview(workRoot, {
          dirNames,
          ledger: await readPatchFinishLedger(workRoot, dirNames),
          caseInsensitive: patchPathCaseInsensitive,
          log: (message, ...args) => logger.warn(message, ...args),
        }), getPatchDetachExtraDeletableReasons()),
        exists: pathExists,
        isOpenElsewhere: (path) => isPatchPathOpenInAnyWindow(path, { caseInsensitive: patchPathCaseInsensitive }),
        releasePlayers: () => { unloadPatchInspectWindow(); },
        stopReaders: async (paths) => {
          const stopped = await stopFfmpegChildrenReading({ paths, caseInsensitive: patchPathCaseInsensitive, timeoutMs: 2000 });
          if (stopped.stillRunning > 0) logger.warn('patch delete:', stopped.stillRunning, 'ffmpeg process(es) still read the files of this delete');
        },
        unlink: async (path) => { await unlink(path); },
        sleep: async (ms) => { await timers.setTimeout(ms); },
        log: (message, ...args) => logger.warn(message, ...args),
      });
      const deleted = outcomes.filter((outcome) => outcome.status === 'deleted').length;
      logger.info('patch delete: deleted', deleted, 'of', outcomes.length, 'detached sources');
      return { ok: true as const, outcomes };
    } finally {
      // The rows just changed on disk: the next panel rescan must not be answered by the cache.
      patchOverviewCache.invalidate(params.workRoot);
      await releasePatchWorkLock({ workRoot: params.workRoot, owner: 'delete' });
    }
  },
  // patch: the full decode check behind one row of the panel. It decodes the whole file, reports
  // where it got to and can be cancelled; the child is tracked, so a finish job or a delete stops it.
  patchDeepCheckFile: async (params: { path: string, durationSeconds?: number | undefined }) => {
    const key = params.path.toLowerCase();
    if (patchDeepChecks.has(key)) return { status: 'running' as const };
    const abortController = new AbortController();
    patchDeepChecks.set(key, abortController);
    try {
      const result = await runPatchDeepCheck({
        path: params.path,
        durationSeconds: params.durationSeconds,
        onProgress: (progress) => { sendPatchDetachableDeepCheck({ path: params.path, progress }); },
      }, {
        run: (args, { onLine }) => runFfmpegDecodeCheck({ args, inputPath: params.path, abortController, onLine }),
      });
      sendPatchDetachableDeepCheck({ path: params.path, done: result });
      return result;
    } finally {
      patchDeepChecks.delete(key);
    }
  },
  patchCancelDeepCheck: (params: { path: string }) => {
    patchDeepChecks.get(params.path.toLowerCase())?.abort();
  },
  // patch: clean empty work areas (`cewd`). Only whitelisted folders are moved to the recycle bin;
  // a failed trash is reported, never replaced with a permanent delete.
  patchClearEmptyWorkDirs: async () => {
    const configuredRoot = patchConfig.getPatchSetting('workRoot');
    const dirNames = getConfiguredPatchDirNames();
    const roots = [
      ...(configuredRoot != null && configuredRoot.trim() !== '' ? [configuredRoot] : []),
      ...getPatchWorkHistory().roots.map((entry) => entry.root),
    ];
    // patch: the lock of a window that is gone must not keep a work area from being cleaned up. A
    // live lock stays, and the lock file is not on the cleanup whitelist, so the area is kept.
    await Promise.all(roots.map(async (root) => {
      const workDir = getPatchWorkDirs(root, dirNames)?.workDir;
      if (workDir != null) await removeStalePatchWorkLock(workDir).catch(() => undefined);
    }));
    return clearEmptyWorkDirs({
      roots,
      getWorkDir: (root) => getPatchWorkDirs(root, dirNames)?.workDir,
      scanWorkDir: scanPatchWorkDirEntries,
      trashDir: async (dir) => {
        await shell.trashItem(dir);
      },
      caseInsensitive: patchPathCaseInsensitive,
      dirNames,
    });
  },
  // patch: opens a folder in the file manager. `shell.openPath` reports a failure as a message
  // instead of throwing, so the result tells the caller whether it may close (the work folder list
  // closes itself only after the folder really opened).
  patchOpenWorkPath: async (dir: string) => {
    const error = await shell.openPath(dir);
    if (error !== '') logger.warn('Failed to open a folder', dir, error);
    return error === '';
  },
  // patch: open a file with whatever the system associates with it - what a double click in the file
  // manager does (fork-owned; the check panel's "play with another program"). `shell.openPath` answers
  // with an error message instead of throwing, like the folder call above.
  patchOpenFileExternal: async (path: string) => {
    const error = await shell.openPath(path);
    if (error !== '') logger.warn('Failed to open a file with its default application', path, error);
    return error === '';
  },
  // patch: shows a result in the file manager and selects it. `shell.showItemInFolder` reports  // nothing, so the fallback has to be decided here: a file the job deleted (or one the user moved
  // away since) cannot be selected, and its folder is all that is left to show. The answer tells the
  // renderer which of the two happened instead of leaving the button silent.
  patchRevealPath: async (path: string) => {
    if (existsSync(path)) {
      shell.showItemInFolder(path);
      return 'revealed' as const;
    }
    const dir = dirname(path);
    if (!existsSync(dir)) return 'failed' as const;
    const error = await shell.openPath(dir);
    if (error !== '') {
      logger.warn('Failed to open a folder', dir, error);
      return 'failed' as const;
    }
    return 'opened-folder' as const;
  },
  // patch: a results window's `Shift+E` / `Shift+F` opens the finish dialog in the cutting window
  // (it owns the batch list and the player that the job ends).
  patchRequestFinishDialog: async (request: PatchFinishDialogRequest) => {
    if (mainWindow == null || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send(patchFinishDialogRequestChannel, request);
  },
  // patch: the results window renames a file on disk; the main process does it, so the export
  // manifest can be updated in the same step (see features/patchExport/renameResult). It runs under
  // the work-area lock: an export or a finish job in another window writes the same files and the
  // same manifest.
  patchRenameResult: async (payload: { from: string, to: string, sourcePath?: string | undefined, label?: string | undefined }) => {
    const dirNames = getConfiguredPatchDirNames();
    const renameDeps = {
      renameFile: (from: string, to: string) => rename(from, to),
      fileExists: pathExists,
      updateManifest: (workRoot: string | undefined, change: { from: string, to: string, label?: string | undefined, sourcePath?: string | undefined }) => updatePatchExportManifestResultPath(workRoot, change, dirNames),
      getConfiguredWorkRoot: () => patchConfig.getPatchSetting('workRoot'),
      getDirNames: () => dirNames,
      logWarning: (message: string, error: unknown) => logger.warn(message, error),
    };
    const outcome = await renameResultLocked(payload, renameDeps, {
      acquireLock: (workRoot) => acquirePatchWorkLock({ workRoot, owner: 'rename', dirNames }),
      releaseLock: (workRoot) => releasePatchWorkLock({ workRoot, owner: 'rename' }),
      findInUse: (paths) => (
        configStore.get('allowMultipleInstances')
          ? findResultFilesClaimedElsewhere({
            claimsDir: join(dirname(configStore.getConfigPath()), patchResultClaimsDirName),
            paths,
            caseInsensitive: patchPathCaseInsensitive,
          })
          : Promise.resolve([])
      ),
    });
    if (!outcome.ok) {
      logger.error('Failed to rename a cut result', payload, outcome.reason);
    } else {
      updateResultsWindowPlaylistPaths(payload);
      // patch: the results overview pairs by the final paths, so a result rename has to follow there
      // too (the finish job's own `.llc` record keeps the old name). The root comes from the same
      // helper as the manifest update above, so both writes always land in one work area.
      const workRoot = resolveRenameWorkRoot({ from: payload.from, sourcePath: payload.sourcePath }, () => patchConfig.getPatchSetting('workRoot'), dirNames);
      await renamePatchFinishLedgerEntry({ workRoot, dirNames, from: payload.from, to: payload.to, caseInsensitive: patchPathCaseInsensitive })
        .catch((err: unknown) => { logger.warn('Failed to follow a result rename in the results overview history', err); });
      // The pairing in the overview follows paths, so the renamed row must not be answered by the
      // cache (see `features/patchResultsOverview/cache`).
      patchOverviewCache.invalidate(workRoot);
    }
    return outcome;
  },
};

export type RemoteApi = typeof remoteApi;

export type RemoteRpcApi = {
  [K in keyof RemoteApi]: Asyncify<RemoteApi[K]>;
};

// using @electron/remote
const remoteApiLegacy = {
  ffmpeg,
  i18n: i18nCommon,
  compatPlayer,
  configStore,
  isLinux,
  isWindows,
  isMac,
  platform,
  arch,
  isDev,
  lossyMode,
  pathToFileURL,
  hasDisabledNetworking,
  patchConfig,
  // patch: the renderer needs the same work area paths as the main process (features/patchWork).
  patchGetWorkDirs: getPatchWorkDirs,
};

export type RemoteApiLegacy = typeof remoteApiLegacy;


// @ts-expect-error don't know how to type
app.addListener('remote-require', (event: { returnValue: RemoteApiLegacy }, _webContents: unknown, moduleName: string) => {
  if (moduleName === './index.js') {
    // eslint-disable-next-line no-param-reassign
    event.returnValue = remoteApiLegacy;
  }
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
ipcMain.handle('__electron_rpc__', async (event, method: keyof RemoteApi, args: any[]) => {
  const fn = remoteApi[method];
  assert.ok(fn, `Unknown API method: ${method}`);
  // patch: the work-area lock is held per page load, so these two calls carry the caller's web
  // contents id (see `features/patchWork/exportLock`).
  if (method === 'patchAcquireWorkLock' || method === 'patchReleaseWorkLock') {
    // @ts-expect-error don't know how to type
    return fn(args[0], event.sender.id);
  }
  // @ts-expect-error don't know how to type
  return fn(...args);
});

// cannot top level await because app.whenReady will hang forever
// eslint-disable-next-line unicorn/prefer-top-level-await
init();
