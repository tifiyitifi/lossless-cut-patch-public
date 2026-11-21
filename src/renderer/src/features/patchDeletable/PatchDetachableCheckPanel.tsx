import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { PatchDeepCheckView, PatchDeleteOutcome, PatchDetachAnalyzeScope, PatchDetachDeletePlan, PatchDetachExtraDeletableReason, PatchDetachSelection } from '../../../../common/features/patchDeletable';
import {
  buildPatchDetachAnalysisTargets,
  buildPatchDetachPlaylist,
  countPatchDetachSelection,
  describePatchCheckHeader,
  emptyPatchDetachSelection,
  parsePatchDetachAllIncludesExtra,
  parsePatchDetachExtraDeletableReasons,
  patchDetachableDeepCheckChannel,
  patchDetachAnalyzeScopeForKind,
  planPatchDetachClick,
  planPatchDetachDelete,
  planPatchDetachSelectKind,
  planPatchDetachSelectNoneKind,
  summarizePatchDeleteOutcomes,
} from '../../../../common/features/patchDeletable';
import type { PatchDetachGridItem, PatchDetachGridItemKind, PatchDetachGridRow, PatchDetachGridView } from '../../../../common/features/patchDeletable/grid';
import {
  buildPatchDetachGrid,
  computePatchDetachGroupLayout,
  flattenPatchDetachGrid,
  getPatchDetachColumnRule,
  getPatchDetachTileWidth,
  parsePatchDetachGridView,
  parsePatchDetachGroupsPerRow,
  parsePatchDetachSourceColumnWidths,
  patchDetachCardGap,
  patchDetachGridDefaultView,
  patchDetachGridPaddingX,
  patchDetachGroupGap,
  patchDetachGroupInnerGap,
  patchDetachGroupOptions,
  patchDetachGroupPadding,
  patchDetachGroupsPerRowDefault,
  patchDetachGridViews,
} from '../../../../common/features/patchDeletable/grid';
import { getPathBaseName } from '../../../../common/features/patchData/videoExtensions';
import { DialogButton } from '../../components/Button';
import Select from '../../components/Select';
import mainApi from '../../mainApi';
import getSwal from '../../swal';
import patchConfig from '../patchWork/patchConfigApi';
import DetachDeleteDialog from './DetachDeleteDialog';
import DetachDeleteSettingsDialog from './DetachDeleteSettingsDialog';
import DetachAnalyzeScopeDialog from './DetachAnalyzeScopeDialog';
import { chipButtonStyle, patchCheckText } from './DetachFileMeta';
import DetachVideoCard, { DetachMissingStrip } from './DetachVideoCard';
import type { DetachCardLayout } from './DetachVideoCard';
import { useDetachableAnalysis } from './useDetachableAnalysis';
import { useDetachableFileDetails } from './useDetachableFileDetails';
import type { DetachableFileDetails } from './useDetachableFileDetails';
import { useDetachableReport } from './useDetachableReport';

/**
The detached-source check (fork-owned).

One grid, one scrollbar: every visual row holds several source groups, each group a source and the
results it produced next to it. A row splits into equal group panels (`repeat(g, 1fr)`, so with two
groups the second one starts exactly at half the page) with a wide gap between them, and every panel
has a header naming the source and its counts. Inside a panel the source column and the results
column are separated by a wide gutter with a rule in it, and that boundary can be dragged: the source
column grows by whole pixels while the source card keeps its size, so the drag gives the results more
or less room and never compresses a card. The number of groups a row holds is the saved maximum
clamped to what the window can show, so a narrow window shows fewer groups without forgetting the
setting.

A source and its results are the same card (`DetachVideoCard`): the whole card is the click target, so
selection follows the gestures of a Windows file list - click selects one, Ctrl+click adds or removes,
Shift+click takes a range, double-click plays. Buttons inside the card never change the selection.

A source can be selected, played and deep-checked whether or not the app may delete it; by default
only a source the app finished and whose kept result is on disk is counted by the delete button. The
deletion settings can widen that to sources the app cannot prove finished, one kind at a time, and can
leave them out of a no-selection "Delete all". Deleting is permanent and is the only thing the window
removes - everything else is handed back to the user through the file manager.

Every file has a frame, its duration, its size, its modification time and a fast status; the optional
deep check decodes the whole file when the fast status is not enough. Playback goes to the check
player (the same player as the results, so no second video implementation), which receives the whole
check list grouped by source and jumps to the clicked file - or to whatever the system associates with
the file, which is what a double click in the file manager does.
*/

/** The list preset keeps one group per row: a source row and its result rows. */
const listGroupColumns = 'minmax(240px, 340px) minmax(0, 1fr)';

const groupBadgeStyle = {
  background: 'var(--gray-4)',
  borderRadius: '.25em',
  padding: '0 .35em',
  whiteSpace: 'nowrap',
} as const;

/** The rule that segments the action bar; a plain glyph, so it needs no translation. */
function ActionBarSeparator() {
  return <span aria-hidden style={{ color: 'var(--gray-7)' }}>|</span>;
}

const { ipcRenderer } = window.require('electron');
const { readdir } = window.require('node:fs/promises');
const { basename, dirname } = window.require('node:path');

/** Files next to a deleted source that share its name (`a.mp4.llc`, other sidecars). */
async function countRelatedSiblings(paths: readonly string[]) {
  const byDir = new Map<string, string[]>();
  for (const path of paths) {
    const dir = dirname(path);
    byDir.set(dir, [...(byDir.get(dir) ?? []), basename(path)]);
  }

  let count = 0;
  for (const [dir, names] of byDir) {
    let entries: string[];
    try {
      // eslint-disable-next-line no-await-in-loop -- one folder at a time; a delete touches few folders
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (names.some((name) => entry.startsWith(`${name}.`))) count += 1;
    }
  }
  return count;
}

/** Split the sources into visual rows of `size` groups. */
function chunkGridRows(rows: readonly PatchDetachGridRow[], size: number): PatchDetachGridRow[][] {
  const chunks: PatchDetachGridRow[][] = [];
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks;
}

/**
One source group of the deletion check: the source and the results it produced, in a panel of its own.

The panel is what tells a group apart from its neighbour: a header naming the source and its counts,
a border and a background around the pair, and a gap to the next group that is much wider than the
gap between the source and its results. The source card keeps the view's card width; the source
column may be wider than the card, and dragging the boundary between the two columns changes how
much room the results get. Nothing inside the group is ever compressed.
*/
function DetachSourceGroup({
  row, order, groupIndex, listMode, cardLayout, cardWidth, sourceWidth, minWidth, maxWidth, resizeActive,
  selected, details, deepChecks, onSelect, onPlay, onDeepCheck, onCancelDeepCheck, onLocate,
  onResizeStart, onResizeMove, onResizeEnd,
}: {
  row: PatchDetachGridRow;
  /** The group's number in the whole list (1-based), so the rows count 1, 2, 3, 4 - not 1, 2, 1, 2. */
  order: number;
  groupIndex: number;
  listMode: boolean;
  cardLayout: DetachCardLayout;
  cardWidth: number | undefined;
  sourceWidth: number;
  minWidth: number;
  maxWidth: number;
  resizeActive: boolean;
  selected: ReadonlySet<string>;
  details: ReadonlyMap<string, DetachableFileDetails>;
  deepChecks: Record<string, PatchDeepCheckView>;
  onSelect: (selection: { key: string, extend: boolean, toggle: boolean }) => void;
  onPlay: (path: string) => void;
  onDeepCheck: (path: string) => void;
  onCancelDeepCheck: (path: string) => void;
  onLocate: (path: string) => void;
  onResizeStart: (index: number, sourceWidth: number, minWidth: number, maxWidth: number, event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizeMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizeEnd: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const { t } = useTranslation();
  const [sourceItem, ...resultItems] = row.items;
  if (sourceItem == null) return null;
  const empty = resultItems.length === 0 && row.missing.length === 0;

  const card = (item: PatchDetachGridItem) => (
    <DetachVideoCard
      key={item.key}
      item={item}
      selected={selected.has(item.key)}
      details={details.get(item.path)}
      deepCheck={deepChecks[item.path]}
      layout={cardLayout}
      tileWidth={cardWidth}
      onSelect={onSelect}
      onPlay={onPlay}
      onDeepCheck={onDeepCheck}
      onCancelDeepCheck={onCancelDeepCheck}
      onLocate={onLocate}
    />
  );
  const rule = getPatchDetachColumnRule(sourceWidth);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '.4em',
        minWidth: 0,
        padding: patchDetachGroupPadding,
        border: '1px solid var(--gray-6)',
        borderRadius: '.5em',
        background: 'var(--gray-2)',
      }}
    >
      <div style={{ display: 'flex', gap: '.45em', alignItems: 'baseline', minWidth: 0, fontSize: patchCheckText.meta, color: 'var(--gray-11)' }}>
        <span style={groupBadgeStyle}>{t('Group {{index}}', { index: order })}</span>
        <span style={{ flexGrow: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--gray-12)' }} title={row.source.path}>
          {getPathBaseName(row.source.path)}
        </span>
        {(() => {
          // The cards say what each file is; the count does too, because one combined "N results"
          // did not tell a finished cut result from a temporary clip parked for deletion or from a
          // merged file. The separator is punctuation, so it is not a translated sentence.
          const countOf = (match: (item: PatchDetachGridItem) => boolean) => resultItems.filter((item) => match(item)).length;
          const parts = [
            { key: 'cut', count: countOf((item) => item.resultFolder === 'finishedClips'), text: (count: number) => t('{{count}} cut result(s)', { count }) },
            { key: 'temporary', count: countOf((item) => item.resultFolder === 'detachedClips'), text: (count: number) => t('{{count}} temporary clip(s)', { count }) },
            { key: 'merged', count: countOf((item) => item.resultFolder === 'finishedMerged' || item.resultFolder === 'detachedMerged'), text: (count: number) => t('{{count}} merged result(s)', { count }) },
          ].filter((part) => part.count > 0);
          if (parts.length === 0) return <span>{t('No cut results or temporary clips')}</span>;
          return (
            <span title={t('Cut results are the finished clips moved to finished_clips. Temporary clips are the ones still in the work area or parked in detached_clips for deletion. Merged results are the files they were joined into. Only files still on disk are listed.')}>
              {parts.map((part, index) => (
                <span key={part.key}>
                  {index > 0 ? ' · ' : ''}
                  {part.text(part.count)}
                </span>
              ))}
            </span>
          );
        })()}
        {/* The count says how many, the hover says which: the strips below carry the same paths, but
            a group with many results pushes them out of the first glance. Full paths for the same
            reason the strips use them (`DetachMissingStrip`), so two results of one name are told
            apart. Native title, so nothing new has to be styled or dismissed. */}
        {row.missing.length > 0 && (
          <span
            style={{ color: 'var(--orange-9)', cursor: 'help' }}
            title={row.missing.join('\n')}
          >
            {t('{{count}} missing', { count: row.missing.length })}
          </span>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: listMode ? listGroupColumns : `${sourceWidth}px minmax(0, 1fr)`,
          columnGap: patchDetachGroupInnerGap,
          alignItems: 'start',
          minWidth: 0,
          position: 'relative',
        }}
      >
        <div style={{ minWidth: 0 }}>{card(sourceItem)}</div>

        <div
          style={{
            display: 'flex',
            flexDirection: listMode ? 'column' : 'row',
            flexWrap: listMode ? undefined : 'wrap',
            gap: patchDetachCardGap,
            alignContent: 'flex-start',
            minWidth: 0,
          }}
        >
          {empty && <span style={{ fontSize: patchCheckText.meta, color: 'var(--gray-11)' }}>{t('This source has no results or temporary clips.')}</span>}
          {resultItems.map((item) => card(item))}
          {row.missing.map((path) => <DetachMissingStrip key={`missing:${path}`} path={path} width={cardWidth} layout={cardLayout} />)}
        </div>

        {/* The draggable boundary: a wider source column means fewer result columns, never smaller
            cards. The rule runs the whole height of the group and sits in a gutter that is three
            times the gap between two result cards, so the source side and the results side read as
            two columns instead of one strip of cards; its hit area is eight pixels wide, centered on
            the line. */}
        {!listMode && (
          <div
            role="separator"
            aria-orientation="vertical"
            title={t('Drag to resize')}
            onPointerDown={(event) => { onResizeStart(groupIndex, sourceWidth, minWidth, maxWidth, event); }}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeEnd}
            onPointerCancel={onResizeEnd}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: rule.handleLeft,
              width: rule.handleWidth,
              cursor: 'col-resize',
              zIndex: 2,
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            <span style={{ width: rule.width, borderRadius: 1, background: resizeActive ? 'var(--accent-8)' : 'var(--gray-8)' }} />
          </div>
        )}
      </div>
    </div>
  );
}

export default function PatchDetachableCheckPanel({ root }: { root: string | undefined }) {
  const { t } = useTranslation();
  type PlayTarget = 'in-app' | 'external';
  const { report, loading, failed, reload } = useDetachableReport(root);
  const [selection, setSelection] = useState<PatchDetachSelection>(emptyPatchDetachSelection);
  const [playTarget, setPlayTarget] = useState<PlayTarget>('in-app');
  // The view, the group count and the source columns are settings: the panel reads them back exactly
  // as the user left them the last time. `patchConfig` has no schema, so all read through their pure
  // parsers.
  const [view, setView] = useState<PatchDetachGridView>(() => parsePatchDetachGridView(patchConfig.getPatchSetting('detachGridView')));
  const [savedGroups, setSavedGroups] = useState<number>(() => parsePatchDetachGroupsPerRow(patchConfig.getPatchSetting('detachGroupsPerRow')));
  const [savedWidths, setSavedWidths] = useState<number[]>(() => parsePatchDetachSourceColumnWidths(patchConfig.getPatchSetting('detachSourceColumnWidths'), savedGroups));
  // The deletion settings: which extra kinds the app may delete, and whether a no-selection "Delete
  // all" covers them. Both are read back through their parsers, so a hand-edited config falls back.
  const [extraReasons, setExtraReasons] = useState<PatchDetachExtraDeletableReason[]>(() => parsePatchDetachExtraDeletableReasons(patchConfig.getPatchSetting('detachExtraDeletableReasons')));
  const [includeExtraInAll, setIncludeExtraInAll] = useState<boolean>(() => parsePatchDetachAllIncludesExtra(patchConfig.getPatchSetting('detachDeleteAllIncludesExtra')));
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** The group whose separator is being dragged, so its line can be highlighted. */
  const [resizingGroup, setResizingGroup] = useState<number | undefined>(undefined);
  const [pendingDelete, setPendingDelete] = useState<PatchDetachDeletePlan | undefined>(undefined);
  const [scopeAsk, setScopeAsk] = useState<PatchDetachGridItemKind | undefined>(undefined);
  const [deleting, setDeleting] = useState(false);
  const [outcomes, setOutcomes] = useState<PatchDeleteOutcome[]>();
  const [deleteRefused, setDeleteRefused] = useState(false);
  const [leftovers, setLeftovers] = useState<number | undefined>(undefined);
  const [deepChecks, setDeepChecks] = useState<Record<string, PatchDeepCheckView>>({});
  /** The column whose button started the running check batch; only it may show progress. */
  const [analysisKind, setAnalysisKind] = useState<PatchDetachGridItemKind | undefined>(undefined);
  /** The file the check player was last asked to show, so a delete can close it when it goes. */
  const [lastPlayedPath, setLastPlayedPath] = useState<string | undefined>(undefined);
  /** The pointer position a source-column drag started at. */
  const widthDragRef = useRef<{ index: number, startX: number, startWidth: number, minWidth: number, maxWidth: number, widths: number[], changed: boolean } | undefined>(undefined);
  /** The group count the last "does not fit" toast was about, so resizing does not repeat it. */
  const groupsToastRef = useRef<string | undefined>(undefined);
  /** The scroll box, measured to know how many groups the window can show. */
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [contentWidth, setContentWidth] = useState(0);

  const rows = useMemo(() => buildPatchDetachGrid(report), [report]);
  const items = useMemo(() => flattenPatchDetachGrid(rows), [rows]);
  /** The whole check set, for the check player: the file that is double-clicked is only the focus. */
  const playlist = useMemo(() => buildPatchDetachPlaylist(report), [report]);

  // A rescan after a delete (or a finish job in another window) can take rows away. The selection is
  // derived from the items instead of being pruned in an effect: a key that is not on screen any
  // more simply is not selected, and the anchor of a Shift+click is ignored once its item is gone
  // (see `planPatchDetachClick`).
  const selected = useMemo(() => {
    const selectable = new Set(items.filter((item) => item.selectable).map((item) => item.key));
    const kept = [...selection.selected].filter((key) => selectable.has(key));
    return new Set(kept);
  }, [items, selection.selected]);

  // The size, the time and the duration of every source and every result the grid shows. The detail
  // reader keeps what it already read (keyed by path), so scrolling and rescans do not read a file
  // twice; `missing` files are left out because there is nothing to stat.
  const detailPaths = useMemo(() => items.map((item) => item.path), [items]);
  const details = useDetachableFileDetails(detailPaths);

  // patch: the deep check runs in the main process and reports progress and the outcome over IPC; the
  // panel only keeps the per-file state. A run for a file the panel no longer shows is dropped.
  useEffect(() => {
    const onDeepCheck = (_event: unknown, payload: unknown) => {
      if (typeof payload !== 'object' || payload == null) return;
      const { path } = payload as { path?: unknown };
      if (typeof path !== 'string') return;
      const { progress, done } = payload as {
        progress?: { ratio?: number | undefined } | undefined;
        done?: { status: PatchDeepCheckView['phase'], message?: string | undefined, atSeconds?: number | undefined } | undefined;
      };
      setDeepChecks((previous) => {
        const current = previous[path];
        if (done != null) {
          return { ...previous, [path]: { phase: done.status, message: done.message, atSeconds: done.atSeconds } };
        }
        return { ...previous, [path]: { phase: 'running', ratio: progress?.ratio ?? current?.ratio } };
      });
    };
    ipcRenderer.on(patchDetachableDeepCheckChannel, onDeepCheck);
    return () => { ipcRenderer.off(patchDetachableDeepCheckChannel, onDeepCheck); };
  }, []);

  // A finish job or an export in another window can move the files this panel lists. It rescans when
  // the window gets the focus instead of watching the file system.
  useEffect(() => {
    const onFocus = () => {
      reload().catch((err: unknown) => { console.error('Failed to rescan the detached sources', err); });
    };
    window.addEventListener('focus', onFocus);
    return () => { window.removeEventListener('focus', onFocus); };
  }, [reload]);

  // The window's width decides how many groups fit; a resize only changes what is shown, never the
  // saved layout.
  useEffect(() => {
    const element = scrollRef.current;
    if (element == null) return undefined;
    const update = () => { setContentWidth(element.clientWidth); };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => { observer.disconnect(); };
  }, []);

  const play = useCallback(async (path: string) => {
    try {
      // The external player is what a double click in the file manager does: the system's handler.
      if (playTarget === 'external') {
        await mainApi.patchOpenFileExternal(path);
        return;
      }
      setLastPlayedPath(path);
      await mainApi.patchOpenInspectPlayer({ path, playlist, focusPath: path });
    } catch (err) {
      console.error('Failed to play a file from the deletion check', err);
    }
  }, [playTarget, playlist]);

  const startDeepCheck = useCallback((path: string) => {
    const duration = details.get(path)?.duration;
    setDeepChecks((previous) => ({ ...previous, [path]: { phase: 'running' } }));
    mainApi.patchDeepCheckFile({ path, ...(duration != null && { durationSeconds: duration }) }).catch((error: unknown) => {
      console.error('The deep check failed to start', error);
      setDeepChecks((previous) => ({ ...previous, [path]: { phase: 'unavailable', message: error instanceof Error ? error.message : String(error) } }));
    });
  }, [details]);

  const cancelDeepCheck = useCallback((path: string) => {
    mainApi.patchCancelDeepCheck({ path }).catch((error: unknown) => {
      console.error('Failed to cancel a deep check', error);
    });
  }, []);

  // The batch runner awaits one file at a time; the card state and progress still come over IPC, so a
  // failed start is the only thing it has to handle itself. It resolves with the phase the file ended
  // in, which is what the header's summary of the last batch counts.
  const analyzeFile = useCallback(async (path: string): Promise<PatchDeepCheckView['phase'] | undefined> => {
    const duration = details.get(path)?.duration;
    setDeepChecks((previous) => ({ ...previous, [path]: { phase: 'running' } }));
    try {
      const result = await mainApi.patchDeepCheckFile({ path, ...(duration != null && { durationSeconds: duration }) });
      const status = result?.status;
      // `running` means the file was already being decoded elsewhere; that run reports over IPC, so
      // this batch has no outcome of its own to count for it.
      return status === 'ok' || status === 'failed' || status === 'canceled' || status === 'unavailable' ? status : undefined;
    } catch (error) {
      setDeepChecks((previous) => ({ ...previous, [path]: { phase: 'unavailable', message: error instanceof Error ? error.message : String(error) } }));
      return 'unavailable';
    }
  }, [details]);
  const analysis = useDetachableAnalysis(analyzeFile);

  const selectedSourceCount = useMemo(() => countPatchDetachSelection({ items, selection, kind: 'source' }), [items, selection]);
  const selectedResultCount = useMemo(() => countPatchDetachSelection({ items, selection, kind: 'result' }), [items, selection]);
  const allSourceCount = useMemo(() => items.filter((item) => item.kind === 'source' && item.selectable).length, [items]);
  const allResultCount = useMemo(() => items.filter((item) => item.kind === 'result' && item.selectable).length, [items]);

  const { start: startAnalysis, stop: stopAnalysis, running: analysisRunning, done: analysisDone, total: analysisTotal, path: analysisPath, summary: analysisSummary, clearSummary: clearAnalysisSummary } = analysis;
  const requestAnalyze = useCallback((kind: PatchDetachGridItemKind) => {
    if (analysisRunning) {
      stopAnalysis();
      return;
    }
    setAnalysisKind(kind);
    if (countPatchDetachSelection({ items, selection, kind }) > 0) {
      startAnalysis(buildPatchDetachAnalysisTargets({ items, selection, kind, scope: patchDetachAnalyzeScopeForKind(kind) }));
      return;
    }
    // Nothing of this column is selected: ask what to scan instead of decoding everything unasked.
    setScopeAsk(kind);
  }, [analysisRunning, items, selection, startAnalysis, stopAnalysis]);

  const scanScope = useCallback((scope: PatchDetachAnalyzeScope) => {
    const kind = scopeAsk;
    setScopeAsk(undefined);
    if (kind == null) return;
    setAnalysisKind(kind);
    startAnalysis(buildPatchDetachAnalysisTargets({ items, selection, kind, scope }));
  }, [items, scopeAsk, selection, startAnalysis]);

  // Only the column that started the batch shows its progress; the other one waits for it to end, so a
  // progress number never claims a check of files that are not being checked.
  const analysisOwner = analysisRunning ? analysisKind : undefined;
  const analysisRatio = analysisPath == null ? undefined : deepChecks[analysisPath]?.ratio;

  // Only a selected source that still has a kept result on disk may be deleted; a selected result or
  // a grey source is part of the selection but not part of the delete. With nothing selected at all the
  // button offers every source that is ready for deletion instead of doing nothing.
  const selectedSourcePaths = useMemo(
    () => items.filter((item) => item.kind === 'source' && item.deletable && selected.has(item.key)).map((item) => item.path),
    [items, selected],
  );
  const deletePlan = useMemo(
    () => planPatchDetachDelete({ items, selected, includeExtraInAll }),
    [includeExtraInAll, items, selected],
  );
  const deletableCount = useMemo(() => items.filter((item) => item.kind === 'source' && item.deletable).length, [items]);
  // Sources that are deletable only because the user allowed their kind in the settings. With nothing
  // selected they are left out of "Delete all" unless that is allowed too, and the button says so.
  const hasExtraSources = useMemo(() => items.some((item) => item.kind === 'source' && item.extraDeletable === true), [items]);
  const pendingFiles = useMemo(
    () => (pendingDelete?.paths ?? []).map((path) => ({ path, size: details.get(path)?.size, duration: details.get(path)?.duration })),
    [details, pendingDelete],
  );

  const runDelete = useCallback(async (paths: string[]) => {
    setPendingDelete(undefined);
    setDeleting(true);
    setOutcomes(undefined);
    setDeleteRefused(false);
    setLeftovers(undefined);
    try {
      const result = await mainApi.patchDeleteDetachedSources({ workRoot: root, paths });
      if (!result.ok) {
        setDeleteRefused(true);
        return;
      }
      setOutcomes(result.outcomes);
      const deletedPaths = result.outcomes.filter((outcome) => outcome.status === 'deleted').map((outcome) => outcome.path);
      if (deletedPaths.length > 0) setLeftovers(await countRelatedSiblings(deletedPaths));
      // The check player may be showing one of the files that just went away: close it instead of
      // leaving it on a missing file (the panel opens it again on the next double click).
      if (lastPlayedPath != null && deletedPaths.some((path) => path === lastPlayedPath)) {
        setLastPlayedPath(undefined);
        await mainApi.patchCloseInspectWindow().catch((error: unknown) => {
          console.error('Failed to close the check player', error);
        });
      }
    } catch (error) {
      console.error('Failed to delete the detached sources', error);
      setDeleteRefused(true);
    } finally {
      setDeleting(false);
      setSelection(emptyPatchDetachSelection());
      // The rows just changed on disk, so this must not be answered by the main process's cache.
      await reload({ force: true });
    }
  }, [lastPlayedPath, reload, root]);

  const playFromRow = useCallback((path: string) => {
    play(path).catch((err: unknown) => { console.error('Failed to play a file from the deletion check', err); });
  }, [play]);

  const locate = useCallback((path: string) => {
    window.electron.patchRevealPath(path).catch((err: unknown) => {
      console.error('Failed to show a file in the file manager', err);
    });
  }, []);

  // The whole card is the click target, so the selection planner receives the pixel the user aimed at
  // and the modifier keys; it decides between click, Ctrl-click and Shift-click.
  const selectItem = useCallback(({ key, extend, toggle }: { key: string, extend: boolean, toggle: boolean }) => {
    setSelection((previous) => planPatchDetachClick({ items, selection: previous, key, extend, toggle }));
  }, [items]);

  const selectAllOfKind = useCallback((kind: PatchDetachGridItemKind) => {
    setSelection((previous) => planPatchDetachSelectKind({ items, selection: previous, kind }));
  }, [items]);

  const selectNoneOfKind = useCallback((kind: PatchDetachGridItemKind) => {
    setSelection((previous) => planPatchDetachSelectNoneKind({ items, selection: previous, kind }));
  }, [items]);

  const changeView = useCallback((next: PatchDetachGridView) => {
    setView(next);
    patchConfig.setPatchSetting('detachGridView', next);
  }, []);

  const changeGroups = useCallback((next: number) => {
    const groups = parsePatchDetachGroupsPerRow(next);
    const widths = parsePatchDetachSourceColumnWidths(savedWidths, groups);
    setSavedGroups(groups);
    setSavedWidths(widths);
    patchConfig.setPatchSetting('detachGroupsPerRow', groups);
    patchConfig.setPatchSetting('detachSourceColumnWidths', widths);
  }, [savedWidths]);

  // Dragging a group's boundary moves its source column freely: the width follows the pointer pixel
  // by pixel, it only stops at one card (the narrowest a source column may be) and at the point where
  // one result card would no longer fit. The source card itself keeps the view's card width, so the
  // results reflow instead of shrinking. The drag starts from the width the window actually shows
  // (which a narrow window may have clamped), so merely touching the handle never rewrites the saved
  // value. The pointer stays captured on the handle and the new width is stored once, on release.
  const startResize = useCallback((index: number, sourceWidth: number, minWidth: number, maxWidth: number, event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.userSelect = 'none';
    const widths = parsePatchDetachSourceColumnWidths(savedWidths, savedGroups);
    widths[index] = sourceWidth;
    setResizingGroup(index);
    widthDragRef.current = { index, startX: event.clientX, startWidth: sourceWidth, minWidth, maxWidth, widths, changed: false };
  }, [savedGroups, savedWidths]);

  const resize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = widthDragRef.current;
    if (drag == null) return;
    const next = Math.round(Math.min(drag.maxWidth, Math.max(drag.minWidth, drag.startWidth + event.clientX - drag.startX)));
    if (next === drag.widths[drag.index]) return;
    const widths = [...drag.widths];
    widths[drag.index] = next;
    drag.widths = widths;
    drag.changed = true;
    setSavedWidths(widths);
  }, []);

  const finishResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = widthDragRef.current;
    if (drag == null) return;
    widthDragRef.current = undefined;
    setResizingGroup(undefined);
    document.body.style.userSelect = '';
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag.changed) patchConfig.setPatchSetting('detachSourceColumnWidths', drag.widths);
  }, []);

  // A window closed in the middle of a drag must not leave the page unselectable.
  useEffect(() => () => { document.body.style.userSelect = ''; }, []);

  const resetLayout = useCallback(() => {
    const widths = parsePatchDetachSourceColumnWidths(undefined, patchDetachGroupsPerRowDefault);
    setView(patchDetachGridDefaultView);
    setSavedGroups(patchDetachGroupsPerRowDefault);
    setSavedWidths(widths);
    patchConfig.setPatchSetting('detachGridView', patchDetachGridDefaultView);
    patchConfig.setPatchSetting('detachGroupsPerRow', patchDetachGroupsPerRowDefault);
    patchConfig.setPatchSetting('detachSourceColumnWidths', widths);
  }, []);

  // The policy is applied by the main process when it builds the report, so a saved setting takes
  // effect through a forced rescan: the rows' deletable flags and the header counts change together,
  // and the delete re-check then reads the same setting.
  const saveDeleteSettings = useCallback((next: { extraReasons: PatchDetachExtraDeletableReason[], includeExtraInAll: boolean }) => {
    patchConfig.setPatchSetting('detachExtraDeletableReasons', next.extraReasons);
    patchConfig.setPatchSetting('detachDeleteAllIncludesExtra', next.includeExtraInAll);
    setExtraReasons(next.extraReasons);
    setIncludeExtraInAll(next.includeExtraInAll);
    setSettingsOpen(false);
    reload({ force: true }).catch((err: unknown) => { console.error('Failed to rescan the detached sources', err); });
  }, [reload]);

  const runDeleteFromDialog = useCallback(() => {
    if (pendingDelete == null) return;
    runDelete(pendingDelete.paths).catch((err: unknown) => { console.error('Failed to delete the detached sources', err); });
  }, [pendingDelete, runDelete]);

  const requestDelete = useCallback(async () => {
    if (deletePlan.paths.length === 0) return;
    // The rows can be minutes old: a result may disappear between the panel's scan and this click,
    // which can turn a source into an extra-only one. Decide the confirmation from a fresh report so
    // "forced when an extra kind is in the batch" still holds then. If the re-scan fails, ask rather
    // than skip the confirmation: a delete the app cannot re-check is not worth doing unconfirmed.
    let plan: PatchDetachDeletePlan;
    try {
      const freshReport = await mainApi.patchDetachableReport(root, { force: true });
      const freshItems = flattenPatchDetachGrid(buildPatchDetachGrid(freshReport));
      plan = planPatchDetachDelete({ items: freshItems, selected, includeExtraInAll });
    } catch (error) {
      console.error('Failed to re-scan the detached sources before deleting', error);
      setPendingDelete(deletePlan);
      return;
    }
    if (plan.paths.length === 0) {
      // Nothing the user picked is deletable any more: show the fresh rows instead of a dead dialog.
      reload({ force: true }).catch((error: unknown) => { console.error('Failed to reload the detached sources', error); });
      return;
    }
    // Deleting everything because nothing is selected is always asked, even when the permanent-delete
    // confirmation was turned off: that setting is for a selection the user made on purpose. A delete
    // that reaches a source the app cannot prove finished is asked too, whatever that setting says.
    const ask = plan.scope === 'all' || plan.extraCount > 0 || (patchConfig.getPatchSetting('confirmDetachedSrcPermanentDelete') ?? true);
    if (ask) {
      setPendingDelete(plan);
      return;
    }
    runDelete(plan.paths).catch((error: unknown) => { console.error('Failed to delete the detached sources', error); });
  }, [deletePlan, includeExtraInAll, reload, root, runDelete, selected]);

  const selectionCount = deletePlan.paths.length;
  const deleteDisabledReason = selectedSourceCount === 0
    ? (deletableCount === 0 ? t('No source video in this work folder is ready for deletion.') : t('Select a source video to delete it for good.'))
    : t('The selected sources cannot be deleted: none has a kept result on disk, or its kind is not allowed in the deletion settings.');
  const allDeleteTitle = hasExtraSources && !includeExtraInAll
    ? t('Nothing is selected, so every source with a kept result will be deleted. Sources without one are deleted only when you select them.')
    : t('Nothing is selected, so every source that is ready for deletion will be deleted.');
  const deleteTitle = selectionCount === 0
    ? deleteDisabledReason
    : (deletePlan.scope === 'all' ? allDeleteTitle : t('Deleting is permanent. The results stay.'));
  const allDeleteLabel = hasExtraSources && !includeExtraInAll
    ? t('Delete all {{count}} with results for good', { count: selectionCount })
    : t('Delete all {{count}} for good', { count: selectionCount });
  const deleteLabel = deletePlan.scope === 'all'
    ? allDeleteLabel
    : t('Delete {{count}} for good', { count: selectionCount });
  const summary = outcomes == null ? undefined : summarizePatchDeleteOutcomes(outcomes);
  const problems = outcomes?.filter((outcome) => outcome.status !== 'deleted') ?? [];

  const problemLabel = (status: PatchDeleteOutcome['status']) => {
    switch (status) {
      case 'locked': { return t('Still in use by another program.'); }
      case 'open-elsewhere': { return t('Open in one of the app windows. Close it there first.'); }
      case 'not-deletable': { return t('Not deletable any more. Nothing was deleted.'); }
      case 'missing': { return t('The file was already gone.'); }
      case 'failed': { return t('The file could not be deleted.'); }
      default: { return t('Deleted'); }
    }
  };

  const reloadFromButton = useCallback(() => {
    reload({ force: true }).catch((err: unknown) => { console.error('Failed to rescan the detached sources', err); });
  }, [reload]);

  const cardWidth = getPatchDetachTileWidth(view);
  const cardLayout = view === 'list' ? 'list' : 'tile';
  // The width used by the layout math; the list preset has no columns, so any card width does.
  const layoutTileWidth = cardWidth ?? 200;
  const { groups: fittedGroups, maxSourceWidth, minSourceWidth, sourceWidths } = useMemo(() => computePatchDetachGroupLayout({
    availableWidth: Math.max(0, contentWidth - patchDetachGridPaddingX * 2),
    tileWidth: layoutTileWidth,
    savedGroups,
    savedSourceWidths: savedWidths,
  }), [contentWidth, layoutTileWidth, savedGroups, savedWidths]);
  const groupsPerRow = view === 'list' ? 1 : fittedGroups;
  const groupRows = useMemo(() => chunkGridRows(rows, groupsPerRow), [groupsPerRow, rows]);

  // The saved layout is a maximum, but a user who asks for six groups in a narrow window should not
  // have to guess why four appeared. The toast is debounced so dragging the window edge does not
  // repeat it, and the same (requested, shown) pair is only announced once - widening the window
  // resets it, so narrowing again explains itself again.
  useEffect(() => {
    if (view === 'list' || contentWidth <= 0 || savedGroups <= fittedGroups) {
      groupsToastRef.current = undefined;
      return undefined;
    }
    const key = `${savedGroups}:${fittedGroups}`;
    const timer = setTimeout(() => {
      if (groupsToastRef.current === key) return;
      groupsToastRef.current = key;
      getSwal().toast.fire({
        icon: 'warning',
        text: t('The current layout cannot fit {{requested}} groups, so {{shown}} are used.', { requested: savedGroups, shown: fittedGroups }),
      });
    }, 350);
    return () => { clearTimeout(timer); };
  }, [contentWidth, fittedGroups, savedGroups, t, view]);
  const viewLabel = (id: PatchDetachGridView) => {
    switch (id) {
      case 'list': { return t('List'); }
      case 'compact': { return t('Compact'); }
      case 'large': { return t('Large'); }
      default: { return t('Standard'); }
    }
  };

  // The full decode check button of one column. The column that started the batch shows the counter
  // and the percentage of the file being decoded; the other column waits, disabled, so it never starts
  // a second batch that the queue would silently ignore.
  const checkButton = (kind: PatchDetachGridItemKind) => {
    const header = describePatchCheckHeader({ ownerKind: analysisOwner, kind, running: analysisRunning, ratio: analysisRatio });
    if (header.state === 'running') {
      return (
        <button
          type="button"
          onClick={() => { requestAnalyze(kind); }}
          style={chipButtonStyle}
          title={t('Stop the check. The file being decoded now is stopped too.')}
        >
          {header.percent == null
            ? t('Checking {{done}} of {{total}}', { done: analysisDone, total: analysisTotal })
            : t('Checking {{done}} of {{total}} ({{percent}}%)', { done: analysisDone, total: analysisTotal, percent: header.percent })}
        </button>
      );
    }

    const button = (
      <button
        type="button"
        onClick={() => { requestAnalyze(kind); }}
        disabled={header.state === 'blocked' || (kind === 'source' ? allSourceCount : allResultCount) === 0}
        style={chipButtonStyle}
      >
        {kind === 'source' ? t('Check all sources') : t('Check all results')}
      </button>
    );
    // A disabled button takes no pointer events in Chromium, so the tooltip sits on a wrapper that
    // still receives the hover.
    return (
      <span
        title={header.state === 'blocked'
          ? t('Another check is running. Stop it to start this one.')
          : t('Runs the full decode check on the files selected in this column, one after another; with nothing selected a dialog asks what to check. Every file is read completely, so a large batch takes a long time, and a batch can be stopped and started again.')}
      >
        {button}
      </span>
    );
  };

  const sourceActions = (
    <>
      <span style={{ fontWeight: 600 }}>{t('Source video')}</span>
      {selectedSourceCount > 0 && <span style={{ color: 'var(--gray-11)' }}>{t('{{count}} selected', { count: selectedSourceCount })}</span>}
      <button type="button" onClick={() => { selectAllOfKind('source'); }} style={chipButtonStyle}>{t('Select all')}</button>
      <button type="button" onClick={() => { selectNoneOfKind('source'); }} style={chipButtonStyle}>{t('Select none')}</button>
      {checkButton('source')}
      <button
        type="button"
        onClick={() => { requestDelete().catch((error: unknown) => { console.error('Failed to start the delete', error); }); }}
        disabled={selectionCount === 0 || deleting}
        title={deleteTitle}
        style={{
          ...chipButtonStyle,
          color: selectionCount === 0 ? 'var(--gray-11)' : 'white',
          backgroundColor: selectionCount === 0 ? undefined : 'var(--red-9)',
          borderColor: selectionCount === 0 ? undefined : 'var(--red-9)',
        }}
      >
        {deleting ? t('Deleting...') : deleteLabel}
      </button>
    </>
  );

  const resultActions = (
    <>
      <span style={{ fontWeight: 600 }}>{t('Results')}</span>
      {selectedResultCount > 0 && <span style={{ color: 'var(--gray-11)' }}>{t('{{count}} selected', { count: selectedResultCount })}</span>}
      <button type="button" onClick={() => { selectAllOfKind('result'); }} style={chipButtonStyle}>{t('Select all')}</button>
      <button type="button" onClick={() => { selectNoneOfKind('result'); }} style={chipButtonStyle}>{t('Select none')}</button>
      {checkButton('result')}
    </>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--gray-1)', color: 'var(--gray-12)' }}>
      <div style={{ display: 'flex', gap: '.6em', alignItems: 'baseline', padding: '.6em .8em', borderBottom: '1px solid var(--gray-6)', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, fontSize: patchCheckText.windowTitle }}>{t('Deletion check')}</span>
        <span style={{ color: 'var(--gray-11)', fontSize: patchCheckText.toolbar, wordBreak: 'break-all' }}>{report?.detachedSrcMediaDir ?? root}</span>
        {/* A UNC root answers every folder read with a network round trip; saying so explains a
            window that takes a few seconds to fill in. */}
        {(report?.detachedSrcMediaDir ?? root)?.startsWith(String.raw`\\`) === true && (
          <span style={{ fontSize: patchCheckText.toolbar, color: 'var(--gray-11)' }}>{t('This folder is on a network share, so reading it takes longer.')}</span>
        )}
        {report != null && (
          <>
            <span style={{ fontSize: patchCheckText.toolbar, color: 'var(--gray-11)' }}>{t('{{count}} sources waiting for deletion', { count: report.totals.sources })}</span>
            <span style={{ fontSize: patchCheckText.toolbar, color: 'var(--gray-11)' }}>{t('{{count}} ready to delete', { count: report.totals.deletable })}</span>
          </>
        )}

        <span style={{ flexGrow: 1 }} />

        {/* The play target and the density are the panel's two display settings, side by side. */}
        <span style={{ display: 'flex', gap: '.35em', alignItems: 'center', fontSize: patchCheckText.toolbar }}>
          {t('Double click plays with')}
          <Select
            aria-label={t('Double click plays with')}
            value={playTarget}
            onChange={(event) => { setPlayTarget(event.target.value === 'external' ? 'external' : 'in-app'); }}
            style={{ minWidth: '12em', padding: '.25em .35em' }}
          >
            <option value="in-app">{t('This app (check player)')}</option>
            <option value="external">{t('Another program (like a double click)')}</option>
          </Select>
        </span>

        <span style={{ display: 'flex', gap: '.35em', alignItems: 'center', fontSize: patchCheckText.toolbar }}>
          {t('View')}
          <Select
            aria-label={t('View')}
            value={view}
            onChange={(event) => { changeView(parsePatchDetachGridView(event.target.value)); }}
            style={{ minWidth: '7em', padding: '.25em .35em' }}
          >
            {patchDetachGridViews.map((id) => <option key={id} value={id}>{viewLabel(id)}</option>)}
          </Select>
        </span>

        <span style={{ display: 'flex', gap: '.35em', alignItems: 'center', fontSize: patchCheckText.toolbar }}>
          {t('Groups per row')}
          <Select
            aria-label={t('Groups per row')}
            value={String(savedGroups)}
            onChange={(event) => { changeGroups(Number(event.target.value)); }}
            disabled={view === 'list'}
            style={{ minWidth: '6em', padding: '.25em .35em' }}
          >
            {patchDetachGroupOptions.map((count) => <option key={count} value={count}>{t('{{count}} groups', { count })}</option>)}
          </Select>
        </span>

        <DialogButton onClick={resetLayout}>{t('Reset layout')}</DialogButton>

        <DialogButton onClick={reloadFromButton} disabled={loading || deleting}>{t('Refresh')}</DialogButton>
        <DialogButton
          disabled={report?.detachedSrcMediaDir == null}
          onClick={() => {
            const dir = report?.detachedSrcMediaDir;
            if (dir != null) mainApi.patchOpenWorkPath(dir).catch((err: unknown) => { console.error('Failed to open the folder', err); });
          }}
        >
          {t('Open the folder')}
        </DialogButton>

        {/* The deletion settings: which extra kinds may be deleted (all off by default). */}
        <DialogButton
          onClick={() => { setSettingsOpen(true); }}
          title={t('Deletion settings')}
          aria-label={t('Deletion settings')}
          style={{ padding: '.35em .7em' }}
        >
          ⚙
        </DialogButton>
      </div>

      {/* What the last finished batch of full decode checks found. The four outcomes stay apart: a
          file that failed, one that was stopped and one whose check could not start are different
          answers, and the user acts on them differently. */}
      {analysisSummary != null && analysisSummary.total > 0 && (
        <div style={{ padding: '.4em .8em', borderBottom: '1px solid var(--gray-6)', background: 'var(--gray-3)', fontSize: patchCheckText.toolbar, display: 'flex', gap: '.6em', alignItems: 'baseline', flexWrap: 'wrap' }}>
          <b>{t('Last check: {{count}} files', { count: analysisSummary.total })}</b>
          {analysisSummary.passed > 0 && <span style={{ color: 'var(--green-9)' }}>{t('{{count}} passed', { count: analysisSummary.passed })}</span>}
          {analysisSummary.failed > 0 && <span style={{ color: 'var(--red-9)' }}>{t('{{count}} failed', { count: analysisSummary.failed })}</span>}
          {analysisSummary.stopped > 0 && <span style={{ color: 'var(--gray-11)' }}>{t('{{count}} stopped', { count: analysisSummary.stopped })}</span>}
          {analysisSummary.unavailable > 0 && <span style={{ color: 'var(--orange-9)' }}>{t('{{count}} could not run', { count: analysisSummary.unavailable })}</span>}
          <span style={{ flexGrow: 1 }} />
          <button type="button" onClick={clearAnalysisSummary} style={{ background: 'transparent', border: 'none', color: 'var(--gray-11)', cursor: 'pointer' }}>{t('Dismiss')}</button>
        </div>
      )}

      {outcomes != null && summary != null && (
        <div style={{ padding: '.45em .8em', borderBottom: '1px solid var(--gray-6)', background: 'var(--gray-3)', fontSize: patchCheckText.toolbar }}>
          <div style={{ display: 'flex', gap: '.6em', alignItems: 'baseline', flexWrap: 'wrap' }}>
            <b>{t('Deleted {{deleted}} of {{total}} source videos.', { deleted: summary.deleted, total: outcomes.length })}</b>
            {leftovers != null && leftovers > 0 && <span style={{ color: 'var(--gray-11)' }}>{t('{{count}} related files were left next to them (a project file, sidecars).', { count: leftovers })}</span>}
            <span style={{ flexGrow: 1 }} />
            <button type="button" onClick={() => { setOutcomes(undefined); setLeftovers(undefined); }} style={{ background: 'transparent', border: 'none', color: 'var(--gray-11)', cursor: 'pointer' }}>{t('Dismiss')}</button>
          </div>
          {problems.map((problem) => (
            <div key={`${problem.path}|${problem.status}`} style={{ color: problem.status === 'not-deletable' || problem.status === 'missing' ? 'var(--gray-11)' : 'var(--red-9)' }}>
              {problem.path === '' ? problemLabel(problem.status) : `${basename(problem.path)} — ${problemLabel(problem.status)}`}
              {problem.detail != null ? ` (${problem.detail})` : ''}
            </div>
          ))}
        </div>
      )}

      {deleteRefused && (
        <div style={{ padding: '.45em .8em', borderBottom: '1px solid var(--gray-6)', color: 'var(--red-9)', fontSize: patchCheckText.toolbar }}>
          {t('The delete could not run. Another job is using this work area, or the file manager refused the request.')}
        </div>
      )}

      {/* The one scroll area of the window: the sticky action bar and every group row live in it. The
          action bar measures the width, the layout decides how many groups fit. */}
      <div ref={scrollRef} style={{ overflowY: 'auto', overflowX: 'auto', flexGrow: 1, minHeight: 0 }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--gray-2)', borderBottom: '1px solid var(--gray-6)' }}>
          {/* One left-aligned bar: the source actions, the result actions and the hints are segments
              of the same row, separated by rules instead of being pushed to opposite edges. */}
          <div style={{ display: 'flex', gap: '.5em', alignItems: 'center', flexWrap: 'wrap', padding: `.4em ${patchDetachGridPaddingX}px`, fontSize: patchCheckText.toolbar }}>
            {sourceActions}
            <ActionBarSeparator />
            {resultActions}
            <ActionBarSeparator />
            <span style={{ color: 'var(--gray-11)' }}>{t('Ctrl+click selects several cards')}</span>
            <span style={{ color: 'var(--gray-11)' }}>{t('Shift+click selects a range')}</span>
            <span style={{ color: 'var(--gray-11)' }}>{t('Double click plays')}</span>
          </div>
        </div>

        {loading && report == null && <div style={{ padding: '.6em .8em', color: 'var(--gray-11)' }}>{t('Reading...')}</div>}
        {failed && <div style={{ padding: '.6em .8em', color: 'var(--red-9)' }}>{t('The work folder could not be read.')}</div>}
        {!loading && !failed && report == null && <div style={{ padding: '.6em .8em', color: 'var(--gray-11)' }}>{t('Open the check from the work folders list.')}</div>}
        {report != null && rows.length === 0 && (
          <div style={{ padding: '.6em .8em', color: 'var(--gray-11)' }}>{t('No source is waiting for deletion in this work folder.')}</div>
        )}

        {groupRows.map((groupRow, rowIndex) => (
          <section
            key={`${groupRow[0]?.source.path ?? 'group'}|${groupRow.at(-1)?.source.path ?? ''}`}
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${groupsPerRow}, minmax(0, 1fr))`,
              alignItems: 'start',
              gap: patchDetachGroupGap,
              padding: `.5em ${patchDetachGridPaddingX}px`,
              borderBottom: '1px solid var(--gray-5)',
            }}
          >
            {groupRow.map((row, groupIndex) => (
              <DetachSourceGroup
                key={row.source.path}
                row={row}
                // The numbers run through the whole list (1, 2 / 3, 4), not per row.
                order={rowIndex * groupsPerRow + groupIndex + 1}
                groupIndex={groupIndex}
                listMode={view === 'list'}
                cardLayout={cardLayout}
                cardWidth={cardWidth}
                sourceWidth={sourceWidths[groupIndex] ?? minSourceWidth}
                minWidth={minSourceWidth}
                maxWidth={maxSourceWidth}
                resizeActive={resizingGroup === groupIndex}
                selected={selected}
                details={details}
                deepChecks={deepChecks}
                onSelect={selectItem}
                onPlay={playFromRow}
                onDeepCheck={startDeepCheck}
                onCancelDeepCheck={cancelDeepCheck}
                onLocate={locate}
                onResizeStart={startResize}
                onResizeMove={resize}
                onResizeEnd={finishResize}
              />
            ))}
          </section>
        ))}
      </div>

      {pendingDelete != null && (
        <DetachDeleteDialog
          files={pendingFiles}
          scope={pendingDelete.scope}
          skipped={pendingDelete.scope === 'all' ? 0 : selectedSourceCount - selectedSourcePaths.length}
          extraCount={pendingDelete.extraCount}
          busy={deleting}
          onCancel={() => { setPendingDelete(undefined); }}
          onConfirm={runDeleteFromDialog}
        />
      )}

      {scopeAsk != null && (
        <DetachAnalyzeScopeDialog
          kind={scopeAsk}
          sourceCount={allSourceCount}
          resultCount={allResultCount}
          onCancel={() => { setScopeAsk(undefined); }}
          onScan={scanScope}
        />
      )}

      {settingsOpen && (
        <DetachDeleteSettingsDialog
          extraReasons={extraReasons}
          includeExtraInAll={includeExtraInAll}
          onCancel={() => { setSettingsOpen(false); }}
          onSave={saveDeleteSettings}
        />
      )}
    </div>
  );
}
