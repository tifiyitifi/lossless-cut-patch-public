import { existsSync } from 'node:fs';
// eslint-disable-next-line import-js/no-extraneous-dependencies
import { ipcMain } from 'electron';

import { patchWindowPathChannel } from '../../../common/features/patchWork/index.js';
import { resolveWorkRootForPath } from '../../../common/features/patchFinish/index.js';
import { isSamePath } from '../../../common/features/patchFinish/paths.js';
import * as configStore from '../../configStore.js';
import * as patchConfig from '../patch/patchConfig.js';
import getConfiguredPatchDirNames from './dirNames.js';
import { getPatchFinishDirs, getPatchWorkDirs } from './workDirs.js';

/**
The video each window is showing (fork-owned).

The native context menu is built by the main process, which otherwise does not know which file a
window has open. Every window reports its current path; the menu then offers "Open the work
folder" for that video's work root.
*/
const windowPaths = new Map<number, string>();
const trackedSenders = new Set<number>();

export function initPatchWindowPaths() {
  ipcMain.on(patchWindowPathChannel, (event, path: unknown) => {
    const { id } = event.sender;
    if (typeof path === 'string' && path.trim() !== '') windowPaths.set(id, path);
    else windowPaths.delete(id);

    if (!trackedSenders.has(id)) {
      trackedSenders.add(id);
      event.sender.once('destroyed', () => {
        windowPaths.delete(id);
        trackedSenders.delete(id);
      });
    }
  });
}

/**
Is one of this app's windows showing this file?

The detached-source check may not delete a file another window has open: on Windows the unlink
fails anyway, and the user would only see a "still in use" report. Every window reports the video it
shows (see `initPatchWindowPaths`), so the answer is a path comparison, not a file-system probe.
*/
export function isPatchPathOpenInAnyWindow(path: string, { caseInsensitive }: { caseInsensitive: boolean }) {
  for (const shown of windowPaths.values()) {
    if (isSamePath(shown, path, { caseInsensitive })) return true;
  }
  return false;
}

/** The work area of the video the window shows, or its chosen work root before it exists. */
export function getPatchWindowWorkDir(webContentsId: number): string | undefined {
  if (configStore.get('entryMode') !== 'patch') return undefined;
  const videoPath = windowPaths.get(webContentsId);
  if (videoPath == null) return undefined;

  const configuredRoot = patchConfig.getPatchSetting('workRoot');
  const dirNames = getConfiguredPatchDirNames();
  const workRoot = resolveWorkRootForPath({ path: videoPath, workRoot: configuredRoot, dirNames });
  const workDir = workRoot != null ? getPatchWorkDirs(workRoot, dirNames)?.workDir : undefined;
  if (workDir != null && existsSync(workDir)) return workDir;
  // Before the first export the work area does not exist yet: lead to the root the user chose (not
  // to the video's own folder, which is only the fallback when no working directory is set).
  return configuredRoot != null && configuredRoot.trim() !== '' && existsSync(configuredRoot) ? configuredRoot : undefined;
}

/** The stage folders the source window's context menu offers (fork-owned). */
export interface PatchWindowAreas {
  /** The work area itself. */
  workDir: string | undefined;
  /** `<work>/detached_src_media`: sources waiting for deletion. */
  detachedSrcMediaDir: string | undefined;
  /** `<finished>/finished_merged`: finished merged results. */
  finishedMergedDir: string | undefined;
  /** `<finished>/finished_clips`: finished cut results. */
  finishedClipsDir: string | undefined;
}

/**
The folders of the video the window shows (fork-owned).

Unlike `getPatchWindowWorkDir`, this reports every stage folder of the same work root, so the source
window's menu can lead to what the user keeps and to what is waiting for deletion. It does not check
whether the folders exist: a menu entry that leads nowhere is disabled by the caller.
*/
export function getPatchWindowAreas(webContentsId: number): PatchWindowAreas | undefined {
  if (configStore.get('entryMode') !== 'patch') return undefined;
  const videoPath = windowPaths.get(webContentsId);
  if (videoPath == null) return undefined;

  const configuredRoot = patchConfig.getPatchSetting('workRoot');
  const dirNames = getConfiguredPatchDirNames();
  const workRoot = resolveWorkRootForPath({ path: videoPath, workRoot: configuredRoot, dirNames });
  const dirs = getPatchFinishDirs(workRoot, dirNames);
  return {
    workDir: dirs?.workDir,
    detachedSrcMediaDir: dirs?.detachedSrcMediaDir,
    finishedMergedDir: dirs?.finishedMergedDir,
    finishedClipsDir: dirs?.finishedClipsDir,
  };
}
