import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { PatchDetachDeleteDialogView, PatchDetachDeleteScope } from '../../../../common/features/patchDeletable';
import {
  parsePatchDetachDeleteDialogView,
  patchDetachDeleteDialogViewDefault,
} from '../../../../common/features/patchDeletable';
import { getPathBaseName } from '../../../../common/features/patchData/videoExtensions';
import { DialogButton } from '../../components/Button';
import * as Dialog from '../../components/Dialog';
import Select from '../../components/Select';
import patchConfig from '../patchWork/patchConfigApi';
import LazyFrame from './LazyFrame';

/**
The second confirmation before a permanent delete (fork-owned).

It answers one question: which exact files does this remove? The dialog therefore lists only the
sources the delete will unlink - the selected ones in `detached_src_media` the fresh report calls
deletable (a kept result on disk by default, plus the extra kinds the user allowed in the deletion
settings) - as small thumbnails (or rows, the user's remembered choice), because recognising the
picture is faster than reading a long file name. The cut and merged results are not touched and the
dialog says so; selected sources without a kept result are named on their own line instead of
silently vanishing from the list, and the extra kinds the user allowed get a line of their own so a
one-click "Delete all" never deletes an unproved source without saying so.
*/

const nameStyle = {
  wordBreak: 'break-all',
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 2,
  overflow: 'hidden',
} as const;

function FileSize({ size }: { size: number | undefined }) {
  const { t } = useTranslation();
  if (size == null) return null;
  return <span style={{ color: 'var(--gray-11)', fontSize: '.9em' }}>{t('{{megabytes}} MB', { megabytes: Math.round(size / 1_000_000) })}</span>;
}

export default function DetachDeleteDialog({ files, scope, skipped, extraCount, busy, onCancel, onConfirm }: {
  files: readonly { path: string; size: number | undefined; duration: number | undefined }[];
  /** `selection`: the user picked these sources; `all`: nothing was selected, so every ready source is offered. */
  scope: PatchDetachDeleteScope;
  /** Selected sources that will stay on disk because no kept result proves the app finished them. */
  skipped: number;
  /** How many of `files` are deletable only because the user allowed their kind in the settings. */
  extraCount: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<PatchDetachDeleteDialogView>(
    () => parsePatchDetachDeleteDialogView(patchConfig.getPatchSetting('detachDeleteDialogView') ?? patchDetachDeleteDialogViewDefault),
  );

  const changeView = (next: PatchDetachDeleteDialogView) => {
    setView(next);
    patchConfig.setPatchSetting('detachDeleteDialogView', next);
  };

  const thumbTime = (duration: number | undefined) => (duration != null && duration > 0 ? Math.min(5, duration / 10) : 0);

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ width: '46em', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }} aria-describedby={undefined}>
          <Dialog.Title>
            {scope === 'all'
              ? t('Delete all {{count}} source videos for good?', { count: files.length })
              : t('Delete these source videos for good?')}
          </Dialog.Title>
          <Dialog.Description>
            {scope === 'all'
              ? t('Nothing is selected, so this deletes every source that is ready for deletion. Their cut results and merged results stay where they are.')
              : t('Only these {{count}} files in the waiting-for-deletion source folder will be deleted. Their cut results and merged results stay where they are.', { count: files.length })}
          </Dialog.Description>

          <div style={{ display: 'flex', gap: '.5em', alignItems: 'center', marginTop: '.6em', fontSize: '.85em' }}>
            <span style={{ flexGrow: 1 }} />
            <span>{t('View')}</span>
            <Select
              aria-label={t('View')}
              value={view}
              onChange={(event) => { changeView(parsePatchDetachDeleteDialogView(event.target.value)); }}
              style={{ minWidth: '6em', padding: '.2em .35em' }}
            >
              <option value="grid">{t('Grid')}</option>
              <option value="list">{t('List')}</option>
            </Select>
          </div>

          <div style={{ marginTop: '.4em', overflowY: 'auto', flexGrow: 1, maxHeight: '45vh' }}>
            {view === 'grid' ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(8.5em, 1fr))', gap: '.5em' }}>
                {files.map((file) => (
                  <div key={file.path} title={file.path} style={{ display: 'flex', flexDirection: 'column', gap: '.15em', minWidth: 0 }}>
                    <LazyFrame
                      path={file.path}
                      cacheKey={`${file.path}|${file.size ?? ''}|${file.duration ?? ''}`}
                      time={thumbTime(file.duration)}
                      fill
                    />
                    <span style={{ ...nameStyle, fontSize: '.82em' }}>{getPathBaseName(file.path)}</span>
                    <FileSize size={file.size} />
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.2em' }}>
                {files.map((file) => (
                  <div key={file.path} title={file.path} style={{ display: 'flex', gap: '.5em', alignItems: 'center', minWidth: 0 }}>
                    <LazyFrame
                      path={file.path}
                      cacheKey={`${file.path}|${file.size ?? ''}|${file.duration ?? ''}`}
                      time={thumbTime(file.duration)}
                      width={96}
                      height={54}
                    />
                    <span style={{ ...nameStyle, flexGrow: 1, fontSize: '.88em' }}>{getPathBaseName(file.path)}</span>
                    <FileSize size={file.size} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {scope === 'selection' && skipped > 0 && (
            <div style={{ marginTop: '.5em', color: 'var(--orange-9)', fontSize: '.88em' }}>
              {t('{{count}} selected source videos have no kept result and will stay on disk.', { count: skipped })}
            </div>
          )}

          {extraCount > 0 && (
            <div style={{ marginTop: '.5em', color: 'var(--orange-9)', fontSize: '.88em' }}>
              {t('{{count}} of these sources have no kept result. They are deleted because you allowed that kind in the deletion settings.', { count: extraCount })}
            </div>
          )}

          <Dialog.ButtonRow>
            <DialogButton onClick={onCancel} disabled={busy}>{t('Cancel')}</DialogButton>
            <DialogButton
              primary
              onClick={onConfirm}
              disabled={busy}
              style={{ backgroundColor: 'var(--red-9)', borderColor: 'var(--red-9)' }}
            >
              {busy ? t('Deleting...') : t('Delete for good')}
            </DialogButton>
          </Dialog.ButtonRow>

          <Dialog.CloseButton />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
