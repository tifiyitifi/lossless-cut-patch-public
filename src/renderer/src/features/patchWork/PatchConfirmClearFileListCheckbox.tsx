import { useTranslation } from 'react-i18next';

import Checkbox from '../../components/Checkbox';
import { usePatchWork } from './PatchWorkProvider';

/**
The "do not ask again" box of the clear-file-list confirmation (fork-owned).

It reads the setting itself instead of taking it as a prop: the content passed to `confirmDialog`
is a snapshot taken when the confirmation opens, so a box rendered from that snapshot would not
redraw when it is ticked. Subscribing to the provider does.

Ticking writes `confirmClearFileList` right away, so the box also applies when the dialog is
dismissed with Cancel; the settings switch is how the confirmation is switched back on.
*/
export default function PatchConfirmClearFileListCheckbox() {
  const { t } = useTranslation();
  const patchWork = usePatchWork();

  if (patchWork == null) return null;

  return (
    <Checkbox
      label={t('Do not ask again before clearing the source file list')}
      style={{ marginTop: '.6em' }}
      checked={!patchWork.confirmClearFileList}
      onCheckedChange={(value) => { patchWork.setConfirmClearFileList(value !== true); }}
    />
  );
}
