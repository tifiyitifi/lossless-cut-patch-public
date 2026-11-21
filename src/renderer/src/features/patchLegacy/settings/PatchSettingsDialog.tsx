import type { ChangeEventHandler, ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import * as Dialog from '../../../components/Dialog';
import Settings from '../../../components/Settings';
import type { NamingPresetId } from '../../../../../common/features/patchData/naming';
import type { PatchSourcePostAction, PatchViewSwitchStyle } from '../../../../../common/features/patchData/settings';
import { usePatchSettingsContext } from './patchSettingsContext';

const detailsStyle = { opacity: 0.75, fontSize: '.9em', marginTop: '.2em' } as const;

function Row({ label, details, children }: { label: string, details?: string | undefined, children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1em', padding: '.45em 0' }}>
      <div style={{ flexGrow: 1 }}>
        {label}
        {details != null && <div style={detailsStyle}>{details}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

const namingPresetIds: NamingPresetId[] = ['losslesscut', 'legacy'];
const viewSwitchStyles: PatchViewSwitchStyle[] = ['candidates', 'cycle'];
const postActions: PatchSourcePostAction[] = ['keep', 'move', 'trash', 'skip'];

/**
 * Patch settings: a short patch-specific section on top of the **untouched upstream settings
 * dialog**, which is reused verbatim so every upstream option (cutting mode, keyframe cut, metadata
 * preservation, timecode format…) is available in patch mode and stays in sync with upstream.
 */
export default function PatchSettingsDialog({ open, onClose }: { open: boolean, onClose: () => void }) {
  const { t } = useTranslation();
  const { settings, update } = usePatchSettingsContext();
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(true);

  const onNamingChange = useCallback<ChangeEventHandler<HTMLSelectElement>>((event) => {
    update({ namingPreset: event.target.value === 'legacy' ? 'legacy' : 'losslesscut' });
  }, [update]);

  const onViewSwitchChange = useCallback<ChangeEventHandler<HTMLSelectElement>>((event) => {
    update({ viewSwitchStyle: event.target.value === 'cycle' ? 'cycle' : 'candidates' });
  }, [update]);

  const onOutputModeChange = useCallback<ChangeEventHandler<HTMLSelectElement>>((event) => {
    update({ autoMerge: event.target.value === 'merged' });
  }, [update]);

  const onPostActionChange = useCallback<ChangeEventHandler<HTMLSelectElement>>((event) => {
    const { value } = event.target;
    update({ sourcePostAction: value === 'move' || value === 'trash' || value === 'skip' ? value : 'keep' });
  }, [update]);

  // Only needed by base-mode components patch does not render (they are part of the shared context).
  const noopAsync = useCallback(async () => undefined, []);
  const noopTuner = useCallback(() => undefined, []);
  const onKeyboardShortcutsRequested = useCallback(() => undefined, []);

  const namingPresetLabels: Record<NamingPresetId, string> = {
    losslesscut: t('LosslessCut convention'),
    legacy: t('Legacy script convention'),
  };
  const viewSwitchLabels: Record<PatchViewSwitchStyle, string> = {
    candidates: t('Show a list to pick from'),
    cycle: t('Cycle through the views'),
  };
  const postActionLabels: Record<PatchSourcePostAction, string> = {
    keep: t('Keep'),
    move: t('Move to output directory'),
    trash: t('Delete (recycle bin)'),
    skip: t('Skip next'),
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next: boolean) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ width: '60em' }}>
          <Dialog.Title>{t('Settings')}</Dialog.Title>

          <Row
            label={t('Output naming preset')}
            details={t('Names the files produced by a cut. The LosslessCut convention follows the template configured below.')}
          >
            <select value={settings.namingPreset} onChange={onNamingChange}>
              {namingPresetIds.map((id) => <option key={id} value={id}>{namingPresetLabels[id]}</option>)}
            </select>
          </Row>

          <Row
            label={t('Output per cut')}
            details={t('Separate clips writes one file per segment; one merged file also concatenates them.')}
          >
            <select value={settings.autoMerge ? 'merged' : 'separate'} onChange={onOutputModeChange}>
              <option value="separate">{t('Separate clips')}</option>
              <option value="merged">{t('One merged file')}</option>
            </select>
          </Row>

          <Row
            label={t('View switch key (V)')}
            details={t('How V picks between the source video, the cut clips and the merged preview.')}
          >
            <select value={settings.viewSwitchStyle} onChange={onViewSwitchChange}>
              {viewSwitchStyles.map((style) => <option key={style} value={style}>{viewSwitchLabels[style]}</option>)}
            </select>
          </Row>

          <Row
            label={t('After finishing this file')}
            details={t('What happens to the source file when you finish it (the four-state post-processing).')}
          >
            <select value={settings.sourcePostAction} onChange={onPostActionChange}>
              {postActions.map((action) => <option key={action} value={action}>{postActionLabels[action]}</option>)}
            </select>
          </Row>

          <hr style={{ border: 'none', borderTop: '1px solid var(--gray-6)', margin: '1em 0' }} />

          {/* Upstream settings, reused verbatim. */}
          <Settings
            onTunerRequested={noopTuner}
            onKeyboardShortcutsDialogRequested={onKeyboardShortcutsRequested}
            askForCleanupChoices={noopAsync}
            toggleStoreProjectInWorkingDir={noopAsync}
            showAdvancedSettings={showAdvancedSettings}
            setShowAdvancedSettings={setShowAdvancedSettings}
          />

          <Dialog.CloseButton />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
