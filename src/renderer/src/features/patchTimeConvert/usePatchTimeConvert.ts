import { useCallback, useEffect, useMemo, useState } from 'react';

const { ipcRenderer } = window.require('electron');

/** The menu channel `Tools -> Time convert...` sends on (patch mode only). */
export const patchTimeConvertChannel = 'openPatchTimeConvert';

/**
The time converter's open state (fork-owned).

It has two entry points - the `Tools` menu item and the console command `opentimeconvert` - so the
state lives here rather than inside the dialog: both open the same dialog of the cutting window.

The result is memoized: the app's action map depends on it, and a new object on every render would
rebuild that whole map (and every action's identity) on every keystroke elsewhere.
*/
export default function usePatchTimeConvert() {
  const [isShown, setIsShown] = useState(false);

  const open = useCallback(() => setIsShown(true), []);
  const close = useCallback(() => setIsShown(false), []);

  // The menu item is handled by the main process (see `main/menu.ts`), so it arrives as IPC. The
  // results windows render their own copy of the app but never get the menu event: it is sent to
  // the main window only.
  useEffect(() => {
    const onOpen = () => setIsShown(true);
    ipcRenderer.on(patchTimeConvertChannel, onOpen);
    return () => { ipcRenderer.off(patchTimeConvertChannel, onOpen); };
  }, []);

  return useMemo(() => ({ isShown, open, close }), [close, isShown, open]);
}
