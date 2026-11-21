import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import { getPathBaseName } from '../../../../common/features/patchData/videoExtensions';
import { buildOverviewGroups, getPatchOverviewSourceStatus, moveOverviewSelection } from '../../../../common/features/patchResultsOverview';
import type { PatchOverview, PatchOverviewGroupId, PatchOverviewResultFolder, PatchOverviewSource, PatchOverviewUnowned } from '../../../../common/features/patchResultsOverview';

import { DialogButton } from '../../components/Button';
import * as Dialog from '../../components/Dialog';
import { showItemInFolder } from '../../util';

/**
The results overview (fork-owned).

One row per source video, with the cut results and merged results it produced, so the user can see
where a batch stands without opening folder after folder: what is finished, what only has cut
results, what only has a merged result, and - first in the list - what produced nothing at all.

The pairing is done by the main process and the shared grouping
(`common/features/patchResultsOverview`); this dialog only renders it. Clicking a row shows the file
in the file manager, the three buttons open the stage folders.
*/

interface DisplayRow {
  kind: 'header' | 'source' | 'result' | 'unowned';
  key: string;
  group: PatchOverviewGroupId;
  /** Does the row lead to a file? */
  enabled: boolean;
  /** How many rows the header announces. */
  count?: number | undefined;
  path?: string | undefined;
  source?: PatchOverviewSource | undefined;
  resultFolder?: PatchOverviewResultFolder | undefined;
  unowned?: PatchOverviewUnowned | undefined;
  missing?: boolean | undefined;
}

/** Is the key event going to an input / textarea / select / contentEditable? */
function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable;
}

function groupTitleKey(group: PatchOverviewGroupId) {
  switch (group) {
    case 'isolated': { return 'No results ({{count}})'; }
    case 'partial': { return 'Partial results ({{count}})'; }
    case 'complete': { return 'Complete ({{count}})'; }
    case 'sourceGone': { return 'Source gone ({{count}})'; }
    default: { return 'Unclaimed results ({{count}})'; }
  }
}

function folderKey(folder: PatchOverviewResultFolder) {
  switch (folder) {
    case 'finishedClips': { return 'Cut results folder'; }
    case 'finishedMerged': { return 'Merged results folder'; }
    case 'detachedClips': { return 'Waiting for deletion (cut results)'; }
    default: { return 'Waiting for deletion (merged results)'; }
  }
}

function sourceStatusKey(source: PatchOverviewSource) {
  switch (getPatchOverviewSourceStatus(source)) {
    case 'complete': { return 'Complete'; }
    case 'clipsOnly': { return 'Cut results only'; }
    case 'mergedOnly': { return 'Merged result only'; }
    case 'parkedOnly': { return 'Parked results only'; }
    default: { return 'No results'; }
  }
}

function sourceFolderKey(source: PatchOverviewSource) {
  switch (source.folder) {
    case 'detachedSrc': { return 'Waiting for deletion'; }
    case 'finishedSrc': { return 'Finished'; }
    // patch: kept for the frozen dialog; the live one is PatchWorkFoldersDialog.
    case 'finishedSkip': { return 'Skipped'; }
    default: { return 'Source gone'; }
  }
}

function pairingKey(source: PatchOverviewSource) {
  return source.pairing === 'name' ? 'Matched by file name' : undefined;
}

const chipStyle: CSSProperties = { background: 'var(--gray-3)', border: '1px solid var(--gray-6)', borderRadius: '.3em', padding: '.15em .5em', fontSize: '.82em', whiteSpace: 'nowrap' };

function rowStyle(isSelected: boolean, isChild: boolean): CSSProperties {
  return {
    display: 'flex',
    gap: '.5em',
    alignItems: 'baseline',
    padding: '.28em .45em',
    borderRadius: '.25em',
    cursor: 'pointer',
    background: isSelected ? 'var(--gray-4)' : undefined,
    ...(isChild && { marginLeft: '1.4em', borderTop: '1px solid var(--gray-3)' }),
  };
}

export default function ResultsOverviewDialog({ workRoot, onHide }: { workRoot: string | undefined, onHide: () => void }) {
  const { t } = useTranslation();
  const [overview, setOverview] = useState<PatchOverview>();
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      setLoading(true);
      setError(false);
      try {
        const result = await window.electron.patchResultsOverview(workRoot);
        if (!cancelled) setOverview(result);
      } catch (err) {
        console.error('Failed to read the results overview', err);
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    read();
    return () => { cancelled = true; };
  }, [workRoot]);

  const rows = useMemo(() => {
    if (overview == null) return [];
    const needle = filter.trim().toLowerCase();
    const matches = (path: string) => needle === '' || getPathBaseName(path).toLowerCase().includes(needle);

    const result: DisplayRow[] = [];
    for (const group of buildOverviewGroups(overview)) {
      const sources = group.sources
        .map((source) => ({
          source,
          clips: source.clips.filter((entry) => matches(entry.path)),
          merged: source.merged.filter((entry) => matches(entry.path)),
          parkedClips: source.parkedClips.filter((entry) => matches(entry.path)),
          parkedMerged: source.parkedMerged.filter((entry) => matches(entry.path)),
          missing: source.missing.filter(matches),
        }))
        .filter(({ source, clips, merged, parkedClips, parkedMerged, missing }) => (
          matches(source.path) || clips.length + merged.length + parkedClips.length + parkedMerged.length + missing.length > 0
        ));
      const unowned = group.unowned.filter((entry) => matches(entry.path));

      if (sources.length === 0 && unowned.length === 0) continue;

      result.push({ kind: 'header', key: `${group.id}-header`, group: group.id, enabled: false, count: sources.length + unowned.length });

      for (const { source, clips, merged, parkedClips, parkedMerged, missing } of sources) {
        result.push({ kind: 'source', key: `${group.id}-source-${source.path}`, group: group.id, enabled: source.folder !== 'missing', path: source.path, source });
        for (const entry of [...clips, ...merged, ...parkedClips, ...parkedMerged]) {
          result.push({ kind: 'result', key: `${group.id}-result-${entry.path}`, group: group.id, enabled: true, path: entry.path, source, resultFolder: entry.folder });
        }
        for (const path of missing) {
          result.push({ kind: 'result', key: `${group.id}-missing-${path}`, group: group.id, enabled: false, path, source, missing: true });
        }
      }

      for (const entry of unowned) {
        result.push({ kind: 'unowned', key: `${group.id}-unowned-${entry.path}`, group: group.id, enabled: true, path: entry.path, unowned: entry });
      }
    }
    return result;
  }, [filter, overview]);

  const selectable = useMemo(() => rows.map((row) => row.enabled), [rows]);
  const lastRow = Math.max(0, rows.length - 1);
  const safeSelected = moveOverviewSelection(selectable, Math.min(selected, lastRow), 0);

  const reveal = useCallback((path: string | undefined) => {
    if (path == null) return;
    showItemInFolder(path).catch((err: unknown) => {
      console.error('Failed to show a file in the file manager', err);
    });
  }, []);

  const openFolder = useCallback(async (dir: string | undefined) => {
    if (dir == null) return;
    try {
      await window.electron.patchOpenWorkPath(dir);
    } catch (err) {
      console.error('Failed to open a result folder', err);
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // The filter input is auto-focused and handles its own keys.
      if (isEditableTarget(event.target)) return;
      const move = (delta: number) => {
        event.preventDefault();
        setSelected(moveOverviewSelection(selectable, safeSelected, delta));
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
          setSelected(moveOverviewSelection(selectable, 0, 0));
          break;
        }
        case 'End': {
          event.preventDefault();
          setSelected(moveOverviewSelection(selectable, rows.length - 1, 0));
          break;
        }
        case 'Enter': {
          event.preventDefault();
          reveal(rows[safeSelected]?.path);
          break;
        }
        default: {
          break;
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [reveal, rows, safeSelected, selectable]);

  const stats = overview?.stats;
  const openTargets = overview?.openTargets;
  const dirs = overview?.dirs;

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onHide()}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ width: '60em', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }} aria-describedby={undefined}>
          <Dialog.Title>{t('Results overview')}</Dialog.Title>
          <Dialog.Description>
            {t('Sources, cut results and merged results of this work folder, grouped by source. Sources without any result are listed first.')}
          </Dialog.Description>

          {stats != null && (
            <div style={{ marginTop: '.7em' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4em' }}>
                <span style={chipStyle}>{t('{{count}} sources', { count: stats.sources })}</span>
                <span style={chipStyle}>{t('{{count}} cut results', { count: stats.clips })}</span>
                <span style={chipStyle}>{t('{{count}} merged results', { count: stats.merged })}</span>
                <span style={chipStyle}>{t('{{count}} without results', { count: stats.isolated })}</span>
                {openTargets?.finishedSources === true && (
                  <button type="button" onClick={() => openFolder(dirs?.finishedSrcMediaDir)} style={{ ...chipStyle, cursor: 'pointer' }}>
                    {t('Open finished sources')}
                  </button>
                )}
              </div>
              <div style={{ marginTop: '.35em', fontSize: '.82em', color: 'var(--gray-11)' }}>
                {t('Complete: {{complete}} | Cut results only: {{clipsOnly}} | Merged result only: {{mergedOnly}} | Parked: {{parkedOnly}}', {
                  complete: stats.complete,
                  clipsOnly: stats.clipsOnly,
                  mergedOnly: stats.mergedOnly,
                  parkedOnly: stats.parkedOnly,
                })}
              </div>
              <div style={{ marginTop: '.15em', fontSize: '.82em', color: 'var(--gray-11)' }}>
                {t('Missing files: {{missing}} | Source gone: {{sourceGone}} | Unclaimed results: {{unowned}}', {
                  missing: stats.missing,
                  sourceGone: stats.sourceGone,
                  unowned: stats.unowned,
                })}
              </div>
            </div>
          )}

          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus -- the filter is the point of the dialog
            autoFocus
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setSelected(0);
            }}
            placeholder={t('Filter by name')}
            style={{ marginTop: '.6em', padding: '.35em .5em', width: '100%', boxSizing: 'border-box' }}
          />

          <div style={{ marginTop: '.5em', overflowY: 'auto', flexGrow: 1, minHeight: '10em' }}>
            {loading && <div style={{ color: 'var(--gray-11)' }}>{t('Reading...')}</div>}
            {!loading && error && <div style={{ color: 'var(--red-9)' }}>{t('The work folder could not be read.')}</div>}
            {!loading && !error && overview?.warnings.includes('no-work-root') === true && (
              <div style={{ color: 'var(--gray-11)' }}>{t('Choose a working directory or open a video first.')}</div>
            )}
            {!loading && !error && overview?.warnings.includes('dir-unreadable') === true && (
              <div style={{ color: 'var(--orange-9)', fontSize: '.85em' }}>{t('A results folder could not be read.')}</div>
            )}
            {!loading && !error && overview != null && rows.length === 0 && (
              <div style={{ color: 'var(--gray-11)' }}>{t('No sources or results in this work folder.')}</div>
            )}

            {rows.map((row, index) => {
              if (row.kind === 'header') {
                return (
                  <div key={row.key} style={{ marginTop: index === 0 ? 0 : '.9em', paddingBottom: '.2em', borderBottom: '1px solid var(--gray-6)', fontWeight: 600 }}>
                    {t(groupTitleKey(row.group), { count: row.count ?? 0 })}
                  </div>
                );
              }

              const isSelected = index === safeSelected;
              const isChild = row.kind !== 'source';
              return (
                <div
                  key={row.key}
                  role="button"
                  tabIndex={-1}
                  onMouseEnter={() => { if (row.enabled) setSelected(index); }}
                  onClick={() => { if (row.enabled) reveal(row.path); }}
                  style={{ ...rowStyle(isSelected, isChild), opacity: row.enabled ? 1 : 0.5, cursor: row.enabled ? 'pointer' : 'default' }}
                >
                  <span style={{ wordBreak: 'break-all' }}>{row.path != null ? getPathBaseName(row.path) : ''}</span>

                  {row.kind === 'source' && row.source != null && (
                    <>
                      <span style={chipStyle}>{t(sourceStatusKey(row.source))}</span>
                      <span style={chipStyle}>{t(sourceFolderKey(row.source))}</span>
                      {row.source.clips.length > 0 && <span style={chipStyle}>{t('{{count}} cut results', { count: row.source.clips.length })}</span>}
                      {row.source.merged.length > 0 && <span style={chipStyle}>{t('{{count}} merged results', { count: row.source.merged.length })}</span>}
                      {row.source.parkedClips.length + row.source.parkedMerged.length > 0 && (
                        <span style={chipStyle}>{t('{{count}} parked', { count: row.source.parkedClips.length + row.source.parkedMerged.length })}</span>
                      )}
                      {/* Which files are gone, not just how many: the missing rows are further down the list. */}
                      {row.source.missing.length > 0 && (
                        <span
                          style={{ ...chipStyle, color: 'var(--orange-9)', cursor: 'help' }}
                          title={row.source.missing.join('\n')}
                        >
                          {t('{{count}} missing', { count: row.source.missing.length })}
                        </span>
                      )}
                      {pairingKey(row.source) != null && <span style={{ ...chipStyle, color: 'var(--gray-11)' }}>{t(pairingKey(row.source)!)}</span>}
                    </>
                  )}

                  {row.kind === 'result' && row.missing === true && (
                    <span style={{ ...chipStyle, color: 'var(--orange-9)' }}>{t('Missing file')}</span>
                  )}
                  {row.kind === 'result' && row.missing !== true && row.resultFolder != null && (
                    <span style={{ ...chipStyle, color: 'var(--gray-11)' }}>{t(folderKey(row.resultFolder))}</span>
                  )}
                  {row.kind === 'unowned' && row.unowned != null && (
                    <span style={{ ...chipStyle, color: 'var(--orange-9)' }}>{t(folderKey(row.unowned.folder))}</span>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: '.5em', fontSize: '.85em', color: 'var(--gray-11)' }}>
            {t('Click a row to show it in the file manager. Up/Down select, Enter shows the file, Esc closes.')}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5em', marginTop: '.6em' }}>
            <DialogButton disabled={openTargets?.detachedSources !== true} onClick={() => openFolder(dirs?.detachedSrcMediaDir)}>
              {t('Open detached sources')}
            </DialogButton>
            <DialogButton disabled={openTargets?.finishedClips !== true} onClick={() => openFolder(dirs?.finishedClipsDir)}>
              {t('Open finished cut results')}
            </DialogButton>
            <DialogButton disabled={openTargets?.finishedMerged !== true} onClick={() => openFolder(dirs?.finishedMergedDir)}>
              {t('Open finished merged results')}
            </DialogButton>
          </div>

          <Dialog.CloseButton />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
