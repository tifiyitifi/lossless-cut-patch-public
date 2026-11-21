import type { MenuItemConstructorOptions } from 'electron';
import type { RefObject } from 'react';
import { useEffect, useMemo } from 'react';

import useNativeMenu from '../../hooks/useNativeMenu';
import type { ContextMenuTemplate } from '../../types';

import usePatchFileActions from './usePatchFileActions';

/**
A native right-click menu on a file-backed element (fork-owned).

`targetRef` is the element the menu belongs to (a list row, the video, ...); `path` is the file
the menu acts on. The listener is only attached while there is a path to act on (and while
`enabled`), so base mode keeps its previous right-click behavior unchanged.

`extraItem` is appended below the file actions as its own group. The video uses it for the
patch-mode menu-bar toggle; the other callers leave it out and keep their menu byte-identical.
*/
export default function usePatchFileContextMenu<T extends HTMLElement>({ targetRef, path, enabled = true, extraItem }: {
  targetRef: RefObject<T | null>;
  path: string | undefined;
  enabled?: boolean;
  extraItem?: MenuItemConstructorOptions | undefined;
}) {
  const { getFileMenuItems } = usePatchFileActions();

  const template = useMemo<ContextMenuTemplate>(() => {
    if (!enabled || path == null) return [];
    const items = getFileMenuItems(path);
    return extraItem == null ? items : [...items, { type: 'separator' as const }, extraItem];
  }, [enabled, path, getFileMenuItems, extraItem]);
  const { openMenu } = useNativeMenu(template);

  useEffect(() => {
    const el = targetRef.current;
    if (el == null || template.length === 0) return undefined;

    const handleContextMenu = (e: MouseEvent) => {
      // Stop Chromium's default menu from appearing next to ours.
      e.preventDefault();
      openMenu(e);
    };

    el.addEventListener('contextmenu', handleContextMenu);
    return () => el.removeEventListener('contextmenu', handleContextMenu);
  }, [openMenu, targetRef, template]);
}
