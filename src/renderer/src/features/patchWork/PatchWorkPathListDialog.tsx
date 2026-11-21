import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { PatchWorkRootPathInfo, PatchWorkRootRow } from '../../../../common/features/patchFinish';
import {
  buildPatchWorkRootRows,
  filterPatchWorkRoots,
  firstPatchWorkRootRow,
  lastPatchWorkRootRow,
  movePatchWorkRootRow,
  nearestPatchWorkRootRow,
} from '../../../../common/features/patchFinish';

import * as Dialog from '../../components/Dialog';

/**
`open-workpath-list` (`opl`): the work roots the app has worked in (fork-owned).

One group per root, two rows each: the source folder first (that is where the videos are, so it is
the folder the user wants to get back to), then its work area. Folders that do not exist are
greyed out (nothing is created here), the keyboard selection skips them, and Enter or a click
opens the row in the file manager and closes the dialog. The provider mounts the dialog only
while it is open, so every open starts with a fresh filter, selection and read of the list.

`defaultRoot` is the work root of the current session (see `resolvePatchWorkRoot`): the main
process shows it first even when it is not in the history yet.
*/

/** Is the key event going to an input / textarea / select / contentEditable? */
function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable;
}

export default function PatchWorkPathListDialog({ onHide, defaultRoot, workDirName }: { onHide: () => void, defaultRoot: string | undefined, workDirName: string }) {
  const { t } = useTranslation();
  const [roots, setRoots] = useState<PatchWorkRootPathInfo[]>([]);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      try {
        const listing = await window.electron.patchListWorkRoots(defaultRoot);
        if (!cancelled) setRoots(listing.roots);
      } catch (err) {
        console.error('Failed to read the work roots', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    read();
    return () => { cancelled = true; };
  }, [defaultRoot]);

  const rows = useMemo(() => buildPatchWorkRootRows(filterPatchWorkRoots(roots, filter)), [filter, roots]);

  /** The rows grouped by root, each with its global index (the selection index). */
  const groups = useMemo(() => {
    const result: { root: string; entries: { row: PatchWorkRootRow; index: number }[] }[] = [];
    rows.forEach((row, index) => {
      const last = result.at(-1);
      if (last != null && last.root === row.root) last.entries.push({ row, index });
      else result.push({ root: row.root, entries: [{ row, index }] });
    });
    return result;
  }, [rows]);

  const lastIndex = Math.max(0, rows.length - 1);
  // The selection never rests on a greyed-out row, so Enter always has something to open.
  const safeSelected = nearestPatchWorkRootRow(rows, Math.min(selected, lastIndex));

  const openRow = useCallback(async (row: PatchWorkRootRow | undefined) => {
    if (row == null || !row.exists) return;
    try {
      const opened = await window.electron.patchOpenWorkPath(row.path);
      // A folder the file manager refused stays visible, so the user can pick another row.
      if (opened) onHide();
    } catch (err) {
      console.error('Failed to open a work folder', err);
    }
  }, [onHide]);

  const onKeyDown = useCallback((event: KeyboardEvent) => {
    // The filter input is auto-focused. Its own keys (Enter, Home/End, arrows) must not move the
    // selection or open a row.
    if (isEditableTarget(event.target)) return;
    const move = (delta: number) => {
      event.preventDefault();
      setSelected(movePatchWorkRootRow(rows, safeSelected, delta));
    };
    switch (event.key) {
      case 'ArrowDown': {
        move(1);
        break;
      }
      case 'ArrowUp': {
        move(-1);
        break;
      }
      case 'PageDown': {
        move(10);
        break;
      }
      case 'PageUp': {
        move(-10);
        break;
      }
      case 'Home': {
        event.preventDefault();
        setSelected(firstPatchWorkRootRow(rows));
        break;
      }
      case 'End': {
        event.preventDefault();
        setSelected(lastPatchWorkRootRow(rows));
        break;
      }
      case 'Enter': {
        event.preventDefault();
        openRow(rows[safeSelected]);
        break;
      }
      default: {
        break;
      }
    }
  }, [openRow, rows, safeSelected]);

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onHide()}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ width: '52em', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }} aria-describedby={undefined}>
          <Dialog.Title>{t('Work folders')}</Dialog.Title>
          <Dialog.Description>{t('Folders where the app has created a {{name}} area. The first row of each group opens the folder with the videos, the second its work area.', { name: workDirName })}</Dialog.Description>

          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus -- the filter is the point of the dialog
            autoFocus
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setSelected(0);
            }}
            onKeyDown={(event) => {
              // patch: the filter is auto-focused, and the dialog's own key handler ignores editable
              // targets, so Enter and the arrows would do nothing here. Handle them at the input,
              // exactly as the hint below promises, instead of making the user Tab out first.
              if (event.key === 'Enter') {
                event.preventDefault();
                openRow(rows[safeSelected]);
                return;
              }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setSelected(movePatchWorkRootRow(rows, safeSelected, event.key === 'ArrowDown' ? 1 : -1));
              }
            }}
            placeholder={t('Filter by path')}
            style={{ marginTop: '.6em', padding: '.35em .5em', width: '100%', boxSizing: 'border-box' }}
          />

          <div style={{ marginTop: '.5em', overflowY: 'auto', flexGrow: 1, minHeight: '8em' }}>
            {loading && <div style={{ color: 'var(--gray-11)' }}>{t('Reading...')}</div>}
            {!loading && rows.length === 0 && <div style={{ color: 'var(--gray-11)' }}>{t('No work folders yet.')}</div>}

            {groups.map((group, groupIndex) => (
              <div key={group.root}>
                {groupIndex > 0 && <div style={{ borderTop: '2px solid var(--gray-6)', margin: '.9em 0 .55em' }} />}
                {group.entries.map(({ row, index }) => {
                  const isSelected = index === safeSelected;
                  return (
                    <div
                      key={`${row.root}|${row.kind}`}
                      role="button"
                      tabIndex={-1}
                      onMouseEnter={() => setSelected(index)}
                      onClick={() => openRow(row)}
                      style={{
                        display: 'flex',
                        gap: '.6em',
                        alignItems: 'baseline',
                        padding: '.3em .45em',
                        borderRadius: '.25em',
                        cursor: row.exists ? 'pointer' : 'default',
                        opacity: row.exists ? 1 : 0.45,
                        background: isSelected ? 'var(--gray-4)' : undefined,
                        ...((row.kind === 'work') && { marginLeft: '1.4em', borderTop: '1px solid var(--gray-4)' }),
                      }}
                    >
                      <span style={{ width: '11em', color: 'var(--gray-11)', fontSize: '.85em' }}>{t(row.kind === 'root' ? 'Source folder' : 'Work area')}</span>
                      <span style={{ wordBreak: 'break-all' }}>{row.path}</span>
                      {!row.exists && <span style={{ color: 'var(--gray-11)', fontSize: '.85em' }}>{t('missing')}</span>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div style={{ marginTop: '.5em', fontSize: '.85em', color: 'var(--gray-11)' }}>
            {t('Up/Down select, Enter opens, Esc closes.')}
          </div>

          <Dialog.CloseButton />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
