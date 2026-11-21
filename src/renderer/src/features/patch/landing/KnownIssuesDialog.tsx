import { useTranslation } from 'react-i18next';

import type { KeyBinding } from '../../../../../common/types';
import { DialogButton } from '../../../components/Button';
import * as Dialog from '../../../components/Dialog';
import { KnownIssuesList, usePatchHelpNotes } from './patchHelpNotes';

/**
The known issues dialog (fork-owned).

`Help` → `Known issues` opens it in patch mode, so the notes do not stay buried on the landing page
(where they are only reachable while no file is open). It renders the same list as the landing page
(`usePatchHelpNotes`), with the keys of the window that opened it.
*/
export default function KnownIssuesDialog({ isShown, onHide, keyBindings }: {
  isShown: boolean;
  onHide: () => void;
  keyBindings: readonly KeyBinding[];
}) {
  const { t } = useTranslation();
  const notes = usePatchHelpNotes({ keyBindings });

  return (
    <Dialog.Root open={isShown} onOpenChange={(open) => { if (!open) onHide(); }}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ width: '54em', maxHeight: '86vh', display: 'flex', flexDirection: 'column' }} aria-describedby={undefined}>
          <Dialog.Title>{t('Known issues')}</Dialog.Title>

          <div style={{ flexGrow: 1, minHeight: 0, overflow: 'auto', paddingRight: '.4em', fontSize: '1.02em', lineHeight: 1.6 }}>
            <KnownIssuesList notes={notes} />
          </div>

          <Dialog.ButtonRow>
            <DialogButton primary onClick={onHide}>{t('Close')}</DialogButton>
          </Dialog.ButtonRow>

          <Dialog.CloseButton />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
