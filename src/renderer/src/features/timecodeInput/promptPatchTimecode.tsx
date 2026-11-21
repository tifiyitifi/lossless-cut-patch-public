import type { FormEventHandler } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import type { KeyBinding, TimecodeFormat } from '../../../../common/types';
import { applyCompactSwap } from '../../../../common/features/timecodeInput/compactSwap';
import { splitRelativeTimecodeInput } from '../../../../common/features/timecodeInput/relativeInput';
import type { ParseTimecode } from '../../types';
import type { ShowGenericDialog } from '../../components/GenericDialog';
import { useGenericDialogContext } from '../../components/GenericDialog';
import * as Dialog from '../../components/Dialog';
import TextInput from '../../components/TextInput';
import { ButtonRow } from '../../components/Dialog';
import { DialogButton } from '../../components/Button';
import { dangerColor } from '../../colors';
import ActionKeys from '../patch/ActionKeys';
import patchConfig from '../patchWork/patchConfigApi';
import { isTimecodeDialogDismissEvent } from './dismissKeys';
import TimecodeHelp from './TimecodeHelp';

/**
The patch-mode "seek to timecode" dialog (fork-owned).

Base mode keeps the upstream dialog (`useTimecode.promptTimecode`); this one adds the format help
and the switch that swaps the two input forms, so the form used most sits in the plain value:

- switch on (the default): a plain value is a compact time, `..` asks for the active timecode
  format.
- switch off: a plain value is the active timecode format, `..` is a compact time.

The parsers are untouched: the swap is a text move (`applyCompactSwap`), applied to the value
before it is parsed and to the initial value before it is shown, so a value keeps meaning the
same time on both sides of the switch. Toggling the switch rewrites the text the same way, so the
same time stays in the box instead of silently changing meaning under the user's cursor.
*/
export default async ({ initialValue, title, inputPlaceholder, allowRelative, parseTimecode, timecodeFormat, showGenericDialog, keyBindings }: {
  initialValue: string,
  title: string,
  inputPlaceholder: string,
  /** Does the dialog turn a leading `+`/`-` into a relative seek? */
  allowRelative: boolean,
  parseTimecode: ParseTimecode,
  timecodeFormat: TimecodeFormat,
  showGenericDialog: ShowGenericDialog,
  /** The bindings as they really run, for the hint line and the keys that close the dialog. */
  keyBindings: readonly KeyBinding[],
}) => new Promise<{ duration: number, relDirection: number | undefined } | undefined>((resolve) => {
  function PatchTimecodeDialog() {
    const { t } = useTranslation();
    const { onOpenChange } = useGenericDialogContext();

    // Every key bound to `goToTimecode` re-closes the dialog (see `isTimecodeDialogDismissEvent`),
    // so the hint cannot name a key that was rebound or unbound in the settings.
    const dismissKeys = useMemo(
      () => keyBindings.filter((binding) => binding.action === 'goToTimecode').map((binding) => binding.keys),
      // `keyBindings` belongs to the dialog's own closure (it is fixed for the dialog's lifetime), so
      // it is not a re-render dependency.
      [],
    );

    const [swapped, setSwapped] = useState(() => patchConfig.getPatchSetting('timecodeCompactSwapped'));
    const [value, setValue] = useState(() => (initialValue === '' ? '' : applyCompactSwap(initialValue, swapped)));
    const [error, setError] = useState<string | undefined>();

    const toggleSwap = useCallback(() => {
      const nextSwapped = !swapped;
      setSwapped(nextSwapped);
      patchConfig.setPatchSetting('timecodeCompactSwapped', nextSwapped);
      // `applyCompactSwap` only moves the marker, so it keeps the value's time whichever way the
      // switch goes (its second argument only says "do move it"). An empty box stays empty.
      setValue((prev) => {
        const text = prev.trim();
        return text === '' ? '' : applyCompactSwap(text, true);
      });
      setError(undefined);
    }, [swapped]);

    /**
    The keys bound to `goToTimecode` close the dialog again, so the key that opened it toggles it.

    With focus on the page the upstream keyboard hook opens the dialog; here, while the dialog
    holds the focus (where the hook does not run), the same keys cancel. `isTimecodeDialogDismissEvent`
    keeps the field's own characters typeable - a user who binds the action to a digit can still
    type `..1.2.3` - and ignores the repeat of a held key.

    Capture phase, like the merge and finish dialogs: the event must not reach the keyboard hook.
    */
    const dismiss = useCallback((e: KeyboardEvent) => {
      if (!isTimecodeDialogDismissEvent(e, dismissKeys)) return;
      e.preventDefault();
      e.stopPropagation();
      onOpenChange(false);
    }, [dismissKeys, onOpenChange]);

    useEffect(() => {
      const onKeyDown = (e: KeyboardEvent) => { dismiss(e); };
      document.addEventListener('keydown', onKeyDown, { capture: true });
      return () => document.removeEventListener('keydown', onKeyDown, true);
    }, [dismiss]);

    const handleSubmit = useCallback<FormEventHandler<HTMLFormElement>>((e) => {
      e.preventDefault();

      const { text, relDirection } = splitRelativeTimecodeInput({ value, allowRelative });

      const duration = parseTimecode(applyCompactSwap(text, swapped));

      // `parseFloat`/`parseInt` answer NaN for garbage, which is neither an error nor a time: it
      // would reach the seek and do nothing.
      const invalid = duration == null || !Number.isFinite(duration);
      setError(invalid ? t('Invalid timecode format') : undefined);

      if (!invalid) {
        resolve({ duration, relDirection });
        onOpenChange(false);
      }
    // `parseTimecode` comes from the hook that owns the dialog and does not change while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [onOpenChange, swapped, t, value]);

    return (
      <Dialog.Content aria-describedby={undefined} style={{ width: '80vw' }}>
        <Dialog.Title>{title}</Dialog.Title>

        <form onSubmit={handleSubmit}>
          <TextInput
            value={value}
            placeholder={inputPlaceholder}
            onChange={(e) => setValue(e.target.value)}
            style={{ margin: '1em 0', width: '100%', boxSizing: 'border-box' }}
          />

          <label htmlFor="patch-timecode-swap" style={{ display: 'flex', alignItems: 'center', gap: '.4em', fontSize: '.85em', marginBottom: '.2em' }}>
            <input id="patch-timecode-swap" type="checkbox" checked={swapped} onChange={toggleSwap} />
            {t('Plain numbers are compact time (a leading .. reads this timecode format)')}
          </label>

          {dismissKeys.length > 0 && (
            <div style={{ fontSize: '.85em', color: 'var(--gray-11)', marginBottom: '.4em' }}>
              <Trans>Press <ActionKeys keyBindings={keyBindings} action="goToTimecode" /> to open or close this dialog</Trans>
            </div>
          )}

          <TimecodeHelp mode={timecodeFormat} showRelative={allowRelative} swapped={swapped} />

          {error != null && (
            <div style={{ color: dangerColor, fontWeight: 'bold' }}>
              {error}
            </div>
          )}

          <ButtonRow>
            <Dialog.Close asChild>
              <DialogButton>{t('Cancel')}</DialogButton>
            </Dialog.Close>

            <DialogButton type="submit" primary>{t('Go')}</DialogButton>
          </ButtonRow>
        </form>
      </Dialog.Content>
    );
  }

  showGenericDialog({
    render: () => <PatchTimecodeDialog />,
    onClose: () => resolve(undefined),
  });
});
