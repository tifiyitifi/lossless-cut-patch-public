import type { BrowserWindow, MenuItemConstructorOptions } from 'electron';
// eslint-disable-next-line import-js/no-extraneous-dependencies
import { Menu, shell } from 'electron';
import { t } from 'i18next';

import { getPatchWindowAreas, getPatchWindowWorkDir } from './features/patchWork/windowPaths.js';
import logger from './logger.js';

// menu-safe i18n.t (the same escaping the application menu uses):
// https://github.com/mifi/lossless-cut/issues/1456
const esc = (val: string) => val.replaceAll('&', '&&');

const openFolder = (dir: string) => {
  shell.openPath(dir).catch((err: unknown) => { logger.error('Failed to open a folder', err); });
};

// https://github.com/electron/electron/issues/4068#issuecomment-274159726
// patch: the old `patchSourceWindow` option is gone: every patch window offers the same combined
// work-folders dialog now, and `attachContextMenu` callers no longer have to say which one it is.
export default (window: BrowserWindow) => {
  window.webContents.on('context-menu', (_e, props) => {
    const { selectionText, isEditable } = props;
    const template: MenuItemConstructorOptions[] = [];

    // patch: open the work folder of the video this window shows (patch mode only; the main process
    // knows the path because every window reports its current file).
    const workDir = getPatchWindowWorkDir(window.webContents.id);
    // patch: the work area of the video this window shows (every patch window reports its current
    // file, so the results windows know it too).
    const areas = getPatchWindowAreas(window.webContents.id);

    // patch: every patch window with a video reaches the combined work-folder dialog: the source
    // window's history, and the work root of the file it shows. The results windows used to have no
    // mouse entry at all.
    if (areas != null) {
      template.push(
        { label: esc(t('Work folders and results...')), click: () => { window.webContents.send('openPatchWorkPathList'); } },

        // The stage folders used to be opened from here. They are replaced by the work-folder
        // dialog, which groups the sources with their results and opens the folders from its
        // buttons. The block is kept verbatim so it can be brought back; it needs `existsSync` from
        // `node:fs` again when it is re-enabled:
        //
        // const workAreaExists = areas.workDir != null && existsSync(areas.workDir);
        // if (workAreaExists) {
        //   const pushFolder = (label: string, dir: string | undefined) => {
        //     template.push({ label: esc(t(label)), enabled: dir != null && existsSync(dir), click: () => { if (dir != null) openFolder(dir); } });
        //   };
        //   pushFolder(t('Open the videos waiting for deletion'), areas.detachedSrcMediaDir);
        //   pushFolder(t('Open the finished merged results'), areas.finishedMergedDir);
        //   pushFolder(t('Open the finished cut results'), areas.finishedClipsDir);
        //   if (workDir != null) template.push({ type: 'separator' });
        // }
      );
    }

    if (areas != null && workDir != null) template.push({ type: 'separator' });

    if (workDir != null) {
      template.push({
        label: esc(t('Open the work folder')),
        click: () => { openFolder(workDir); },
      });
    }

    if (isEditable) {
      if (template.length > 0) template.push({ type: 'separator' });
      template.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' });
    } else if (selectionText != null && selectionText.trim() !== '') {
      if (template.length > 0) template.push({ type: 'separator' });
      template.push({ role: 'copy' }, { type: 'separator' }, { role: 'selectAll' });
    }

    // Nothing to offer (base mode without a selection): keep the upstream behaviour (no menu).
    if (template.length === 0) return;
    Menu.buildFromTemplate(template).popup({ window });
  });
};
