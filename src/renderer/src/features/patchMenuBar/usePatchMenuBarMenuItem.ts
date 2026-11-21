import type { MenuItemConstructorOptions } from 'electron';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { KeyBinding } from '../../../../common/types';
import mainApi from '../../mainApi';
import type { KeyboardLayoutMap } from '../../types';
import { formatKeybinding, isMac } from '../../util';
import { pickMenuBarKey } from './keyHint';

/** Used until the keyboard layout map loads; the formatter then uses its static key names. */
const emptyKeyboardLayoutMap: KeyboardLayoutMap = new Map();

/**
The "show/hide the app menu bar" context-menu entry (fork-owned).

Patch mode keeps the native menu bar hidden, so a bare Alt cannot take the focus away from the
cutting keys; `Alt+Q` toggles it. The right-click menus on the video and on the start screen offer
the same toggle, so it is reachable without the keyboard. The hint follows the user's bindings (and
the keyboard layout when one is passed); a native menu item can only show a plain string, not a key
cap.
*/
export default function usePatchMenuBarMenuItem({
  keyBindings,
  keyboardLayoutMap,
}: {
  keyBindings: readonly KeyBinding[];
  keyboardLayoutMap?: KeyboardLayoutMap | undefined;
}) {
  const { t } = useTranslation();

  const keys = useMemo(() => {
    const bindingKeys = pickMenuBarKey(keyBindings, { preferMetaKey: isMac });
    return bindingKeys != null ? formatKeybinding(bindingKeys, keyboardLayoutMap ?? emptyKeyboardLayoutMap) : undefined;
  }, [keyBindings, keyboardLayoutMap]);

  const toggle = useCallback(() => {
    mainApi.patchToggleMenuBar().catch((err: unknown) => { console.error('Failed to toggle the menu bar', err); });
  }, []);

  return useMemo<MenuItemConstructorOptions>(() => ({
    label: keys != null
      ? t('Show/hide the menu bar ({{keys}})', { keys })
      : t('Show/hide the app menu bar'),
    click: toggle,
  }), [keys, t, toggle]);
}
