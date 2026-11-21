import type { RefObject } from 'react';
import { useCallback, useEffect } from 'react';

import useNativeMenu from './useNativeMenu';
import type { ContextMenuTemplate } from '../types';


// https://github.com/transflow/use-electron-context-menu
export default function useContextMenu(
  ref: RefObject<HTMLElement | null>,
  template: ContextMenuTemplate,
  // patch: the merged window's read-only chapters have no context menu.
  enabled = true,
  // patch: an element with its own menu must cancel the default. Otherwise the main process also
  // pops its context menu (`src/main/contextMenu.ts`: the work-folder entries in patch mode) over
  // this one, which is how a list row's menu lost its actions while the list's empty area kept
  // them. Base mode leaves the default alone.
  preventDefault = false,
) {
  const { openMenu, closeMenu } = useNativeMenu(template);

  const open = useCallback((e: MouseEvent) => {
    if (!enabled) return;
    if (preventDefault) e.preventDefault();
    openMenu(e);
  }, [enabled, openMenu, preventDefault]);

  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.addEventListener('contextmenu', open);
      return () => el.removeEventListener('contextmenu', open);
    }
    return undefined;
  }, [open, ref]);

  return { closeMenu };
}
