import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { usePatchSession } from '../session/patchSessionContext';

const rowButtonStyle = {
  display: 'block',
  flexGrow: 1,
  minWidth: 0,
  textAlign: 'left',
  background: 'transparent',
  border: 'none',
  color: 'inherit',
  cursor: 'pointer',
  padding: '.3em .5em',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const;

/** Column 3, top: the cut segments of the current file (multi-select + play selected). */
export default function SegmentsPanel() {
  const { t } = useTranslation();
  const {
    cutSegments, currentSegIndex, setCurrentSegIndex, seekAbs, formatTimecode, fileDuration,
    importSrcTxtDialog, toggleSegmentSelected, selectAllSegments, deselectAllSegments,
    invertSelectedSegments, togglePlaySelectedSegments, selectedSegments,
  } = usePatchSession();

  const handleClick = useCallback((index: number) => {
    setCurrentSegIndex(index);
    const segment = cutSegments[index];
    if (segment != null) seekAbs(segment.start);
  }, [cutSegments, seekAbs, setCurrentSegIndex]);

  const handleImport = useCallback(() => {
    importSrcTxtDialog().catch((err: unknown) => { console.error(err); });
  }, [importSrcTxtDialog]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: '.4em', padding: '.3em .4em', borderBottom: '1px solid var(--gray-6)', flexShrink: 0, flexWrap: 'wrap' }}>
        <button type="button" onClick={handleImport}>{t('Import src txt')}</button>
        <button type="button" onClick={selectAllSegments}>{t('Select all segments')}</button>
        <button type="button" onClick={deselectAllSegments}>{t('Clear segment selection')}</button>
        <button type="button" onClick={invertSelectedSegments}>{t('Invert segment selection')}</button>
        <button type="button" onClick={togglePlaySelectedSegments} disabled={selectedSegments.length === 0}>
          {t('Play selected segments')} ({selectedSegments.length})
        </button>
      </div>

      {cutSegments.length === 0 ? (
        <div style={{ padding: '.8em', color: 'var(--gray-11)', fontSize: '.9em' }}>{t('No segments yet.')}</div>
      ) : (
        <div style={{ flexGrow: 1, minHeight: 0, overflow: 'auto' }}>
          {cutSegments.map((segment, index) => {
            const end = segment.end ?? fileDuration;
            const current = index === currentSegIndex;
            return (
              <div key={segment.segId} style={{ display: 'flex', alignItems: 'center', background: current ? 'var(--accent-5)' : undefined }}>
                <input
                  type="checkbox"
                  style={{ marginLeft: '.4em', flexShrink: 0 }}
                  checked={segment.selected === true}
                  onChange={() => toggleSegmentSelected({ segId: segment.segId })}
                  title={t('Toggle segment selected')}
                  aria-label={t('Toggle segment selected')}
                />
                <button
                  type="button"
                  onClick={() => handleClick(index)}
                  style={{ ...rowButtonStyle, fontWeight: current ? 600 : undefined }}
                  title={segment.segId}
                >
                  <span style={{ opacity: 0.6, marginRight: '.5em' }}>{index + 1}</span>
                  {formatTimecode({ seconds: segment.start, shorten: false })}
                  {' – '}
                  {end != null ? formatTimecode({ seconds: end, shorten: false }) : '--'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
