import { useEffect, useState } from 'react';

import type { KeyBinding } from '../../../../../common/types';
import KnownIssuesDialog from './KnownIssuesDialog';

const { ipcRenderer } = window.require('electron');

/**
The `Help` → `Known issues` entry (fork-owned).

The menu only sends a channel, like the other patch dialogs; the dialog is mounted in the cutting
window so it works whether a file is open or the landing page is showing. The results windows have
no such entry (their menu has no patch jobs).
*/
export default function PatchKnownIssues({ keyBindings }: {
  keyBindings: readonly KeyBinding[];
}) {
  const [isShown, setIsShown] = useState(false);

  useEffect(() => {
    const onOpen = () => setIsShown(true);
    ipcRenderer.on('openPatchKnownIssues', onOpen);
    return () => { ipcRenderer.off('openPatchKnownIssues', onOpen); };
  }, []);

  return (
    <KnownIssuesDialog
      isShown={isShown}
      onHide={() => setIsShown(false)}
      keyBindings={keyBindings}
    />
  );
}
