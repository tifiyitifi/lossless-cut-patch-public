import { Theme } from '@radix-ui/themes';
import { useEffect, useState } from 'react';

import {
  patchDetachableReadyChannel,
  patchDetachableRootChannel,
  patchDetachableRootQueryParam,
} from '../../../../common/features/patchDeletable';
import PatchDetachableCheckPanel from './PatchDetachableCheckPanel';
import useAppTheme from './useAppTheme';
import SwalContainer from '../../components/SwalContainer';

/**
The window shell of the detached-source check (fork-owned).

The window is opened with the work root it shows (`?patchDetachableCheck=1&patchDetachableRoot=…`).
When the user opens the check of another folder while this window exists, the main process reuses the
window and sends the new root instead of creating a second one; the ready message covers the race
where that message arrives before this module mounted.

The same `<Theme>` wrapper the main window uses is mounted here (`useAppTheme` explains how the
theme is resolved), so the panel follows the app's light/dark setting instead of painting its own
colours.

The root node also carries the two things every upstream window root provides: the `#app-root` id
that `Dialog.Portal` mounts into, and the `dark-theme` class that the upstream `Dialog`, `Select` and
swal styles switch their dark variants on. Without them a dialog would be portalled to
`document.body` - outside `<Theme>`, where the Radix color variables (and every `--gray-*` used here)
are undefined - and would render unthemed. `SwalContainer` is the toast target for the same reason.
*/

const { ipcRenderer } = window.require('electron');

function readInitialRoot() {
  const root = new URLSearchParams(window.location.search).get(patchDetachableRootQueryParam);
  return root == null || root.trim() === '' ? undefined : root;
}

export default function PatchDetachableCheckApp() {
  const [root, setRoot] = useState<string | undefined>(readInitialRoot);
  const darkMode = useAppTheme();

  useEffect(() => {
    const onRoot = (_event: unknown, value: unknown) => {
      if (typeof value === 'string' && value.trim() !== '') setRoot(value);
    };
    ipcRenderer.on(patchDetachableRootChannel, onRoot);
    // The main process may have switched the root while this window was still loading.
    ipcRenderer.send(patchDetachableReadyChannel);
    return () => { ipcRenderer.off(patchDetachableRootChannel, onRoot); };
  }, []);

  return (
    <Theme appearance={darkMode ? 'dark' : 'light'} accentColor="cyan">
      <div
        id="app-root"
        className={darkMode ? 'dark-theme' : undefined}
        style={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          color: 'var(--gray-12)',
          background: 'var(--gray-1)',
          colorScheme: darkMode ? 'only dark' : 'only light',
        }}
      >
        {/* The panel's state (selection, the last delete's report) belongs to one work root:
            switching folders remounts it instead of carrying the previous folder's summary over. */}
        <PatchDetachableCheckPanel key={root ?? ''} root={root} />
        <SwalContainer darkMode={darkMode} />
      </div>
    </Theme>
  );
}
