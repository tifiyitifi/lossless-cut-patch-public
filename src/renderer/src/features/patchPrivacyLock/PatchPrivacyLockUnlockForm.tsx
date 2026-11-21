import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FaLock } from 'react-icons/fa';

import type { PatchHistoryLockReason } from '../../../../common/features/patchPrivacyLock';

import { DialogButton } from '../../components/Button';
import { usePatchPrivacyLock } from './PatchPrivacyLockProvider';

/**
The password prompt of the work-history lock (fork-owned).

It is inline, not a dialog of its own: the current video's work folder and results stay usable
behind it, which is the point of the soft lock. Enter unlocks, Escape closes the prompt without
touching the dialog.
*/
export default function PatchPrivacyLockUnlockForm({ onCancel }: { onCancel: () => void }) {
  const { t } = useTranslation();
  const privacyLock = usePatchPrivacyLock();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<PatchHistoryLockReason | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    if (privacyLock == null || busy || password.trim() === '') return;
    setBusy(true);
    try {
      const result = await privacyLock.unlock(password);
      if (result.ok) {
        setPassword('');
        setError(undefined);
        onCancel();
      } else {
        setError(result.reason);
      }
    } finally {
      setBusy(false);
    }
  }, [busy, onCancel, password, privacyLock]);

  const errorText = (() => {
    switch (error) {
      case 'wrong-password': { return t('That password is not correct.'); }
      case 'unreadable': { return t('The password file could not be read. Delete it to restore the default password.'); }
      case 'unavailable': { return t('The password file is not available.'); }
      case 'empty': { return t('The password cannot be empty.'); }
      case 'too-long': { return t('The password is too long.'); }
      default: { return undefined; }
    }
  })();

  return (
    <div style={{ display: 'flex', gap: '.5em', alignItems: 'center', flexWrap: 'wrap', marginTop: '.6em', padding: '.5em .6em', border: '1px solid var(--gray-6)', borderRadius: '.3em', background: 'var(--gray-3)' }}>
      <FaLock style={{ color: 'var(--gray-11)' }} />
      <input
        // eslint-disable-next-line jsx-a11y/no-autofocus -- the prompt exists to be typed into
        autoFocus
        type="password"
        value={password}
        autoComplete="off"
        spellCheck={false}
        maxLength={200}
        placeholder={t('Password')}
        onChange={(event) => { setPassword(event.target.value); setError(undefined); }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            submit().catch(() => undefined);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
        style={{ minWidth: '14em', flexGrow: 1, padding: '.35em .5em' }}
      />
      <DialogButton primary disabled={busy || password.trim() === ''} onClick={() => { submit().catch(() => undefined); }}>
        {t('Unlock')}
      </DialogButton>
      <DialogButton onClick={onCancel}>{t('Cancel')}</DialogButton>
      {errorText != null && <span style={{ width: '100%', color: 'var(--red-9)', fontSize: '.9em' }}>{errorText}</span>}
    </div>
  );
}
