import type { MenuItemConstructorOptions } from 'electron';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { showItemInFolder } from '../../util';
import getSwal from '../../swal';
import { usePatchWork } from '../patchWork/PatchWorkProvider';

const { dirname } = window.require('node:path');

/**
"Locate this file on disk" actions for patch-mode context menus (fork-owned).

Both cross-process calls already exist, so this only wires them into menu items:
- `showFileInFolder` uses the upstream `showItemInFolder` IPC and opens the file manager with
  the file selected (Explorer's "Open file location").
- `openContainingFolder` uses the fork's `patchOpenFolder` RPC and opens the folder itself.
- `openWorkFolder` asks the main process for the video's work area (`<root>/.losslesscut_work`),
  which is where the cut results and the merged result live.
- `openWorkPathList` opens the combined "Work folders and results" dialog, the same one the File
  menu and the landing page open, so every patch-mode right-click can reach it (also after the
  last source has been finished and moved into the work area).
*/
export default function usePatchFileActions() {
  const { t } = useTranslation();
  const patchWork = usePatchWork();

  // patch: the dialog lives in the renderer (`features/patchWork`), so no IPC is needed here. The
  // setter is stable; the provider object itself is not, so depend on the setter only.
  const setWorkPathListVisible = patchWork?.setWorkPathListVisible;
  const openWorkPathList = useCallback(() => {
    setWorkPathListVisible?.(true);
  }, [setWorkPathListVisible]);

  // patch: one definition of the entry, so every menu that offers it says the same thing.
  const getWorkPathListItem = useCallback((): MenuItemConstructorOptions => ({
    label: t('Work folders and results...'),
    click: openWorkPathList,
  }), [openWorkPathList, t]);

  const showFileInFolder = useCallback((path: string) => {
    showItemInFolder(path).catch((err) => {
      console.error('Failed to show the file in the file manager', err);
    });
  }, []);

  const openContainingFolder = useCallback((path: string) => {
    window.electron.patchOpenFolder(dirname(path)).catch((err) => {
      console.error('Failed to open the containing folder', err);
    });
  }, []);

  const openWorkFolder = useCallback((path: string) => {
    window.electron.patchOpenWorkFolderForPath(path)
      .then((result) => {
        if (!result.ok) getSwal().toast.fire({ icon: 'info', text: t('This video has no work folder yet.') });
      })
      .catch((err: unknown) => {
        console.error('Failed to open the work folder', err);
      });
  }, [t]);

  const getFileMenuItems = useCallback((path: string): MenuItemConstructorOptions[] => [
    getWorkPathListItem(),
    { type: 'separator' },
    { label: t('Show file in folder'), click: () => { showFileInFolder(path); } },
    { label: t('Open containing folder'), click: () => { openContainingFolder(path); } },
    { type: 'separator' },
    { label: t('Open the work folder'), click: () => { openWorkFolder(path); } },
  ], [getWorkPathListItem, t, showFileInFolder, openContainingFolder, openWorkFolder]);

  return { showFileInFolder, openContainingFolder, openWorkFolder, openWorkPathList, getWorkPathListItem, getFileMenuItems };
}
