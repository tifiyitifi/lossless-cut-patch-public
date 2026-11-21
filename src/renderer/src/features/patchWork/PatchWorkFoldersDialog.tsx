import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { FaCog, FaLock, FaLockOpen } from 'react-icons/fa';

import { getPathBaseName } from '../../../../common/features/patchData/videoExtensions';
import type { PatchWorkRootPathInfo } from '../../../../common/features/patchFinish';
import type {
  PatchOverviewGroupId,
  PatchOverviewResultFolder,
  PatchOverviewSource,
  WorkFolderRootState,
  WorkFolderRow,
} from '../../../../common/features/patchResultsOverview';
import { buildWorkFolderRows, getPatchOverviewSourceStatus, initialExpandedRoot, moveOverviewSelection } from '../../../../common/features/patchResultsOverview';

import { DialogButton } from '../../components/Button';
import * as Dialog from '../../components/Dialog';
import { isMac, isWindows, showItemInFolder } from '../../util';
import { usePatchPrivacyLock } from '../patchPrivacyLock/PatchPrivacyLockProvider';
import PatchPrivacyLockUnlockForm from '../patchPrivacyLock/PatchPrivacyLockUnlockForm';
import { buildSourceListDetail } from '../patchSourceList/sourceListDetails';
import { useWorkFolderFileDetails } from './useWorkFolderFileDetails';
import type { WorkFolderFileDetails } from './useWorkFolderFileDetails';

/** The fork is Windows-only in practice; the shared helper covers mac too, like the manifest. */
const caseInsensitivePaths = isWindows || isMac;

/**
The work folders and their results (fork-owned).

This is the combined dialog: the work roots the app has created (the old `open-workpath-list`) and,
under each of them, what became of every source (the old results overview). Only the expanded roots
are read; the most recent one (or the session's own root) starts expanded, so opening the dialog
still shows the current results first. The rows are built by
`common/features/patchResultsOverview/workFolders`; this component only renders them.
*/

/** Is the key event going to a field or a control that handles its own keys? */
function isInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  // The filter and the password field handle Enter/arrows themselves, and buttons plus the help
  // summary must keep their native Enter/Space. Otherwise the dialog's window listener would both
  // press the focused button and activate the selected row behind it.
  return target.tagName === 'INPUT'
    || target.tagName === 'TEXTAREA'
    || target.tagName === 'SELECT'
    || target.tagName === 'BUTTON'
    || target.tagName === 'SUMMARY'
    || target.tagName === 'A'
    || target.isContentEditable;
}

const chipStyle: CSSProperties = { background: 'var(--gray-3)', border: '1px solid var(--gray-6)', borderRadius: '.3em', padding: '.15em .5em', fontSize: '.82em', whiteSpace: 'nowrap' };

/** The small lock and gear buttons at the top right, next to the close button. */
const iconButtonStyle: CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '1.9em', height: '1.9em', padding: 0, border: '1px solid transparent', borderRadius: '.3em', background: 'transparent', color: 'var(--gray-12)', cursor: 'pointer' };

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

/** The row's second line: the same `duration · size` the source list's detail line shows. */
function fileDetailText(details: WorkFolderFileDetails | undefined) {
  const parts = buildSourceListDetail(details);
  return parts.length === 0 ? undefined : parts.map((part) => part.text).join(' · ');
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
    case 'finishedSkip': { return 'Skipped'; }
    default: { return 'Source gone'; }
  }
}

/** The line a root shows instead of results, and its i18n key. */
function messageTextKey(message: WorkFolderRow['message']) {
  switch (message) {
    case 'error': { return 'The work folder could not be read.'; }
    case 'unreadable': { return 'A results folder could not be read.'; }
    case 'empty': { return 'No sources or results in this work folder.'; }
    default: { return 'Reading...'; }
  }
}

export default function PatchWorkFoldersDialog({ onHide, defaultRoot, workDirName, onOpenSettings, keysSuspended = false }: {
  onHide: () => void;
  defaultRoot: string | undefined;
  workDirName: string;
  /** Opens the working-directory settings (which hosts the privacy-lock section). */
  onOpenSettings: () => void;
  /** Another dialog (the settings) is on top: leave the list keys alone. */
  keysSuspended?: boolean;
}) {
  const { t } = useTranslation();
  const privacyLock = usePatchPrivacyLock();
  const [roots, setRoots] = useState<PatchWorkRootPathInfo[]>([]);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  /** The group rows the user folded, by row key; every group starts open. */
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() => new Set());
  const [states, setStates] = useState<Record<string, WorkFolderRootState>>({});
  /** Is the inline password prompt open? The lock never prompts on its own. */
  const [unlockVisible, setUnlockVisible] = useState(false);
  const statesRef = useRef<Record<string, WorkFolderRootState>>({});
  const inFlightRef = useRef(new Set<string>());
  const mountedRef = useRef(true);
  // The size and the duration of every file of an expanded root (see `useWorkFolderFileDetails`).
  const { details, progress: detailProgress, addOverview } = useWorkFolderFileDetails();

  const historyLocked = privacyLock?.status.enabled === true && !privacyLock.status.unlocked;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const setRootState = useCallback((root: string, state: WorkFolderRootState) => {
    statesRef.current = { ...statesRef.current, [root]: state };
    if (mountedRef.current) setStates(statesRef.current);
  }, []);

  // One root at a time, and only when it is opened: the history can hold a thousand folders, so
  // opening the dialog must not read them all. A root that was read once is kept for the session
  // of the dialog, so folding it away and back does not scan again.
  const scan = useCallback((root: string) => {
    if (inFlightRef.current.has(root) || statesRef.current[root] != null) return;
    inFlightRef.current.add(root);
    setRootState(root, { loading: true });
    window.electron.patchResultsOverview(root)
      .then((overview) => {
        setRootState(root, { overview });
        // The rows cannot be read before the folder is; the sizes and durations follow in the
        // background, so the list is usable while they arrive.
        addOverview(overview);
      })
      .catch((err: unknown) => {
        console.error('Failed to read the results overview', err);
        setRootState(root, { error: true });
      })
      .finally(() => { inFlightRef.current.delete(root); });
  }, [addOverview, setRootState]);

  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      try {
        const listing = await window.electron.patchListWorkRoots(defaultRoot);
        if (cancelled) return;
        setRoots(listing.roots);
        const first = initialExpandedRoot(listing.roots, defaultRoot, { caseInsensitive: caseInsensitivePaths });
        if (first != null) {
          setExpanded(new Set([first]));
          scan(first);
        }
      } catch (err) {
        console.error('Failed to read the work roots', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    read();
    return () => { cancelled = true; };
  }, [defaultRoot, historyLocked, scan]);

  const toggle = useCallback((root: string) => {
    if (expanded.has(root)) {
      setExpanded(new Set([...expanded].filter((entry) => entry !== root)));
      return;
    }
    setExpanded(new Set([...expanded, root]));
    scan(root);
  }, [expanded, scan]);

  /**
  Fold or open one group. The rows a fold hides leave the list, so the selection follows the group
  title instead of jumping to whatever row happens to take the old index.
  */
  const toggleGroup = useCallback((row: WorkFolderRow, index: number) => {
    setCollapsedGroups((previous) => {
      const next = new Set(previous);
      if (next.has(row.key)) next.delete(row.key);
      else next.add(row.key);
      return next;
    });
    setSelected(index);
  }, []);

  const rows = useMemo(() => buildWorkFolderRows({
    roots,
    currentRoot: defaultRoot,
    expanded,
    collapsedGroups,
    states: new Map(Object.entries(states)),
    filter,
    caseInsensitive: caseInsensitivePaths,
  }), [collapsedGroups, defaultRoot, expanded, filter, roots, states]);

  const selectable = useMemo(() => rows.map((row) => row.enabled), [rows]);
  const lastRow = Math.max(0, rows.length - 1);
  const safeSelected = moveOverviewSelection(selectable, Math.min(selected, lastRow), 0);

  const reveal = useCallback((path: string | undefined) => {
    if (path == null) return;
    showItemInFolder(path).catch((err: unknown) => {
      console.error('Failed to show a file in the file manager', err);
    });
  }, []);

  const openFolder = useCallback(async (path: string | undefined, close: boolean) => {
    if (path == null) return;
    try {
      const opened = await window.electron.patchOpenWorkPath(path);
      // The stage-folder buttons keep the dialog (the user opens several); a folder row closes it,
      // like the work-folder list always did.
      if (opened && close) onHide();
    } catch (err) {
      console.error('Failed to open a work folder', err);
    }
  }, [onHide]);

  /** Open the detached-source check for this root (it is one reused window, so the dialog stays). */
  const openDetachableCheck = useCallback((workRoot: string | undefined) => {
    if (workRoot == null || workRoot.trim() === '') return;
    window.electron.patchOpenDetachableWindow({ workRoot }).catch((err: unknown) => {
      console.error('Failed to open the deletion check', err);
    });
  }, []);

  const activate = useCallback((row: WorkFolderRow | undefined, index: number) => {
    if (row == null || !row.enabled) return;
    switch (row.kind) {
      case 'root': {
        toggle(row.root);
        break;
      }
      case 'group': {
        toggleGroup(row, index);
        break;
      }
      case 'folder': {
        openFolder(row.path, true);
        break;
      }
      default: {
        reveal(row.path);
      }
    }
  }, [openFolder, reveal, toggle, toggleGroup]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // The settings dialog is on top; its controls own the keys.
      if (keysSuspended) return;
      // The filter input is auto-focused. Its own keys (Enter, Home/End, arrows) must not move the
      // selection or open a row. Buttons and the help summary keep their native keys too.
      if (isInteractiveTarget(event.target)) return;
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
          activate(rows[safeSelected], safeSelected);
          break;
        }
        case 'ArrowRight': {
          const row = rows[safeSelected];
          if (row?.kind === 'root' && row.expanded !== true) {
            event.preventDefault();
            toggle(row.root);
          } else if (row?.kind === 'group' && row.expanded !== true) {
            event.preventDefault();
            toggleGroup(row, safeSelected);
          }
          break;
        }
        case 'ArrowLeft': {
          const row = rows[safeSelected];
          if (row?.kind === 'root' && row.expanded === true) {
            event.preventDefault();
            toggle(row.root);
          } else if (row?.kind === 'group' && row.expanded === true) {
            event.preventDefault();
            toggleGroup(row, safeSelected);
          }
          break;
        }
        default: {
          break;
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activate, keysSuspended, rows, safeSelected, selectable, toggle, toggleGroup]);

  const renderRow = (row: WorkFolderRow, index: number) => {
    if (row.kind === 'root') {
      const { stats } = row.overview ?? {};
      return (
        <div
          key={row.key}
          role="button"
          tabIndex={-1}
          onMouseEnter={() => setSelected(index)}
          onClick={() => { toggle(row.root); }}
          style={{
            display: 'flex',
            gap: '.5em',
            alignItems: 'baseline',
            flexWrap: 'wrap',
            padding: '.32em .45em',
            borderRadius: '.25em',
            cursor: 'pointer',
            background: index === safeSelected ? 'var(--gray-4)' : undefined,
            ...(index > 0 && { borderTop: '2px solid var(--gray-6)', marginTop: '.6em' }),
          }}
        >
          <span style={{ width: '1em', color: 'var(--gray-11)' }}>{row.expanded === true ? '▾' : '▸'}</span>
          <span style={{ wordBreak: 'break-all', fontWeight: 600 }}>{row.root}</span>
          {row.current === true && <span style={chipStyle}>{t('Current')}</span>}
          {row.rootExists === false && <span style={{ ...chipStyle, color: 'var(--gray-11)' }}>{t('missing')}</span>}
          {row.lastUsed != null && row.lastUsed > 0 && (
            <span style={{ ...chipStyle, color: 'var(--gray-11)' }}>{t('Last used {{date}}', { date: new Date(row.lastUsed).toLocaleString() })}</span>
          )}
          {stats != null && (
            <>
              <span style={chipStyle}>{t('{{count}} sources', { count: stats.sources })}</span>
              <span style={chipStyle}>{t('{{count}} cut results', { count: stats.clips })}</span>
              <span style={chipStyle}>{t('{{count}} merged results', { count: stats.merged })}</span>
              <span style={chipStyle}>{t('{{count}} without results', { count: stats.isolated })}</span>
            </>
          )}
        </div>
      );
    }

    if (row.kind === 'folder') {
      return (
        <div
          key={row.key}
          role="button"
          tabIndex={-1}
          onMouseEnter={() => { if (row.enabled) setSelected(index); }}
          onClick={() => { if (row.enabled) openFolder(row.path, true); }}
          style={{ ...rowStyle(index === safeSelected, true), opacity: row.enabled ? 1 : 0.5, cursor: row.enabled ? 'pointer' : 'default' }}
        >
          <span style={{ width: '9em', color: 'var(--gray-11)', fontSize: '.85em' }}>{t(row.folder === 'source' ? 'Source folder' : 'Work area')}</span>
          <span style={{ wordBreak: 'break-all' }}>{row.path}</span>
          {!row.enabled && <span style={{ color: 'var(--gray-11)', fontSize: '.85em' }}>{t('missing')}</span>}
        </div>
      );
    }

    if (row.kind === 'message') {
      const { message } = row;
      const text = messageTextKey(message);
      const isProblem = message === 'error' || message === 'unreadable';
      return (
        <div key={row.key} style={{ marginLeft: '1.4em', padding: '.3em .45em', color: isProblem ? 'var(--orange-9)' : 'var(--gray-11)', fontSize: '.88em' }}>
          {t(text)}
        </div>
      );
    }

    if (row.kind === 'group') {
      return (
        <div
          key={row.key}
          role="button"
          tabIndex={-1}
          onMouseEnter={() => setSelected(index)}
          onClick={() => toggleGroup(row, index)}
          style={{
            display: 'flex',
            gap: '.5em',
            alignItems: 'baseline',
            marginLeft: '1.4em',
            marginTop: '.7em',
            padding: '0 .45em .2em',
            borderRadius: '.25em',
            borderBottom: '1px solid var(--gray-6)',
            fontWeight: 600,
            cursor: 'pointer',
            background: index === safeSelected ? 'var(--gray-4)' : undefined,
          }}
        >
          <span style={{ width: '1em', color: 'var(--gray-11)', fontWeight: 400 }}>{row.expanded === false ? '▸' : '▾'}</span>
          <span>{t(groupTitleKey(row.group ?? 'isolated'), { count: row.count ?? 0 })}</span>
        </div>
      );
    }

    if (row.kind === 'footer') {
      const { overview } = row;
      if (overview == null) return null;
      const { stats, openTargets, dirs } = overview;
      return (
        <div key={row.key} style={{ marginLeft: '1.4em', padding: '.35em 0 .6em' }}>
          {/* These entry points sit right under the root title, before the folder rows and the
              results, and before the statistics so they read as actions, not as counts. Two columns
              keep the pair a user reaches for next to each other: the check above the detached
              sources, each finished folder next to its counterpart. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '.5em', marginTop: '.35em', maxWidth: '46em' }}>
            <DialogButton
              disabled={row.overview?.workRoot == null || !openTargets.detachedSources}
              onClick={() => { openDetachableCheck(row.overview?.workRoot); }}
              title={t('Check which sources of this work folder may be deleted, and delete them for good.')}
            >
              {t('Check deletable source videos')}
            </DialogButton>
            <DialogButton disabled={!openTargets.detachedSources} onClick={() => { openFolder(dirs.detachedSrcMediaDir, false); }}>
              {t('Open detached sources')}
            </DialogButton>
            <DialogButton disabled={!openTargets.finishedSources} onClick={() => { openFolder(dirs.finishedSrcMediaDir, false); }}>
              {t('Open finished sources')}
            </DialogButton>
            <DialogButton disabled={!openTargets.finishedSkipSources} onClick={() => { openFolder(dirs.finishedSkipSrcMediaDir, false); }}>
              {t('Open finished skip sources')}
            </DialogButton>
            <DialogButton disabled={!openTargets.finishedClips} onClick={() => { openFolder(dirs.finishedClipsDir, false); }}>
              {t('Open finished cut results')}
            </DialogButton>
            <DialogButton disabled={!openTargets.finishedMerged} onClick={() => { openFolder(dirs.finishedMergedDir, false); }}>
              {t('Open finished merged results')}
            </DialogButton>
          </div>
          <div style={{ marginTop: '.45em', fontSize: '.82em', color: 'var(--gray-11)' }}>
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
      );
    }

    // source / result / unowned. The name and its status chips are one line and the size and the
    // duration are the subtitle, so a long name and a row with many chips never squeeze the numbers.
    const detail = row.path != null && row.enabled ? fileDetailText(details.get(row.path)) : undefined;
    return (
      <div
        key={row.key}
        role="button"
        tabIndex={-1}
        onMouseEnter={() => { if (row.enabled) setSelected(index); }}
        onClick={() => { if (row.enabled) reveal(row.path); }}
        style={{ ...rowStyle(index === safeSelected, true), flexDirection: 'column', alignItems: 'stretch', gap: '.12em', opacity: row.enabled ? 1 : 0.5, cursor: row.enabled ? 'pointer' : 'default' }}
      >
        <div style={{ display: 'flex', gap: '.5em', alignItems: 'baseline', flexWrap: 'wrap', minWidth: 0 }}>
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
              {row.source.pairing === 'name' && <span style={{ ...chipStyle, color: 'var(--gray-11)' }}>{t('Matched by file name')}</span>}
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

        {/* The subtitle stays on a row of its own, and the quiet ellipsis keeps its height while the
            background read answers - the same rule the source list's detail line follows. */}
        {row.enabled && (
          <div style={{ fontSize: '.78em', lineHeight: 1.5, color: 'var(--gray-11)' }}>
            {detail == null ? <span style={{ opacity: 0.4 }}>…</span> : detail}
          </div>
        )}
      </div>
    );
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onHide()}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ width: '66em', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }} aria-describedby={undefined}>
          <Dialog.Title>{t('Work folders and results')}</Dialog.Title>
          {/* The lock button and the settings entry point live at the top right, where the user
              looks after opening the dialog. The lock icon swaps with the state; the gear opens
              the working-directory settings, which hosts the lock settings and the password. */}
          <div style={{ position: 'absolute', top: '.45em', right: '3.2em', display: 'flex', gap: '.1em' }}>
            {privacyLock?.status.enabled === true && (
              <button
                type="button"
                title={t(historyLocked ? 'Unlock the work history' : 'Lock the work history')}
                aria-label={t(historyLocked ? 'Unlock the work history' : 'Lock the work history')}
                onClick={() => { if (historyLocked) setUnlockVisible((visible) => !visible); else privacyLock?.lock().catch(() => undefined); }}
                style={iconButtonStyle}
              >
                {historyLocked ? <FaLock /> : <FaLockOpen />}
              </button>
            )}
            <button type="button" title={t('Privacy lock settings')} aria-label={t('Privacy lock settings')} onClick={onOpenSettings} style={iconButtonStyle}>
              <FaCog />
            </button>
          </div>
          <Dialog.Description>
            {t('Folders where the app has created a {{name}} area. Expand one to see what each source became; only the folders you expand are read.', { name: workDirName })}
          </Dialog.Description>

          {historyLocked && unlockVisible && <PatchPrivacyLockUnlockForm onCancel={() => setUnlockVisible(false)} />}

          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus -- the filter is the point of the dialog
            autoFocus
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              // A fold would hide the rows the needle just found, so typing starts from every group
              // open. Clearing the set also keeps Left/Right from toggling an invisible fold.
              setCollapsedGroups(new Set());
              setSelected(0);
            }}
            onKeyDown={(event) => {
              // patch: the filter is auto-focused, and the dialog's own key handler ignores editable
              // targets, so Enter and the arrows would do nothing here. Handle them at the input.
              if (event.key === 'Enter') {
                event.preventDefault();
                activate(rows[safeSelected], safeSelected);
                return;
              }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setSelected(moveOverviewSelection(selectable, safeSelected, event.key === 'ArrowDown' ? 1 : -1));
              }
            }}
            placeholder={t('Filter by path or name')}
            style={{ marginTop: '.6em', padding: '.35em .5em', width: '100%', boxSizing: 'border-box' }}
          />

          <div style={{ marginTop: '.5em', overflowY: 'auto', flexGrow: 1, minHeight: '10em' }}>
            {historyLocked && (
              <button
                type="button"
                onClick={() => setUnlockVisible(true)}
                style={{ display: 'flex', gap: '.5em', alignItems: 'center', width: '100%', textAlign: 'left', marginBottom: '.4em', padding: '.45em .55em', border: '1px dashed var(--gray-7)', borderRadius: '.3em', background: 'transparent', color: 'var(--gray-11)', cursor: 'pointer' }}
              >
                <FaLock />
                <span>{t('Work folder and result history is locked. Click to unlock.')}</span>
              </button>
            )}
            {loading && <div style={{ color: 'var(--gray-11)' }}>{t('Reading...')}</div>}
            {!loading && rows.length === 0 && !historyLocked && <div style={{ color: 'var(--gray-11)' }}>{t('No work folders yet.')}</div>}
            {rows.map((row, index) => renderRow(row, index))}
          </div>

          {detailProgress != null && (
            <div style={{ marginTop: '.5em', fontSize: '.82em', color: 'var(--gray-11)' }}>
              {t('Reading file details ({{done}} of {{total}})', { done: detailProgress.done, total: detailProgress.total })}
            </div>
          )}

          {/* The short line is the folded summary; the detailed guide under it is the same help
              users paste into a chat when they ask what the list does. */}
          <details style={{ marginTop: '.5em', fontSize: '.85em', color: 'var(--gray-11)' }}>
            <summary style={{ cursor: 'pointer' }}>
              {t('Up/Down select. Enter expands a folder or a group, or shows a file. Left/Right fold, Esc closes.')}
            </summary>
            <div style={{ marginTop: '.4em', lineHeight: 1.6, display: 'grid', gap: '.35em' }}>
              <div>
                <b>{t('Reading the list')}</b>{' '}
                {t('Only a work folder you expand is read. The folder of the current video opens by itself, and a folder that was read once stays in memory for this dialog.')}
              </div>
              <div>
                <b>{t('What a work folder shows')}</b>{' '}
                {t('Its last use, whether the folders still exist, how many sources and results it holds, the two folder rows, the stage-folder buttons, and the lines that count complete, partial, parked, missing, source-gone and unclaimed results.')}
              </div>
              <div>
                <b>{t('Groups and rows')}</b>{' '}
                {t('A source row says where its video is now (waiting for deletion, finished, skipped, or gone) and how many cut and merged results it has. A result row says which folder the file is in, or that the file is missing. The size and the duration under a name are read in the background, one file at a time.')}
              </div>
              <div>
                <b>{t('Keys')}</b>{' '}
                {t('Up/Down selects, PageUp/PageDown move ten rows, Home/End go to the first or last row. Enter on a work folder opens or folds it, on a group folds it, on a file shows it in the file manager. Left/Right fold a work folder or a group. Esc closes the dialog.')}
              </div>
              <div>
                <b>{t('The filter')}</b>{' '}
                {t('It has the focus when the dialog opens. A folder path keeps only the matching work folders; a file name keeps the matching files and opens the groups that contain them. Clearing it shows everything again.')}
              </div>
              <div>
                <b>{t('The privacy lock')}</b>{' '}
                {t('When the history is locked, only the work folder of the open video is shown; the other folders are replaced by one locked line. The lock button at the top right unlocks it with the password, and the gear opens the lock settings. The lock only hides the list: the videos and the history file are not encrypted.')}
              </div>
            </div>
          </details>

          <Dialog.CloseButton />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
