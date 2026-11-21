import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { DialogButton } from '../../components/Button';
import Checkbox from '../../components/Checkbox';
import * as Dialog from '../../components/Dialog';
import { getPathFileName } from '../../../../common/features/patchFinish';
import type { PatchFinishDiscardResultsChoice, PatchFinishPreview } from '../../../../common/features/patchFinish';
import { matchesKeyBinding } from '../patch/keyMatch';

/**
The discard confirmation (`Ctrl+Delete`, fork-owned).

It asks two independent questions:

- whether the video really goes to the waiting-for-deletion folder (`Do not ask again before
  discarding` writes `confirmDiscardSource`);
- what happens to the results it already has, an exclusive radio that defaults to a permanent delete
  (`Remember this choice...` writes `discardResultsAction`).

The radio only appears while the setting is `ask`; a remembered choice runs without it and the
summary above it still says what will happen. Pressing `Ctrl+Delete` again confirms, like the finish
dialogs.
*/
export default function DiscardSourceDialog({ isShown, preview, results, showResultsChoice, hasResults, busy, error, discardKey, rememberResults, confirmSource, onResultsChange, onRememberResultsChange, onConfirmSourceChange, onConfirm, onCancel, onOpenCutResultsFolder, onOpenMergedFolder }: {
  isShown: boolean;
  preview: PatchFinishPreview;
  results: PatchFinishDiscardResultsChoice;
  showResultsChoice: boolean;
  hasResults: boolean;
  busy: boolean;
  error: string | undefined;
  discardKey: string | undefined;
  rememberResults: boolean;
  confirmSource: boolean;
  onResultsChange: (results: PatchFinishDiscardResultsChoice) => void;
  onRememberResultsChange: (value: boolean) => void;
  onConfirmSourceChange: (value: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onOpenCutResultsFolder: () => void;
  onOpenMergedFolder: () => void;
}) {
  const { t } = useTranslation();

  // The dialog has the focus, so the upstream keyboard hook (which only runs on `document.body`)
  // would not see the key that opened it. Listening in the capture phase makes `Ctrl+Delete` confirm.
  useEffect(() => {
    if (!isShown) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || busy || !matchesKeyBinding(event, discardKey)) return;
      event.preventDefault();
      event.stopPropagation();
      onConfirm();
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => { window.removeEventListener('keydown', onKeyDown, { capture: true }); };
  }, [busy, discardKey, isShown, onConfirm]);

  const sourceName = getPathFileName(preview.source.path);
  const mergedName = preview.merged != null ? getPathFileName(preview.merged.path) : undefined;

  return (
    <Dialog.Root open={isShown} onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ width: '38em' }} aria-describedby={undefined}>
          <Dialog.Title>{t('Discard this video?')}</Dialog.Title>

          <div>{t('{{name}} moves to the waiting-for-deletion folder. The source is kept, so it can be cut again.', { name: sourceName })}</div>
          <div style={{ marginTop: '.2em', fontSize: '.9em', color: 'var(--gray-11)', wordBreak: 'break-all' }}>
            <code>{preview.dirs.detachedSrcMediaDir}</code>
          </div>

          {hasResults && (
            <section style={{ marginTop: '1em', paddingTop: '.7em', borderTop: '1px solid var(--gray-6)' }}>
              <div style={{ fontWeight: 'bold', marginBottom: '.3em' }}>{t('The video already has results')}</div>
              {preview.clips.length > 0 && (
                <div>{t('{{count}} cut result(s)', { count: preview.clips.length })}</div>
              )}
              {mergedName != null && (
                <div style={{ wordBreak: 'break-all' }}>{t('Merged result: {{name}}', { name: mergedName })}</div>
              )}

              {showResultsChoice && (
                <div style={{ marginTop: '.6em' }}>
                  <div style={{ display: 'flex', gap: '.45em', alignItems: 'flex-start', margin: '.25em 0' }}>
                    <input id="patch-discard-results-delete" type="radio" name="patch-discard-results" checked={results === 'delete'} disabled={busy} onChange={() => onResultsChange('delete')} style={{ marginTop: '.25em' }} />
                    <label htmlFor="patch-discard-results-delete" style={{ cursor: 'pointer' }}>{t('Delete them permanently')}</label>
                  </div>
                  <div style={{ display: 'flex', gap: '.45em', alignItems: 'flex-start', margin: '.25em 0' }}>
                    <input id="patch-discard-results-detached" type="radio" name="patch-discard-results" checked={results === 'detached'} disabled={busy} onChange={() => onResultsChange('detached')} style={{ marginTop: '.25em' }} />
                    <label htmlFor="patch-discard-results-detached" style={{ cursor: 'pointer' }}>{t('Move them to the waiting-for-deletion folder')}</label>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5em', marginTop: '.7em' }}>
                <DialogButton disabled={busy} onClick={onOpenCutResultsFolder}>{t('Open the cut results folder')}</DialogButton>
                {preview.merged != null && (
                  <DialogButton disabled={busy} onClick={onOpenMergedFolder}>{t('Open the merged result folder')}</DialogButton>
                )}
              </div>
            </section>
          )}

          <div style={{ marginTop: '1em' }}>
            {showResultsChoice && (
              <div style={{ marginBottom: '.4em' }}>
                <Checkbox checked={rememberResults} onCheckedChange={(value) => onRememberResultsChange(value === true)} disabled={busy} label={t('Remember this choice and do not ask again')} />
              </div>
            )}
            <Checkbox checked={confirmSource} onCheckedChange={(value) => onConfirmSourceChange(value === true)} disabled={busy} label={t('Do not ask again before discarding')} />
          </div>

          {error != null && (
            <div style={{ marginTop: '.8em', color: 'var(--red-11)', whiteSpace: 'pre-wrap' }}>{error}</div>
          )}

          <Dialog.ButtonRow>
            <DialogButton disabled={busy} onClick={onCancel}>{t('Cancel')}</DialogButton>
            <DialogButton primary disabled={busy} onClick={onConfirm}>{busy ? t('Discarding the video...') : t('Discard')}</DialogButton>
          </Dialog.ButtonRow>

          <Dialog.CloseButton />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
