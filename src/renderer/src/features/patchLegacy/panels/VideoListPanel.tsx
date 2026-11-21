import type { DragEventHandler } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { resolvePatchDrop } from '../../../../../common/features/patchData';
import { usePatchSession } from '../session/patchSessionContext';
import { usePatchSettingsContext } from '../settings/patchSettingsContext';

const { stat } = window.require('node:fs/promises');
const { webUtils } = window.require('electron');

const rowStyle = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  background: 'transparent',
  border: 'none',
  color: 'inherit',
  cursor: 'pointer',
  padding: '.3em .4em',
  borderRadius: '4px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const;

/** Column 1, row 2: media files in the work directory. Click to load, drag files/folders in. */
export default function VideoListPanel() {
  const { t } = useTranslation();
  const { settings, update } = usePatchSettingsContext();
  const { filePath, openFile, videoFiles, refreshVideoFiles } = usePatchSession();
  const [sortDescending, setSortDescending] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const { workDir } = settings;

  const sortedFiles = useMemo(() => (sortDescending ? [...videoFiles].reverse() : videoFiles), [sortDescending, videoFiles]);

  const handleOpenClick = useCallback((path: string) => {
    openFile(path).catch((err: unknown) => { console.error(err); });
  }, [openFile]);

  const handleDragOver = useCallback<DragEventHandler<HTMLDivElement>>((event) => {
    event.preventDefault();
    if (event.dataTransfer != null) {
      // eslint-disable-next-line no-param-reassign
      event.dataTransfer.dropEffect = 'copy';
    }
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback(() => setDragActive(false), []);

  const handleDrop = useCallback<DragEventHandler<HTMLDivElement>>((event) => {
    event.preventDefault();
    setDragActive(false);
    const { dataTransfer } = event;
    if (dataTransfer == null) return;

    const paths = [...dataTransfer.files]
      .map((file) => webUtils.getPathForFile(file))
      .filter((path) => path !== '');

    Promise.all(paths.map(async (path) => {
      try {
        return { path, isDirectory: (await stat(path)).isDirectory() };
      } catch {
        return { path, isDirectory: false };
      }
    })).then((entries) => {
      const action = resolvePatchDrop(entries);
      // A dropped folder becomes the work directory (the list rescans automatically).
      if (action.kind === 'open-directory') update({ workDir: action.path });
      else if (action.kind === 'open-file') handleOpenClick(action.path);
    }).catch((err: unknown) => { console.error(err); });
  }, [handleOpenClick, update]);

  const dragHint = workDir == null
    ? t('Drop a folder or a video file here, or choose a directory above.')
    : t('Drop a folder (becomes the work directory) or a video file here.');

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        outline: dragActive ? '2px dashed var(--accent-9)' : undefined,
        outlineOffset: '-2px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '.4em', padding: '.3em .4em', borderBottom: '1px solid var(--gray-6)', flexShrink: 0 }}>
        <span style={{ opacity: 0.6, fontSize: '.85em' }}>{t('Media files: {{n}}', { n: videoFiles.length })}</span>
        <button type="button" style={{ marginLeft: 'auto' }} onClick={() => setSortDescending((value) => !value)} title={t('Sort by name')}>
          {sortDescending ? '↓' : '↑'}
        </button>
        <button type="button" onClick={refreshVideoFiles} title={t('Scan')}>⟳</button>
      </div>
      <div style={{ flexGrow: 1, minHeight: 0, overflow: 'auto', padding: '.4em' }}>
        {workDir == null && (
          <div style={{ padding: '.4em', color: 'var(--gray-11)', fontSize: '.9em' }}>{t('Choose a working directory first.')}</div>
        )}
        {workDir != null && videoFiles.length === 0 && (
          <div style={{ padding: '.4em', color: 'var(--gray-11)', fontSize: '.9em' }}>{t('No media files found.')}</div>
        )}
        {sortedFiles.map((file) => {
          const active = file.path === filePath;
          return (
            <button
              key={file.path}
              type="button"
              style={{ ...rowStyle, background: active ? 'var(--accent-5)' : undefined, fontWeight: active ? 600 : undefined }}
              title={file.path}
              onClick={() => handleOpenClick(file.path)}
            >
              {active ? '▸ ' : ''}{file.name}
            </button>
          );
        })}
      </div>
      <div style={{ padding: '.25em .4em', borderTop: '1px solid var(--gray-6)', color: 'var(--gray-11)', fontSize: '.8em', flexShrink: 0 }}>
        {dragHint}
      </div>
    </div>
  );
}
