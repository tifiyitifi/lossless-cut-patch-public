import type { MouseEventHandler } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { PatchAction } from '../../../../../common/features/patchData';
import { allPatchActions, findPatchKeyConflict, formatPatchKeyLabel, getPatchKeyLabelForAction } from '../../../../../common/features/patchData';
import usePatchCommandLabels from '../console/usePatchCommandLabels';
import { usePatchSession } from '../session/patchSessionContext';

/** Keys that only modify others; pressing them alone does not bind. */
const modifierKeys = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'ContextMenu']);

/**
 * Key-binding editor overlay: click a row, press a key. `Esc` cancels recording (or closes), a key
 * already bound to another action is rejected. While open, all key events are swallowed so the
 * normal patch shortcuts stay out of the way.
 */
export default function KeyBindingEditor({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const labels = usePatchCommandLabels();
  const { patchKeyBindings, setPatchKeyBinding, resetPatchKeyBindings } = usePatchSession();
  const [recording, setRecording] = useState<PatchAction | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Swallow everything: the editor owns the keyboard while it is open.
      event.stopPropagation();

      if (recording == null) {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
        return;
      }

      event.preventDefault();

      if (event.key === 'Escape') {
        setRecording(undefined);
        setError(undefined);
        return;
      }
      if (modifierKeys.has(event.key)) return;

      const key = event.key.length === 1 && /[a-z]/i.test(event.key) ? event.key.toLowerCase() : event.key;
      const conflict = findPatchKeyConflict(patchKeyBindings, key, event.shiftKey, recording);
      if (conflict != null) {
        setError(t('{{key}} is already used by {{action}}', { key: formatPatchKeyLabel(key), action: labels.intents[conflict] }));
        return;
      }

      setPatchKeyBinding(recording, key, event.shiftKey);
      setRecording(undefined);
      setError(undefined);
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [labels, onClose, patchKeyBindings, recording, setPatchKeyBinding, t]);

  const onRowClick = useCallback((action: PatchAction) => {
    setRecording(action);
    setError(undefined);
  }, []);

  const onReset = useCallback(() => {
    resetPatchKeyBindings();
    setError(undefined);
  }, [resetPatchKeyBindings]);

  const onBackdropMouseDown = useCallback<MouseEventHandler<HTMLDivElement>>((event) => {
    if (event.target === event.currentTarget) onClose();
  }, [onClose]);

  return (
    <div
      role="presentation"
      onMouseDown={onBackdropMouseDown}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '10vh', background: 'rgba(0, 0, 0, .35)' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('Key bindings')}
        style={{ width: 'min(620px, 92vw)', maxHeight: '74vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--gray-2)', border: '1px solid var(--gray-7)', borderRadius: '8px', boxShadow: '0 8px 32px rgba(0, 0, 0, .4)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5em', padding: '.5em .8em', borderBottom: '1px solid var(--gray-6)' }}>
          <span style={{ fontWeight: 600 }}>{t('Key bindings')}</span>
          <div style={{ flexGrow: 1 }} />
          <button type="button" onClick={onReset}>{t('Reset to defaults')}</button>
          <button type="button" onClick={onClose}>{t('Close')}</button>
        </div>

        {error != null && (
          <div style={{ padding: '.4em .8em', color: 'var(--red-11)', fontSize: '.85em' }}>{error}</div>
        )}

        <div style={{ overflow: 'auto', padding: '.3em .4em' }}>
          {allPatchActions.map((action) => {
            const isRecording = recording === action;
            const keyLabel = isRecording
              ? t('Press a key…')
              : (getPatchKeyLabelForAction(patchKeyBindings, action) ?? t('Unbound'));
            return (
              <button
                key={action}
                type="button"
                onClick={() => onRowClick(action)}
                style={{ display: 'flex', alignItems: 'center', gap: '.6em', width: '100%', border: 'none', cursor: 'pointer', padding: '.35em .5em', borderRadius: '4px', fontSize: '.9em', color: 'inherit', background: isRecording ? 'var(--accent-5)' : 'transparent' }}
              >
                <span style={{ flexGrow: 1, textAlign: 'left' }}>{labels.intents[action]}</span>
                <span style={{ fontFamily: 'monospace', opacity: isRecording ? 1 : 0.7 }}>{keyLabel}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
