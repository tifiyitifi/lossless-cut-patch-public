/* eslint-disable no-param-reassign -- the window state object is a mutable holder (window, ready, playlist) */
// eslint-disable-next-line import-js/no-extraneous-dependencies
import { BrowserWindow, app, ipcMain, screen } from 'electron';
import remote from '@electron/remote/main/index.js';
import { join } from 'node:path';
import { t } from 'i18next';

import { patchInspectQueryParam, patchMergedQueryParam, patchPlayerPlaylistChannel, patchPlayerQueryParam, patchPlayerReadyChannel, patchPlayerReleaseChannel, patchResultsPauseChannel } from '../../../common/features/patchPlayer/playerMode.js';
import type { PatchCutResultEntry } from '../../../common/features/patchPlayer/playerMode.js';
import type { PatchResultsWindowKind } from '../../../common/features/patchPlayer/playback.js';
import { replaceResultPath } from '../../../common/features/patchPlayer/playlist.js';
import { decideResultsWindowLoadAction } from '../../../common/features/patchPlayer/windowLoad.js';
import { getPlayerWindowBounds } from '../../../common/features/patchPlayer/windowBounds.js';
import type { PatchWindowBounds } from '../../../common/features/patchPlayer/windowBounds.js';
import attachContextMenu from '../../contextMenu.js';
import isDev from '../../isDev.js';
import logger from '../../logger.js';
import * as configStore from '../../configStore.js';
import { getBackgroundColor } from '../../theme.js';
import * as patchConfig from '../patch/patchConfig.js';
import { releasePatchResultClaims } from './resultClaims.js';

/**
The patch results windows (fork-owned).

Three separate windows load the same renderer bundle in `playerMode` (see
`common/features/patchPlayer`): the untouched upstream player, minus the cutting.

- the cut-results window plays the cut results of an export as a playlist;
- the merged-result window plays one file: the merged cut results (`patchMerged=1`);
- the check player shows the one file the detached-source check double-clicked (`patchInspect=1`).
  It is a player like the other two, so playback, the timeline and the repair preview come for
  free; it only ever plays a source, so it never claims a result.

All three are separate windows (not panels) so the cutting window keeps its state while the results
are reviewed.
*/

interface ResultsWindowState {
  kind: 'cut-results' | 'merged' | 'inspect';
  window: BrowserWindow | null;
  ready: boolean;
  playlist: PatchCutResultEntry[];
  /** The entry to jump to on the next playlist push (the check player's double-clicked file). */
  focusPath: string | undefined;
  /** The watchdog already reloaded this window once (a second failure is reported, not retried). */
  reloadTried: boolean;
  /** Pending "did this window ever mount?" timer, see `armLoadWatchdog`. */
  watchdog: NodeJS.Timeout | undefined;
}

/**
How long a results window gets to report that the renderer mounted.

A cold dev start has to transform the whole module graph on first load, so it is generous; in a
packaged build the window is mounted long before this.
*/
const resultsWindowLoadTimeoutMs = 15_000;

function createState(kind: ResultsWindowState['kind']): ResultsWindowState {
  return { kind, window: null, ready: false, playlist: [], focusPath: undefined, reloadTried: false, watchdog: undefined };
}

const cutResultsWindow = createState('cut-results');
const mergedResultWindow = createState('merged');
const inspectWindow = createState('inspect');
const resultsWindows = [cutResultsWindow, mergedResultWindow, inspectWindow];

function getPreloadPath() {
  // The main process is bundled into `out/main/index.js`, so the preload is addressed relative to
  // the app root instead of the module (this works both in dev and inside the asar).
  return join(app.getAppPath(), 'out', 'preload', 'index.cjs');
}

function clearLoadWatchdog(state: ResultsWindowState) {
  if (state.watchdog != null) clearTimeout(state.watchdog);
  state.watchdog = undefined;
}

/**
Say why the window is blank, inside the window itself.

A renderer whose module load failed never mounts the app, so nothing of ours can render there.
The document still exists, so the message is written into it (translated, see `t()`), otherwise
the window is an empty gray rectangle and the user cannot tell it from a slow load.
*/
function reportLoadFailure(win: BrowserWindow) {
  const message = t('The results window could not be loaded. Close it and try again.');
  const script = `
    document.body.innerHTML = '';
    const message = document.createElement('div');
    message.textContent = ${JSON.stringify(message)};
    message.style.cssText = 'color: #eee; font: 1.2em system-ui, sans-serif; text-align: center; padding: 2em;';
    document.body.style.cssText = 'margin: 0; background: #333; display: flex; align-items: center; justify-content: center; height: 100vh;';
    document.body.appendChild(message);
  `;
  win.webContents.executeJavaScript(script).catch((err: unknown) => {
    logger.error('Failed to report that a patch results window did not load', err);
  });
}

/** Start (or restart) the "did the renderer mount?" timer, see `resultsWindowLoadTimeoutMs`. */
function armLoadWatchdog(state: ResultsWindowState, win: BrowserWindow) {
  clearLoadWatchdog(state);
  state.watchdog = setTimeout(() => {
    if (win.isDestroyed() || state.ready) return;
    // eslint-disable-next-line no-use-before-define -- the watchdog reports the same failure, one retry later
    handleLoadFailure(state, win, 'timeout');
  }, resultsWindowLoadTimeoutMs);
  // A pending watchdog must not keep the app alive.
  state.watchdog.unref();
}

/**
The window never said it mounted (or its renderer crashed): reload it once, then report.

The decision is a pure function (`common/features/patchPlayer/windowLoad`): it never reloads a
window that is fine, ignores the retry when the user turned it off, and gives up after one
attempt so a window that cannot load does not reload forever.
*/
function handleLoadFailure(state: ResultsWindowState, win: BrowserWindow, reason: string) {
  const action = decideResultsWindowLoadAction({
    ready: state.ready,
    reloaded: state.reloadTried,
    reloadEnabled: patchConfig.getPatchSetting('reloadResultsWindow'),
  });
  if (action === 'none') return;
  if (action === 'reload') {
    state.reloadTried = true;
    clearLoadWatchdog(state);
    logger.info('Reloading a patch results window that did not finish loading', state.kind, reason);
    win.webContents.reload();
    armLoadWatchdog(state, win);
    return;
  }
  clearLoadWatchdog(state);
  logger.error('A patch results window could not be loaded', state.kind, reason);
  if (!win.isDestroyed()) reportLoadFailure(win);
}

function createResultsWindow(state: ResultsWindowState, mainBounds: PatchWindowBounds | undefined) {
  // patch: the player reviews the results of the cutting window, so it opens at that window's size
  // (cascaded and clamped to the display) instead of a fixed default.
  const windowBounds = mainBounds != null
    ? getPlayerWindowBounds({ mainBounds, workArea: screen.getDisplayMatching(mainBounds).workArea })
    : undefined;

  const win = new BrowserWindow({
    ...(windowBounds ?? { width: 1024, height: 640 }),
    minWidth: 320,
    minHeight: 240,
    backgroundColor: getBackgroundColor(),
    title: t(state.kind === 'merged' ? 'Merge results' : (state.kind === 'inspect' ? 'Check player' : 'Player')),
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      webSecurity: !isDev,
      preload: getPreloadPath(),
    },
  });

  state.window = win;
  state.ready = false;
  state.reloadTried = false;

  remote.enable(win.webContents);
  attachContextMenu(win);
  // The app menu drives the main window, so it would be confusing in the player.
  win.setMenuBarVisibility(false);

  win.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
    // -3 is ERR_ABORTED: the navigation was replaced (a reload), not a failure.
    if (!isMainFrame || errorCode === -3) return;
    logger.error('A patch results window failed to load', errorCode, errorDescription, validatedURL);
    handleLoadFailure(state, win, `did-fail-load ${errorCode}`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    logger.error('A patch results renderer is gone', details);
    handleLoadFailure(state, win, `render-process-gone ${details.reason}`);
  });
  if (isDev) {
    // dev only: forward the renderer console to the log, to debug the player window. The source URL
    // and line are part of the message: a module that fails to load names itself only there.
    win.webContents.on('console-message', (event) => {
      const details = event as unknown as { message?: string | undefined, lineNumber?: number | undefined, sourceId?: string | undefined };
      const source = details.sourceId;
      logger.info('player console:', source != null ? `${source}:${details.lineNumber ?? ''}` : '', details.message ?? '');
    });
  }

  const query: Record<string, string> = { [patchPlayerQueryParam]: '1' };
  if (state.kind === 'merged') query[patchMergedQueryParam] = '1';
  else if (state.kind === 'inspect') query[patchInspectQueryParam] = '1';
  if (isDev) win.loadURL(`http://localhost:3001?${new URLSearchParams(query).toString()}`);
  else win.loadFile('out/renderer/index.html', { query });
  armLoadWatchdog(state, win);

  win.on('closed', () => {
    logger.info('A patch results window was closed', state.kind);
    clearLoadWatchdog(state);
    state.window = null;
    state.ready = false;
    // patch: the window is gone, so nothing plays it any more: a finish job or an export in another
    // window must not stay blocked by its result claim. The check player holds no result claim: it
    // can play results from its list, but a finish job that reaches one finds it in use and reports
    // that instead of moving it, so nothing is lost by leaving it out of the release.
    if (state.kind !== 'inspect') {
      releasePatchResultClaims(state.kind).catch((err: unknown) => {
        logger.warn('Failed to release the result claims of a closed window', err);
      });
    }
  });

  return win;
}

function sendPlaylist(state: ResultsWindowState) {
  if (state.window == null || state.window.isDestroyed() || !state.ready) return;
  const message = { entries: state.playlist, ...(state.focusPath != null && { focusPath: state.focusPath }) };
  try {
    state.window.webContents.send(patchPlayerPlaylistChannel, message);
    // The jump is for this push only: a later resend (a finish job) must not drag the player back.
    state.focusPath = undefined;
  } catch (err) {
    logger.error('Failed to send the playlist to a results window', err);
  }
}

/**
Pause the given results windows (all of them by default).

The cutting window announces its own playback, so the three windows never play audio at the same
time. The windows are separate processes: this is best effort, exactly like the other direction.
*/
export function pausePatchResultsWindows(kinds: readonly PatchResultsWindowKind[] = resultsWindows.map((state) => state.kind)) {
  const targets = new Set(kinds);
  for (const state of resultsWindows) {
    if (targets.has(state.kind) && state.window != null && !state.window.isDestroyed()) {
      try {
        state.window.webContents.send(patchResultsPauseChannel);
      } catch (err) {
        logger.error('Failed to pause a results window', err);
      }
    }
  }
}

function openResultsWindow(state: ResultsWindowState, entries: PatchCutResultEntry[], mainBounds: PatchWindowBounds | undefined, raise = true, focusPath?: string | undefined) {
  if (entries.length === 0) return;
  // A window the user keeps open while auto-open is off only gets the new playlist: it is never
  // created, restored or focused behind the user's back.
  if (!raise && (state.window == null || state.window.isDestroyed())) return;

  state.playlist = entries;
  state.focusPath = focusPath;
  logger.info('Opening a patch results window', state.kind, entries.map((entry) => entry.path));

  if (state.window != null && !state.window.isDestroyed()) {
    if (raise) {
      if (state.window.isMinimized()) state.window.restore();
      state.window.show();
      state.window.focus();
    }
    if (!state.ready) {
      // Still loading: the ready message sends the playlist. A window whose load already failed
      // (its watchdog gave up) gets a new load instead of a playlist it cannot show - in place: it is
      // still not created, restored or focused, so `raise = false` only reloads a window that exists.
      if (state.watchdog == null) {
        state.reloadTried = true;
        state.window.webContents.reload();
        armLoadWatchdog(state, state.window);
      }
      return;
    }
    sendPlaylist(state);
    return;
  }

  createResultsWindow(state, mainBounds);
}

/**
Show the cut results in the player window.

An already open player is reused: it gets the new playlist and the focus. It is not resized, so
a player the user has resized keeps that size. `mainBounds` are the cutting window's current
bounds, used only when the player window is created.
*/
export function openPatchPlayerWindow(entries: PatchCutResultEntry[], mainBounds?: PatchWindowBounds | undefined) {
  openResultsWindow(cutResultsWindow, entries, mainBounds);
}

/**
Show the merged result in its own window (the third window of the workflow).

The window is cascaded from the cut-results window when that one is open, so the merged result
does not cover the playlist it was merged from.
*/
export function openPatchMergedWindow(entries: PatchCutResultEntry[], mainBounds?: PatchWindowBounds | undefined) {
  const cutWindow = cutResultsWindow.window;
  const baseBounds = cutWindow != null && !cutWindow.isDestroyed() ? cutWindow.getBounds() : mainBounds;
  openResultsWindow(mergedResultWindow, entries, baseBounds);
}

/**
Show one file in the check player (fork-owned).

The detached-source check opens it when a card is double-clicked. `entries` is the whole check list
(sources and their results, see `buildPatchDetachPlaylist`), so the sidebar lets the user walk the
list; `focusPath` is the card that was double-clicked, and the player jumps to that position. Opening
another file reuses the window and replaces the playlist, so the user keeps one check player.
`mainBounds` are the cutting window's bounds, used only when the window is created.
*/
export function openPatchInspectWindow(entries: PatchCutResultEntry[], mainBounds?: PatchWindowBounds | undefined, focusPath?: string | undefined) {
  openResultsWindow(inspectWindow, entries, mainBounds, true, focusPath);
}

function closeResultsWindow(state: ResultsWindowState) {
  clearLoadWatchdog(state);
  if (state.window == null || state.window.isDestroyed()) {
    state.window = null;
    state.ready = false;
    return;
  }
  state.window.close();
}

/** Close the check player (a delete is about to unlink the file it plays). */
export function closePatchInspectWindow() {
  closeResultsWindow(inspectWindow);
}

/** Is the cut-results window open? */
export function isPatchClipsWindowOpen() {
  return cutResultsWindow.window != null && !cutResultsWindow.window.isDestroyed();
}

/** Is the merged-result window open? */
export function isPatchMergedWindowOpen() {
  return mergedResultWindow.window != null && !mergedResultWindow.window.isDestroyed();
}

/** Is the check player open? */
export function isPatchInspectWindowOpen() {
  return inspectWindow.window != null && !inspectWindow.window.isDestroyed();
}

/** Close the cut-results window without touching the source window or the manifest. */
export function closePatchClipsWindow() {
  closeResultsWindow(cutResultsWindow);
}

/** Close the merged-result window without touching the source window or the manifest. */
export function closePatchMergedWindow() {
  closeResultsWindow(mergedResultWindow);
}

/**
Follow a theme change in the results windows.

Their renderer paints itself from `prefers-color-scheme`, but the window background is what shows
before the first paint (and behind a reload), so it is set from the same value the main window uses.
*/
export function setPatchResultsWindowsBackgroundColor(color: string) {
  for (const state of resultsWindows) {
    if (state.window != null && !state.window.isDestroyed()) state.window.setBackgroundColor(color);
  }
}

/**
The results windows belong to the cutting window: closing the source closes them.

Closing a results window never closes the source: `closed` only clears that window's own state.
*/
export function linkPatchResultsWindowsToMain(mainWindow: BrowserWindow) {
  mainWindow.on('closed', () => {
    closePatchClipsWindow();
    closePatchMergedWindow();
    closePatchInspectWindow();
  });
}

function unloadResultsWindow(state: ResultsWindowState) {
  if (state.window == null || state.window.isDestroyed() || !state.ready) return;
  try {
    state.window.webContents.send(patchPlayerReleaseChannel);
  } catch (err) {
    logger.error('Failed to ask a results window to release its video', err);
  }
}

/**
Release the file the player is holding, without closing the window.

Windows keeps a file locked while Chromium plays it, so an export that renames or regenerates a
result would fail. The player unloads its video (the window stays exactly where it is) and
reloads the current result from the next playlist the export pushes.
*/
export function unloadPatchPlayerWindow() {
  unloadResultsWindow(cutResultsWindow);
}

/** Release the merged result the merged-result window is playing (it is about to be replaced). */
export function unloadPatchMergedWindow() {
  unloadResultsWindow(mergedResultWindow);
}

/**
Release the file the check player plays, without closing the window.

An export, a finish job or a delete unlinks or moves sources; Windows refuses that while Chromium
holds the file open. The window keeps its place and gets its file back from the playlist once the
job is over (see `resendPatchResultsPlaylists`).
*/
export function unloadPatchInspectWindow() {
  unloadResultsWindow(inspectWindow);
}

/**
Open the player after an export, but only in patch mode and only when the user wants it.

"Open the player after export" off means the window is not opened or raised. A window the user
keeps open still receives the new playlist: the export released its video, so it would otherwise
sit there without one (see `unloadPatchPlayerWindow`).
*/
export function maybeOpenPatchPlayerWindow(entries: PatchCutResultEntry[] | undefined, mainBounds?: PatchWindowBounds | undefined) {
  if (entries == null || entries.length === 0 || (configStore.get('entryMode') !== 'patch')) return;
  if (!patchConfig.getPatchSetting('autoOpenPlayer')) {
    openResultsWindow(cutResultsWindow, entries, mainBounds, false);
    return;
  }
  openPatchPlayerWindow(entries, mainBounds);
}

function findResultsWindowBySender(sender: unknown) {
  return resultsWindows.find((candidate) => candidate.window != null && sender === candidate.window.webContents);
}

/**
Which results window sent this IPC message, if any.

Only a results window may tell the cutting window to pause its source (and pause the other
results window), so a stray message from another renderer cannot stop the preview.
*/
export function getPatchResultsWindowKindBySender(sender: unknown): PatchResultsWindowKind | undefined {
  return findResultsWindowBySender(sender)?.kind;
}

/**
Apply a rename that happened on disk to the playlist copies of the results windows.

The rename itself is done by the main process (see `features/patchExport/renameResult`), so the
copies the main process keeps have to follow it, or a later playlist push would resurrect the old
path.
*/
export function updateResultsWindowPlaylistPaths({ from, to, label }: { from: string, to: string, label?: string | undefined }) {
  for (const state of resultsWindows) {
    state.playlist = replaceResultPath(state.playlist, from, to, label);
  }
}

/**
Push the playlists of the open results windows again (fork-owned).

The finish job unloads both players before it moves their files, so the windows survive a job that
stops halfway - but they survive *blank*: the video was released to unlock the file. Sending the
playlist again is the existing "reload the result that was playing" path (see
`common/features/patchPlayer/playlist`). A result the stopped job already moved or deleted is left
out instead of being reloaded from a path that no longer exists.
*/
export async function resendPatchResultsPlaylists({ exists }: { exists: (path: string) => Promise<boolean> }) {
  await Promise.all(resultsWindows.map(async (state) => {
    if (state.window == null || state.window.isDestroyed() || !state.ready) return;
    const checked = await Promise.all(state.playlist.map(async (entry) => (
      await exists(entry.path) ? entry : undefined
    )));
    const entries = checked.filter((entry): entry is PatchCutResultEntry => entry != null);
    state.playlist = entries;
    // An empty playlist leaves the window as it is (blank): there is nothing to reload.
    if (entries.length > 0) sendPlaylist(state);
  }));
}

/** Register the results-window listeners (called once from the main process setup). */
export function initPatchPlayerWindow() {
  ipcMain.on(patchPlayerReadyChannel, (event) => {
    const state = findResultsWindowBySender(event.sender);
    if (state == null) return;
    state.ready = true;
    // The window mounted: the load watchdog has done its job.
    clearLoadWatchdog(state);
    logger.info('A patch results window is ready, sending the playlist', state.kind);
    sendPlaylist(state);
  });
}
