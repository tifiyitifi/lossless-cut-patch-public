import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { FaFolder, FaTimes } from 'react-icons/fa';

import { askForOutDir } from '../../../dialogs';
import { usePatchSettingsContext } from '../settings/patchSettingsContext';

const buttonStyle = { padding: '.3em .6em', cursor: 'pointer' } as const;

/** Column 1, row 1: choose the work/output directory. */
export default function WorkDirPanel() {
  const { t } = useTranslation();
  const { settings, update } = usePatchSettingsContext();

  const chooseDir = useCallback(async () => {
    const dir = await askForOutDir(settings.workDir);
    if (dir != null) update({ workDir: dir });
  }, [settings.workDir, update]);

  const clearDir = useCallback(() => update({ workDir: undefined }), [update]);

  return (
    <div style={{ padding: '.6em', display: 'flex', flexDirection: 'column', gap: '.5em', height: '100%', boxSizing: 'border-box', overflow: 'auto' }}>
      <div style={{ fontWeight: 600 }}>{t('Working directory')}</div>
      <div style={{ fontSize: '.85em', opacity: 0.8, wordBreak: 'break-all' }}>
        {settings.workDir ?? t('Same directory as input file')}
      </div>
      <div style={{ display: 'flex', gap: '.4em', flexWrap: 'wrap' }}>
        <button type="button" style={buttonStyle} onClick={chooseDir}>
          <FaFolder style={{ verticalAlign: 'middle', marginRight: '.3em' }} />{t('Choose directory')}
        </button>
        {settings.workDir != null && (
          <button type="button" style={buttonStyle} onClick={clearDir} title={t('Clear')}><FaTimes style={{ verticalAlign: 'middle' }} /></button>
        )}
      </div>
    </div>
  );
}
