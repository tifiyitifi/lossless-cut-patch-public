import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import type { MergedNamePreset } from '../../../../common/features/patchData/mergedName';

import * as Dialog from '../../components/Dialog';
import { isModifierOnlyEvent, isTextEntryTarget, matchesKeyBinding } from '../patch/keyMatch';
import NameRuleEditor from '../patchNameRule/NameRuleEditor';

/**
Name the file the cut results are merged into (fork-owned).

The name comes from a `{token}` rule (see `common/features/patchData/mergedName`), not from a
fixed template: the rule is editable, the chips insert a token, and the preview shows the name
this job gets before anything is written. A rule without a token that always differs renders the
same name every time, so for those the dialog offers the overwrite choice (otherwise the merge
writes a free ` (n)` name next to the file). That choice is about files this app did not write: the
source's own previous merged result is replaced either way, so the dialog says that next to the box
and explains it in the details.
*/

export interface MergeNameDialogProps {
  isShown: boolean;
  rule: string;
  setRule: (rule: string) => void;
  defaultRule: string;
  presets: readonly MergedNamePreset[];
  labelSeparator: string;
  setLabelSeparator: (separator: string) => void;
  loading: boolean;
  /** The name the rule renders for this job, or the reason it cannot be rendered. */
  previewFileName: string | undefined;
  previewError: string | undefined;
  /** Does the rule render the same name for the same source (no unique token)? */
  collisionProne: boolean;
  overwrite: boolean;
  /**
  The keys that open this dialog (`mergeCutResults`, `E` in the cut-results window).

  The same key starts the merge while the dialog is open: it opened the dialog, so pressing it
  again means "go ahead". The upstream keyboard hook ignores keys typed into a dialog, so the
  dialog listens for them itself (capture phase), exactly like the finish dialog.
  */
  confirmKeys: readonly string[];
  onOverwriteChange: (overwrite: boolean) => void;
  onClose: () => void;
  onConfirm: () => void;
}

export default function MergeNameDialog({
  isShown, rule, setRule, defaultRule, presets, labelSeparator, setLabelSeparator,
  loading, previewFileName, previewError, collisionProne, overwrite, confirmKeys,
  onOverwriteChange, onClose, onConfirm,
}: MergeNameDialogProps) {
  const { t } = useTranslation();
  const disabled = loading;

  // patch: the key that opened the dialog merges when it is pressed again, so the workflow stays on
  // one key (`E` twice) instead of switching to the mouse for the confirm step. The guards mirror
  // the "Merge" button; a disabled button stays disabled.
  useEffect(() => {
    if (!isShown) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || isModifierOnlyEvent(e.code)) return;
      // Typing into the rule field wins: the confirm key is a plain letter (`E` by default), so
      // without this it could not be typed at all - and would start the merge instead. A checkbox or
      // button keeps the key (see `isTextEntryTarget`).
      if (isTextEntryTarget(e.target)) return;
      if (confirmKeys.every((keys) => !matchesKeyBinding(e, keys))) return;
      // Stop the event before the keyboard hook sees it, so the key cannot reopen the dialog instead
      // of starting the merge.
      e.preventDefault();
      e.stopPropagation();
      if (disabled || previewError != null) return;
      onConfirm();
    };
    document.addEventListener('keydown', onKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [confirmKeys, disabled, isShown, onConfirm, previewError]);

  return (
    <Dialog.Root open={isShown} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ width: '44em', maxWidth: '92vw' }} aria-describedby={undefined}>
          <Dialog.Title>{t('Name the merged result')}</Dialog.Title>

          <NameRuleEditor
            mode="merge"
            rule={rule}
            setRule={setRule}
            defaultRule={defaultRule}
            presets={presets}
            labelSeparator={labelSeparator}
            setLabelSeparator={setLabelSeparator}
            previewFileName={previewFileName}
            previewError={previewError}
            loading={loading}
            collisionProne={collisionProne}
          />

          {collisionProne && (
            <>
              <div style={{ display: 'flex', gap: '.45em', alignItems: 'flex-start', marginTop: '.9em' }}>
                <input
                  id="merge-name-overwrite"
                  type="checkbox"
                  checked={overwrite}
                  disabled={disabled}
                  onChange={(e) => onOverwriteChange(e.target.checked)}
                  style={{ marginTop: '.25em' }}
                />
                <label htmlFor="merge-name-overwrite" style={{ cursor: disabled ? 'default' : 'pointer' }}>
                  {t('Replace a file with the same name (otherwise a number is added to the name)')}
                </label>
              </div>

              {/* patch: the box is about files this app did not write. The previous merged result of
                  this video is replaced without it, so the sentence above the details answers the
                  common question before anything has to be unfolded. */}
              <div style={{ marginTop: '.35em', fontSize: '.85em', color: 'var(--gray-11)' }}>
                {t("Merging again replaces this video's previous merged result even when this is unchecked; this box is about other files with the same name.")}
              </div>

              <details style={{ marginTop: '.5em', fontSize: '.85em', color: 'var(--gray-11)' }}>
                <summary style={{ cursor: 'pointer' }}>{t('When a name is already taken')}</summary>
                <ul style={{ margin: '.4em 0 0', paddingLeft: '1.2em' }}>
                  <li>{t('A rule that now renders a different name writes the new file first and deletes the old merged result once it exists.')}</li>
                  <li>{t('Checked, a file with the same name is replaced whoever wrote it, and that cannot be undone.')}</li>
                  <li>{t('Unchecked, the merge takes the next free name with a number in brackets and leaves the existing file where it is.')}</li>
                  <li>{t('This answer is for this merge only: it starts unchecked every time, and the export setting "Overwrite existing files" does not change it.')}</li>
                </ul>
                <div style={{ marginTop: '.4em' }}>
                  {t('The work area belongs to this app, so a name clash in it is usually an older result it no longer tracks, or a file the user put there.')}
                </div>
              </details>
            </>
          )}

          <div style={{ marginTop: '.8em', fontSize: '.9em', color: 'var(--gray-11)' }}>
            {t('The merge writes the file into the work area and only names the merged file; the clips keep the names the cut step gave them.')}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.6em', marginTop: '1.2em' }}>
            <button type="button" onClick={onClose} style={{ padding: '.45em .9em', cursor: 'pointer' }}>{t('Cancel')}</button>
            <button
              type="button"
              disabled={disabled || previewError != null}
              onClick={onConfirm}
              style={{ padding: '.45em .9em', cursor: disabled || previewError != null ? 'default' : 'pointer', fontWeight: 'bold' }}
            >
              {t('Merge')}
            </button>
          </div>

          <Dialog.CloseButton />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
