import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import * as Dialog from '../../components/Dialog';
import { DialogButton } from '../../components/Button';
import TextInput from '../../components/TextInput';

/**
Rename dialog of the player window (fork-owned).

`label` edits the segment label; the file name is then re-rendered from the stored name template
(so it always follows the template, no file name parsing). `full` replaces the whole file name
outside the template. Mounted only while a request is open, so its state starts from the default.
*/
export default function PatchRenameDialog({ kind, defaultValue, onSubmit, onClose }: {
  kind: 'label' | 'full',
  defaultValue: string,
  /** Returns an error message to show in the dialog, or `undefined` when the caller closed it. */
  onSubmit: (value: string) => Promise<string | undefined>,
  onClose: () => void,
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ width: '34em' }} aria-describedby={undefined}>
          <Dialog.Title>{t(kind === 'label' ? 'Rename result label' : 'Rename result file')}</Dialog.Title>
          <Dialog.Description>
            {t(kind === 'label' ? 'The file name is generated from the name template with the new label.' : 'Enter the new file name, without the extension.')}
          </Dialog.Description>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              setError(undefined);
              onSubmit(value).then((errorMessage) => {
                if (errorMessage != null) setError(errorMessage);
              }).catch((err) => {
                console.error('Failed to rename the cut result', err);
                setError(t('Failed to rename the file'));
              }).finally(() => { setBusy(false); });
            }}
          >
            <div style={{ marginTop: '.8em' }}>
              <TextInput
                autoFocus
                aria-label={t(kind === 'label' ? 'Label' : 'File name')}
                value={value}
                disabled={busy}
                onChange={(e) => setValue(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
              />
            </div>

            {error != null && <div style={{ color: 'var(--red-11)', marginTop: '.5em' }}>{error}</div>}

            <Dialog.ButtonRow>
              <DialogButton disabled={busy} onClick={onClose}>{t('Cancel')}</DialogButton>
              <DialogButton type="submit" primary disabled={busy}>{t('Rename')}</DialogButton>
            </Dialog.ButtonRow>
          </form>

          <Dialog.CloseButton />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
