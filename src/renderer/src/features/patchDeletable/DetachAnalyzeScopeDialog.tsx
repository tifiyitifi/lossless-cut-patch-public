import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { PatchDetachAnalyzeScope } from '../../../../common/features/patchDeletable';
import type { PatchDetachGridItemKind } from '../../../../common/features/patchDeletable/grid';
import { DialogButton } from '../../components/Button';
import * as Dialog from '../../components/Dialog';

/**
What a column's deep check should scan when nothing is selected (fork-owned).

The header button belongs to one column, so the dialog opens on that column, but the user is free to
scan the other one or both - a check with no selection is a check of everything the user meant, and
guessing wrong would decode hundreds of files. A choice with zero files is disabled; the Scan button
is never a no-op.
*/
export default function DetachAnalyzeScopeDialog({ kind, sourceCount, resultCount, onCancel, onScan }: {
  kind: PatchDetachGridItemKind;
  sourceCount: number;
  resultCount: number;
  onCancel: () => void;
  onScan: (scope: PatchDetachAnalyzeScope) => void;
}) {
  const { t } = useTranslation();
  const [scope, setScope] = useState<PatchDetachAnalyzeScope>(kind === 'source' ? 'sources' : 'results');

  const options: { id: PatchDetachAnalyzeScope; label: string; count: number }[] = [
    { id: 'sources', label: t('All sources ({{count}})', { count: sourceCount }), count: sourceCount },
    { id: 'results', label: t('All results ({{count}})', { count: resultCount }), count: resultCount },
    { id: 'everything', label: t('Everything ({{count}})', { count: sourceCount + resultCount }), count: sourceCount + resultCount },
  ];
  const canScan = options.some((option) => option.id === scope && option.count > 0);

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ width: '32em' }} aria-describedby={undefined}>
          <Dialog.Title>{t('Nothing is selected')}</Dialog.Title>
          <Dialog.Description>{t('No file is selected. Choose what to check:')}</Dialog.Description>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '.25em', marginTop: '.6em' }}>
            {options.map((option) => {
              const disabled = option.count === 0;
              return (
                <label
                  key={option.id}
                  htmlFor={`detach-analyze-scope-${option.id}`}
                  style={{ display: 'flex', gap: '.45em', alignItems: 'center', padding: '.2em 0', opacity: disabled ? 0.45 : 1, cursor: disabled ? 'default' : 'pointer' }}
                >
                  <input
                    id={`detach-analyze-scope-${option.id}`}
                    type="radio"
                    name="detach-analyze-scope"
                    checked={scope === option.id}
                    disabled={disabled}
                    onChange={() => { setScope(option.id); }}
                  />
                  <span>{option.label}</span>
                </label>
              );
            })}
          </div>

          <Dialog.ButtonRow>
            <DialogButton onClick={onCancel}>{t('Cancel')}</DialogButton>
            <DialogButton
              primary
              disabled={!canScan}
              onClick={() => { onScan(scope); }}
            >
              {t('Start check')}
            </DialogButton>
          </Dialog.ButtonRow>

          <Dialog.CloseButton />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
