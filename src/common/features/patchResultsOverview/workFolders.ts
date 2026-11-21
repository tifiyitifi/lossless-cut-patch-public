import { getPathBaseName } from '../patchData/videoExtensions.js';
import { isSamePath } from '../patchFinish/paths.js';
import type { PatchWorkRootPathInfo } from '../patchFinish/workRoots.js';

import { buildOverviewGroups } from './groupResults.js';
import type {
  PatchOverview,
  PatchOverviewGroupId,
  PatchOverviewResultFolder,
  PatchOverviewResultRef,
  PatchOverviewSource,
  PatchOverviewUnowned,
} from './groupResults.js';

/**
The rows of the combined work-folders-and-results dialog (fork-owned, pure).

The dialog used to be two lists: the work folder history (`open-workpath-list`) and the results
overview of one work root. They are one list now: every root of the history is a foldable section,
the most recent one is expanded, and expanding a root reads its results (the scan itself is done
by the main process, only for the roots that are open).

This module turns (roots + expansion + the loaded overviews + the filter) into one flat list of
rows, so the renderer only maps rows to elements and the selection rules stay testable without a
DOM. A collapsed root contributes exactly one row; an expanded one adds its controls (folder buttons
and statistics), its two folders, its groups and its results. The controls come first so they stay
reachable without scrolling past a long result list. The groups of an expanded root fold on their
own, all of them open by default; a group folded by the user contributes only its title row.
*/

export type WorkFolderRowKind = 'root' | 'folder' | 'message' | 'group' | 'source' | 'result' | 'unowned' | 'footer';

/** The per-root states that show a line instead of results. */
export type WorkFolderMessage = 'reading' | 'error' | 'unreadable' | 'empty';

/** What the dialog has read for one root. */
export interface WorkFolderRootState {
  overview?: PatchOverview | undefined;
  loading?: boolean | undefined;
  error?: boolean | undefined;
}

export interface WorkFolderRow {
  kind: WorkFolderRowKind;
  /** Unique across the list. */
  key: string;
  /** The work root this row belongs to. */
  root: string;
  /** May the selection land on this row? */
  enabled: boolean;
  /** The folder a `folder` row opens, or the file a source/result row shows. */
  path?: string | undefined;
  /** `root` rows: is this the work root of the current session? */
  current?: boolean | undefined;
  /** `root` and `group` rows: is it expanded? */
  expanded?: boolean | undefined;
  /** `root` rows: unix milliseconds of the last use (`0` for the current session). */
  lastUsed?: number | undefined;
  /** `root` rows: do the folders still exist? */
  rootExists?: boolean | undefined;
  workDirExists?: boolean | undefined;
  /** `folder` rows: which of the two folders this row opens. */
  folder?: 'source' | 'work' | undefined;
  /** `message` rows: which line to show. */
  message?: WorkFolderMessage | undefined;
  /** `group` rows: the bucket and how many entries it has. */
  group?: PatchOverviewGroupId | undefined;
  count?: number | undefined;
  source?: PatchOverviewSource | undefined;
  resultFolder?: PatchOverviewResultFolder | undefined;
  unowned?: PatchOverviewUnowned | undefined;
  /** `result` rows: the ledger knows it, the disk does not. */
  missing?: boolean | undefined;
  /** `root` and `footer` rows: everything that was read for the root. */
  overview?: PatchOverview | undefined;
}

export interface BuildWorkFolderRowsInput {
  /** The history, newest first (the main process already ordered and stat'ed it). */
  roots: readonly PatchWorkRootPathInfo[];
  /** The work root of the current session; it is marked and is the one that starts expanded. */
  currentRoot?: string | undefined;
  expanded: ReadonlySet<string>;
  /** Group row keys (`<root>|<group>`) the user folded; empty or absent means every group is open. */
  collapsedGroups?: ReadonlySet<string> | undefined;
  /** What has been read per root; roots without a state are still loading. */
  states: ReadonlyMap<string, WorkFolderRootState>;
  /**
  A file name or folder path to keep. A name filter also opens the roots that were already read
  (their matches would otherwise be hidden); a root that was never read stays a single row.
  */
  filter: string;
  /** Does the file system ignore path case (Windows)? */
  caseInsensitive?: boolean | undefined;
}

interface VisibleSource {
  source: PatchOverviewSource;
  clips: PatchOverviewResultRef[];
  merged: PatchOverviewResultRef[];
  parkedClips: PatchOverviewResultRef[];
  parkedMerged: PatchOverviewResultRef[];
  missing: string[];
}

interface VisibleGroup {
  id: PatchOverviewGroupId;
  sources: VisibleSource[];
  unowned: PatchOverviewUnowned[];
}

/** Does a file name contain the needle? An empty needle matches everything. */
function nameMatches(path: string, needle: string) {
  return needle === '' || getPathBaseName(path).toLowerCase().includes(needle);
}

/**
The groups of one root, filtered.

`all` shows every row of the root: it is set when the needle matched the root path, so typing a
folder path narrows the list to that root instead of hiding its files.
*/
function visibleGroups(overview: PatchOverview, needle: string, all: boolean): VisibleGroup[] {
  const rowVisible = (path: string) => all || nameMatches(path, needle);
  const groups: VisibleGroup[] = [];

  for (const group of buildOverviewGroups(overview)) {
    const sources: VisibleSource[] = [];
    for (const source of group.sources) {
      const sourceVisible = rowVisible(source.path);
      const clips = source.clips.filter((entry) => rowVisible(entry.path));
      const merged = source.merged.filter((entry) => rowVisible(entry.path));
      const parkedClips = source.parkedClips.filter((entry) => rowVisible(entry.path));
      const parkedMerged = source.parkedMerged.filter((entry) => rowVisible(entry.path));
      const missing = source.missing.filter(rowVisible);
      const resultCount = clips.length + merged.length + parkedClips.length + parkedMerged.length + missing.length;
      if (!sourceVisible && resultCount === 0) continue;
      sources.push({ source, clips, merged, parkedClips, parkedMerged, missing });
    }

    const unowned = group.unowned.filter((entry) => rowVisible(entry.path));
    if (sources.length === 0 && unowned.length === 0) continue;
    groups.push({ id: group.id, sources, unowned });
  }

  return groups;
}

function rootPathMatches(root: PatchWorkRootPathInfo, needle: string) {
  return needle === '' || root.root.toLowerCase().includes(needle) || root.workDir.toLowerCase().includes(needle);
}

/** The rows of the combined dialog, in display order. */
export function buildWorkFolderRows({
  roots,
  currentRoot,
  expanded,
  collapsedGroups = new Set<string>(),
  states,
  filter,
  caseInsensitive = false,
}: BuildWorkFolderRowsInput): WorkFolderRow[] {
  const needle = filter.trim().toLowerCase();
  const rows: WorkFolderRow[] = [];

  for (const root of roots) {
    const state = states.get(root.root);
    const overview = state?.overview;
    const matchesPath = rootPathMatches(root, needle);
    const groups = overview == null ? [] : visibleGroups(overview, needle, matchesPath);
    const pending = state == null || state.loading === true;

    // A root that does not match the filter is only kept while it is being read: the section the
    // user just opened must not vanish under the needle.
    if (!matchesPath && groups.length === 0 && !pending && state?.error !== true) continue;

    const isExpanded = expanded.has(root.root);
    // An active filter wins over the root fold, but only once the root has been read: the main
    // process scans only the roots the user expands, so opening an unread one here would show a
    // "Reading..." row nothing fills (and start a scan for every keystroke).
    const showContents = isExpanded || (needle !== '' && overview != null);
    rows.push({
      kind: 'root',
      key: `${root.root}|root`,
      root: root.root,
      enabled: true,
      path: root.root,
      lastUsed: root.lastUsed,
      rootExists: root.rootExists,
      workDirExists: root.workDirExists,
      expanded: showContents,
      current: currentRoot != null && isSamePath(root.root, currentRoot, { caseInsensitive }),
      overview,
    });

    if (!showContents) continue;

    // The root's buttons and statistics come before everything else of the section: they are the
    // entry points of the work folder (and were previously hidden below a long result list).
    if (overview != null) rows.push({ kind: 'footer', key: `${root.root}|footer`, root: root.root, enabled: false, overview });

    // The two folder rows of the old work-folder list: the source folder first, then its work area.
    rows.push(
      { kind: 'folder', key: `${root.root}|source`, root: root.root, enabled: root.rootExists, path: root.root, folder: 'source' },
      { kind: 'folder', key: `${root.root}|work`, root: root.root, enabled: root.workDirExists, path: root.workDir, folder: 'work' },
    );

    if (pending) {
      rows.push({ kind: 'message', key: `${root.root}|reading`, root: root.root, enabled: false, message: 'reading' });
      continue;
    }
    if (state?.error === true) {
      rows.push({ kind: 'message', key: `${root.root}|error`, root: root.root, enabled: false, message: 'error' });
      continue;
    }
    if (overview == null) {
      rows.push({ kind: 'message', key: `${root.root}|error`, root: root.root, enabled: false, message: 'error' });
      continue;
    }
    if (overview.warnings.includes('dir-unreadable')) {
      rows.push({ kind: 'message', key: `${root.root}|unreadable`, root: root.root, enabled: false, message: 'unreadable' });
    }
    if (groups.length === 0) {
      rows.push({ kind: 'message', key: `${root.root}|empty`, root: root.root, enabled: false, message: 'empty' });
      continue;
    }

    for (const group of groups) {
      const groupKey = `${root.root}|${group.id}`;
      // An active filter wins over a fold: hiding the rows the needle just found would look broken.
      const groupExpanded = needle !== '' || !collapsedGroups.has(groupKey);
      rows.push({
        kind: 'group',
        key: groupKey,
        root: root.root,
        enabled: true,
        group: group.id,
        count: group.sources.length + group.unowned.length,
        expanded: groupExpanded,
      });
      if (!groupExpanded) continue;

      for (const { source, clips, merged, parkedClips, parkedMerged, missing } of group.sources) {
        rows.push({
          kind: 'source',
          key: `${root.root}|${group.id}|source|${source.path}`,
          root: root.root,
          enabled: source.folder !== 'missing',
          path: source.path,
          source,
        });
        for (const entry of [...clips, ...merged, ...parkedClips, ...parkedMerged]) {
          rows.push({
            kind: 'result',
            key: `${root.root}|${group.id}|result|${entry.path}`,
            root: root.root,
            enabled: true,
            path: entry.path,
            source,
            resultFolder: entry.folder,
          });
        }
        for (const path of missing) {
          rows.push({
            kind: 'result',
            key: `${root.root}|${group.id}|missing|${path}`,
            root: root.root,
            enabled: false,
            path,
            source,
            missing: true,
          });
        }
      }

      for (const entry of group.unowned) {
        rows.push({
          kind: 'unowned',
          key: `${root.root}|${group.id}|unowned|${entry.path}`,
          root: root.root,
          enabled: true,
          path: entry.path,
          unowned: entry,
        });
      }
    }
  }

  return rows;
}

/**
The root that starts expanded: the current session's, else the most recent one.

`listPatchWorkRoots` already puts the current root first, but it is only a fallback there - the
history may hold it under another spelling, or the session may have no root at all.
*/
export function initialExpandedRoot(
  roots: readonly PatchWorkRootPathInfo[],
  currentRoot: string | undefined,
  { caseInsensitive = false }: { caseInsensitive?: boolean | undefined } = {},
): string | undefined {
  if (currentRoot != null) {
    const match = roots.find((root) => isSamePath(root.root, currentRoot, { caseInsensitive }));
    if (match != null) return match.root;
  }
  return roots[0]?.root;
}
