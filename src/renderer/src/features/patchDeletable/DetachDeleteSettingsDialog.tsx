import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { patchDetachExtraDeletableReasons } from '../../../../common/features/patchDeletable/deletable';
import type { PatchDetachExtraDeletableReason } from '../../../../common/features/patchDeletable/deletable';
import { DialogButton } from '../../components/Button';
import * as Dialog from '../../components/Dialog';
import { sourceReasonLabel } from './reasonLabels';

/**
Which detached sources the deletion check may delete (fork-owned).

By default only a source with a kept result on disk is deletable, because that is the only proof the
app finished it. This dialog exists for the other kinds: the user can allow them explicitly, one at
a time, and only there does the app delete a source it cannot prove finished. Everything is off by
default, and the permanent-delete button still asks before it removes anything.

The second switch is about the one-click case: with nothing selected, "Delete all" removes only the
sources with a kept result unless the user also allows the extra kinds here. A selection is always
taken literally, extra kinds included.

The general fold restates why this window never offers "move to the recycle bin": neither that nor
moving a file into a folder frees disk space, so the only useful answer is a permanent delete.
*/

const detailsStyle = {
  fontSize: '.82em',
  color: 'var(--gray-11)',
  marginTop: '.15em',
} as const;

const explanationStyle = {
  margin: '.35em 0 0 1.55em',
  lineHeight: 1.4,
} as const;

function Explanation({ children }: { children: string }) {
  return <div style={explanationStyle}>{children}</div>;
}

export default function DetachDeleteSettingsDialog({ extraReasons, includeExtraInAll, onCancel, onSave }: {
  extraReasons: readonly PatchDetachExtraDeletableReason[];
  includeExtraInAll: boolean;
  onCancel: () => void;
  onSave: (next: { extraReasons: PatchDetachExtraDeletableReason[]; includeExtraInAll: boolean }) => void;
}) {
  const { t } = useTranslation();
  const [reasons, setReasons] = useState<ReadonlySet<PatchDetachExtraDeletableReason>>(() => new Set(extraReasons));
  const [includeInAll, setIncludeInAll] = useState(includeExtraInAll);
  const noExtraAllowed = reasons.size === 0;

  const toggleReason = (reason: PatchDetachExtraDeletableReason) => {
    setReasons((previous) => {
      const next = new Set(previous);
      if (next.has(reason)) next.delete(reason);
      else next.add(reason);
      return next;
    });
  };

  const explanation = (reason: PatchDetachExtraDeletableReason) => {
    switch (reason) {
      case 'no-results': {
        return t('The source was moved into the waiting-for-deletion folder without any cut or merged result being recorded. This happens when it was discarded before cutting, or when a finish job removed its results.');
      }
      case 'results-missing': {
        return t('The ledger records results of this source, but the files are no longer on disk. They were moved or deleted by hand or by another program.');
      }
      default: {
        return t('Only results that are themselves waiting for deletion are left. A job parked them but never finished moving the source.');
      }
    }
  };

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ width: '44em', maxHeight: '85vh', overflowY: 'auto' }} aria-describedby={undefined}>
          <Dialog.Title>{t('Deletion settings')}</Dialog.Title>
          <Dialog.Description>{t('Choose which kinds of sources the deletion check may delete for good.')}</Dialog.Description>

          <div style={{ marginTop: '.6em', padding: '.4em .55em', border: '1px solid var(--orange-6)', borderRadius: '.4em', background: 'var(--orange-2)', color: 'var(--orange-11)', fontSize: '.86em' }}>
            {t('These kinds are not proved finished, so none is allowed by default. Deleting a source is permanent and cannot be undone.')}
          </div>

          <details style={{ marginTop: '.6em', fontSize: '.86em' }}>
            <summary style={{ cursor: 'pointer', color: 'var(--gray-11)' }}>{t('Why does this window only delete for good?')}</summary>
            <div style={{ margin: '.4em 0 0 1em', lineHeight: 1.45, color: 'var(--gray-11)', display: 'flex', flexDirection: 'column', gap: '.35em' }}>
              <span>{t('Moving a file into another folder, or deleting it to the recycle bin, does not free disk space: the data stays on the disk until the recycle bin is emptied, and emptying it is a permanent delete too.')}</span>
              <span>{t('So this window only offers permanent deletion. Since neither choice frees space, where the file sits makes no difference; what matters is that it is really gone.')}</span>
              <span>{t('The app only moves source videos into the waiting-for-deletion folder on its own. Deleting one for good happens here, on the sources you select.')}</span>
            </div>
          </details>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '.1em', marginTop: '.7em' }}>
            {patchDetachExtraDeletableReasons.map((reason) => (
              <div key={reason} style={{ padding: '.25em 0', borderTop: '1px solid var(--gray-4)' }}>
                <label
                  htmlFor={`detach-delete-extra-${reason}`}
                  style={{ display: 'flex', gap: '.45em', alignItems: 'center', cursor: 'pointer' }}
                >
                  <input
                    id={`detach-delete-extra-${reason}`}
                    type="checkbox"
                    checked={reasons.has(reason)}
                    onChange={() => { toggleReason(reason); }}
                  />
                  <span>{sourceReasonLabel(reason, t)}</span>
                </label>
                <details style={detailsStyle}>
                  <summary style={{ cursor: 'pointer', marginLeft: '1.55em' }}>{t('Why does this kind of source exist?')}</summary>
                  <Explanation>{explanation(reason)}</Explanation>
                </details>
              </div>
            ))}
          </div>

          <div style={{ marginTop: '.8em', paddingTop: '.55em', borderTop: '1px solid var(--gray-5)' }}>
            <label
              htmlFor="detach-delete-all-includes-extra"
              style={{ display: 'flex', gap: '.45em', alignItems: 'center', cursor: noExtraAllowed ? 'default' : 'pointer', opacity: noExtraAllowed ? 0.5 : 1 }}
            >
              <input
                id="detach-delete-all-includes-extra"
                type="checkbox"
                checked={!noExtraAllowed && includeInAll}
                disabled={noExtraAllowed}
                onChange={(event) => { setIncludeInAll(event.target.checked); }}
              />
              <span>{t('When nothing is selected, "Delete all" also includes these extra sources')}</span>
            </label>
            <div style={{ ...detailsStyle, marginLeft: '1.55em' }}>
              {noExtraAllowed
                ? t('This needs at least one extra kind above.')
                : t('When off, "Delete all" removes only sources that have a kept result; the extra sources are removed only when you select them yourself.')}
            </div>
          </div>

          <Dialog.ButtonRow>
            <DialogButton onClick={onCancel}>{t('Cancel')}</DialogButton>
            <DialogButton
              primary
              onClick={() => {
                onSave({
                  extraReasons: patchDetachExtraDeletableReasons.filter((reason) => reasons.has(reason)),
                  includeExtraInAll: !noExtraAllowed && includeInAll,
                });
              }}
            >
              {t('Save')}
            </DialogButton>
          </Dialog.ButtonRow>

          <Dialog.CloseButton />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
