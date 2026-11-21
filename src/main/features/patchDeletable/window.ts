// eslint-disable-next-line import-js/no-extraneous-dependencies
import { BrowserWindow, app, ipcMain, screen } from 'electron';
import remote from '@electron/remote/main/index.js';
import { join } from 'node:path';
import { t } from 'i18next';

import {
  patchDetachableDeepCheckChannel,
  patchDetachableReadyChannel,
  patchDetachableRootChannel,
  patchDetachableRootQueryParam,
  patchDetachableWindowQueryParam,
} from '../../../common/features/patchDeletable/index.js';
import { getPlayerWindowBounds } from '../../../common/features/patchPlayer/windowBounds.js';
import type { PatchWindowBounds } from '../../../common/features/patchPlayer/windowBounds.js';
import attachContextMenu from '../../contextMenu.js';
import isDev from '../../isDev.js';
import logger from '../../logger.js';
import { getBackgroundColor } from '../../theme.js';

/**
The detached-source check panel (fork-owned).

One window, reused: opening the check of another work root only tells the open panel to switch roots,
so the user keeps one panel instead of one per folder. It is a renderer of its own (not a dialog of
the cutting window) because reviewing a whole folder of sources is a task of its own, and it closes
with the cutting window like the results windows do.

The window never touches the disk itself: it asks the main process for the report, for the deep
decode check and for the delete, exactly like the work-folders dialog asks for the overview.
*/

let panel: BrowserWindow | null = null;
let ready = false;
/** The root the panel shows; sent again on every reopen so a panel created earlier follows. */
let root: string | undefined;
/** A deep decode check cannot outlive the window that shows it (its ffmpeg reads the file). */
const closedHandlers = new Set<() => void>();

function getPreloadPath() {
  return join(app.getAppPath(), 'out', 'preload', 'index.cjs');
}

function isPanelSender(sender: unknown) {
  return panel != null && !panel.isDestroyed() && sender === panel.webContents;
}

/**
Open the check panel for a work root.

An open panel is raised and told the new root; it rescans on that message. Nothing is created when
the root is empty: a check without a folder would only show an empty list.
*/
export function openPatchDetachableWindow({ workRoot, mainBounds }: { workRoot: string; mainBounds?: PatchWindowBounds | undefined }) {
  const trimmed = workRoot.trim();
  if (trimmed === '') return;
  root = trimmed;

  if (panel != null && !panel.isDestroyed()) {
    if (ready) panel.webContents.send(patchDetachableRootChannel, trimmed);
    if (panel.isMinimized()) panel.restore();
    panel.show();
    panel.focus();
    return;
  }

  const windowBounds = mainBounds != null
    ? getPlayerWindowBounds({ mainBounds, workArea: screen.getDisplayMatching(mainBounds).workArea })
    : undefined;

  const win = new BrowserWindow({
    ...(windowBounds ?? { width: 1024, height: 640 }),
    // The grid needs a source column and room for at least one result card next to it; narrower than
    // this the cards would only fit by scrolling sideways, which is what the layout avoids.
    minWidth: 720,
    minHeight: 320,
    backgroundColor: getBackgroundColor(),
    title: t('Deletion check'),
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      webSecurity: !isDev,
      preload: getPreloadPath(),
    },
  });

  panel = win;
  ready = false;

  remote.enable(win.webContents);
  attachContextMenu(win);
  // The app menu drives the cutting window, so it would be confusing here.
  win.setMenuBarVisibility(false);

  win.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    logger.error('The deletion-check panel failed to load', errorCode, errorDescription, validatedURL);
  });

  const query: Record<string, string> = {
    [patchDetachableWindowQueryParam]: '1',
    ...(root != null && { [patchDetachableRootQueryParam]: root }),
  };
  if (isDev) win.loadURL(`http://localhost:3001?${new URLSearchParams(query).toString()}`);
  else win.loadFile('out/renderer/index.html', { query });

  win.on('closed', () => {
    logger.info('The deletion-check panel was closed');
    panel = null;
    ready = false;
    for (const handler of closedHandlers) {
      try {
        handler();
      } catch (err) {
        logger.warn('Failed to run a deletion-check close handler', err);
      }
    }
  });
}

/** Close the panel (the cutting window is closing, or the app quits). */
export function closePatchDetachableWindow() {
  if (panel == null || panel.isDestroyed()) {
    panel = null;
    ready = false;
    return;
  }
  panel.close();
}

/** Is the check panel open? */
export function isPatchDetachableWindowOpen() {
  return panel != null && !panel.isDestroyed();
}

/**
Follow a theme change in the panel.

Its renderer paints itself from `prefers-color-scheme`; the window background only covers the moment
before the first paint, so it gets the same value as the other windows.
*/
export function setPatchDetachableWindowBackgroundColor(color: string) {
  if (panel == null || panel.isDestroyed()) return;
  panel.setBackgroundColor(color);
}

/** Run something when the panel closes (a running deep check is cancelled there). */
export function onPatchDetachableWindowClosed(handler: () => void) {
  closedHandlers.add(handler);
  return () => { closedHandlers.delete(handler); };
}

/** Send a deep-check progress report to the panel (a no-op when it is gone). */
export function sendPatchDetachableDeepCheck(payload: unknown) {
  if (panel == null || panel.isDestroyed()) return;
  try {
    panel.webContents.send(patchDetachableDeepCheckChannel, payload);
  } catch (err) {
    logger.error('Failed to send a deep-check report to the panel', err);
  }
}

/** Register the panel's IPC listeners (called once from the main process setup). */
export function initPatchDetachableWindow() {
  ipcMain.on(patchDetachableReadyChannel, (event) => {
    if (!isPanelSender(event.sender)) return;
    ready = true;
    if (root != null) event.sender.send(patchDetachableRootChannel, root);
  });
}
