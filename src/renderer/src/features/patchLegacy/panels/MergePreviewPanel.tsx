import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { buildClipPlaylist } from '../../../../../common/features/patchMerge';
import type { PatchSourcePostAction } from '../../../../../common/features/patchData/settings';
import { usePatchSession } from '../session/patchSessionContext';

/**
 * Column 3, bottom: the predicted merge video (a virtual playlist of the cut clips) plus the merge
 * action and the four-state source post-processing used when finishing a file.
 */
export default function MergePreviewPanel() {
  const { t } = useTranslation();
  const {
    exportedPaths, playerView, setPlayerView,
    merge, mergedPath, sourcePostAction, setSourcePostAction, finishCurrentFile,
  } = usePatchSession();
  const entries = buildClipPlaylist(exportedPaths);

  const onMerge = useCallback(() => {
    merge().catch((err: unknown) => { console.error(err); });
  }, [merge]);

  const onFinish = useCallback(() => {
    finishCurrentFile().catch((err: unknown) => { console.error(err); });
  }, [finishCurrentFile]);

  const postActionLabels: Record<PatchSourcePostAction, string> = {
    keep: t('Keep'),
    move: t('Move to output directory'),
    trash: t('Delete (recycle bin)'),
    skip: t('Skip next'),
  };
  const postActions: PatchSourcePostAction[] = ['keep', 'move', 'trash', 'skip'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontSize: '.9em' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.4em', padding: '.3em .5em', borderBottom: '1px solid var(--gray-6)', flexShrink: 0 }}>
        <span style={{ opacity: 0.7, fontSize: '.85em' }}>{t('Predicted merge: {{n}} clips', { n: entries.length })}</span>
        <button type="button" style={{ marginLeft: 'auto' }} disabled={entries.length === 0 || playerView === 'merge'} onClick={() => setPlayerView('merge')}>
          {t('Play')}
        </button>
        <button type="button" disabled={entries.length === 0} onClick={onMerge}>{t('Merge')}</button>
      </div>

      <ol style={{ margin: 0, padding: '.4em .4em .4em 2em', overflow: 'auto', flexGrow: 1, minHeight: 0, fontSize: '.85em', listStyle: entries.length === 0 ? 'none' : undefined }}>
        {entries.length === 0 && <li style={{ listStyle: 'none', opacity: 0.6, paddingLeft: 0 }}>{t('Cut the current file to preview the merged result.')}</li>}
        {entries.map((entry) => (
          <li key={entry.path} style={{ padding: '.1em 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={entry.path}>
            {entry.path.split(/[\\/]/).pop()}
          </li>
        ))}
      </ol>

      {mergedPath != null && (
        <div style={{ padding: '.2em .5em', fontSize: '.8em', color: 'var(--green-11)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={mergedPath}>
          {t('Merged: {{path}}', { path: mergedPath })}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '.3em', padding: '.3em .5em', borderTop: '1px solid var(--gray-6)', flexShrink: 0 }}>
        <span style={{ opacity: 0.7, fontSize: '.85em' }}>{t('After finishing this file')}</span>
        {postActions.map((action) => (
          <button
            key={action}
            type="button"
            onClick={() => setSourcePostAction(action)}
            style={{ background: action === sourcePostAction ? 'var(--accent-5)' : undefined }}
          >
            {postActionLabels[action]}
          </button>
        ))}
        <button type="button" style={{ marginLeft: 'auto' }} onClick={onFinish}>{t('Finish and open next')}</button>
      </div>
    </div>
  );
}
