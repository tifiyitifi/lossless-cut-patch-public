// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, test } from 'vitest';

import type { PatchWorkRootPathInfo } from '../patchFinish/workRoots.js';

import type { PatchOverview, PatchOverviewSource } from './groupResults.js';
import { buildWorkFolderRows, initialExpandedRoot } from './workFolders.js';
import type { WorkFolderRootState } from './workFolders.js';

function root(path: string, overrides: Partial<PatchWorkRootPathInfo> = {}): PatchWorkRootPathInfo {
  return { root: path, lastUsed: 0, workDir: `${path}\\.losslesscut_work`, rootExists: true, workDirExists: true, ...overrides };
}

function source(path: string, overrides: Partial<PatchOverviewSource> = {}): PatchOverviewSource {
  return {
    path,
    folder: 'finishedSrc',
    clips: [],
    merged: [],
    parkedClips: [],
    parkedMerged: [],
    missing: [],
    pairing: 'none',
    ...overrides,
  };
}

const dirs = {
  detachedSrcMediaDir: undefined,
  finishedSrcMediaDir: undefined,
  finishedSkipSrcMediaDir: undefined,
  finishedClipsDir: undefined,
  finishedMergedDir: undefined,
  detachedClipsDir: undefined,
  detachedMergedDir: undefined,
};

function overview(sources: PatchOverviewSource[], overrides: Partial<PatchOverview> = {}): PatchOverview {
  return {
    workRoot: String.raw`C:\work`,
    dirs,
    sources,
    unowned: [],
    stats: { sources: sources.length, clips: 0, merged: 0, isolated: 0, clipsOnly: 0, mergedOnly: 0, parkedOnly: 0, complete: 0, sourceGone: 0, unowned: 0, missing: 0 },
    openTargets: { detachedSources: false, finishedSources: false, finishedSkipSources: false, finishedClips: false, finishedMerged: false },
    warnings: [],
    ...overrides,
  };
}

function rowsOf({ roots = [root(String.raw`C:\work`)], expanded = [], collapsedGroups = [], states = new Map<string, WorkFolderRootState>(), filter = '', currentRoot, caseInsensitive }: {
  roots?: PatchWorkRootPathInfo[];
  expanded?: string[];
  collapsedGroups?: string[];
  states?: Map<string, WorkFolderRootState>;
  filter?: string;
  currentRoot?: string | undefined;
  caseInsensitive?: boolean | undefined;
}) {
  return buildWorkFolderRows({ roots, currentRoot, expanded: new Set(expanded), collapsedGroups: new Set(collapsedGroups), states, filter, caseInsensitive });
}

function kinds(rows: ReturnType<typeof rowsOf>) {
  return rows.map((row) => row.kind);
}

/** The roots the list shows (one row per visible root), in display order. */
function visibleRoots(rows: ReturnType<typeof rowsOf>) {
  return rows.flatMap((row) => (row.kind === 'root' ? [row.root] : []));
}

describe('buildWorkFolderRows', () => {
  test('a collapsed root is a single row', () => {
    const rows = rowsOf({ roots: [root(String.raw`C:\a`), root(String.raw`C:\b`)] });
    expect(kinds(rows)).toStrictEqual(['root', 'root']);
    expect(rows.map((row) => row.path)).toStrictEqual([String.raw`C:\a`, String.raw`C:\b`]);
    expect(rows.every((row) => row.expanded === false)).toBe(true);
  });

  test('an expanded root adds its controls, the two folder rows, the groups and the results', () => {
    const states = new Map([[String.raw`C:\work`, { overview: overview([source(String.raw`C:\work\a.mp4`, { clips: [{ path: String.raw`C:\work\a-1.mp4`, folder: 'finishedClips' }] })]) }]]);
    const rows = rowsOf({ expanded: [String.raw`C:\work`], states });

    expect(kinds(rows)).toStrictEqual(['root', 'footer', 'folder', 'folder', 'group', 'source', 'result']);
    expect(rows[1]).toMatchObject({ overview: states.get(String.raw`C:\work`)!.overview });
    expect(rows[2]).toMatchObject({ folder: 'source', path: String.raw`C:\work`, enabled: true });
    expect(rows[3]).toMatchObject({ folder: 'work', path: String.raw`C:\work\.losslesscut_work`, enabled: true });
    expect(rows[4]).toMatchObject({ group: 'partial', count: 1 });
    expect(rows[5]).toMatchObject({ path: String.raw`C:\work\a.mp4`, enabled: true });
    expect(rows[6]).toMatchObject({ path: String.raw`C:\work\a-1.mp4`, resultFolder: 'finishedClips', enabled: true });
  });

  test('a root shows its controls before its folders and its groups', () => {
    const states = new Map([[String.raw`C:\work`, { overview: overview([source(String.raw`C:\work\a.mp4`, { clips: [{ path: String.raw`C:\work\a-1.mp4`, folder: 'finishedClips' }] })]) }]]);
    const rows = rowsOf({ expanded: [String.raw`C:\work`], states });
    // The controls must be reachable without scrolling past the results, so they come right after
    // the root title - not at the end of the section.
    expect(kinds(rows).slice(0, 4)).toStrictEqual(['root', 'footer', 'folder', 'folder']);
    expect(rows[1]?.kind).toBe('footer');
  });

  test('folder rows are disabled when the folder is gone', () => {
    const rows = rowsOf({
      roots: [root(String.raw`C:\work`, { rootExists: false, workDirExists: false })],
      expanded: [String.raw`C:\work`],
      states: new Map([[String.raw`C:\work`, { overview: overview([]) }]]),
    });
    expect(rows[0]).toMatchObject({ kind: 'root', rootExists: false, workDirExists: false, enabled: true });
    expect(rows[2]).toMatchObject({ kind: 'folder', folder: 'source', enabled: false });
    expect(rows[3]).toMatchObject({ kind: 'folder', folder: 'work', enabled: false });
  });

  test('the current root is marked', () => {
    const rows = rowsOf({ roots: [root(String.raw`C:\a`), root(String.raw`C:\b`)], currentRoot: String.raw`c:\A`, caseInsensitive: true });
    expect(rows.map((row) => row.current)).toStrictEqual([true, false]);
  });

  test('a root still being read shows one message row', () => {
    expect(kinds(rowsOf({ expanded: [String.raw`C:\work`] }))).toStrictEqual(['root', 'folder', 'folder', 'message']);
    expect(rowsOf({ expanded: [String.raw`C:\work`] })[3]).toMatchObject({ message: 'reading', enabled: false });

    const loading = rowsOf({ expanded: [String.raw`C:\work`], states: new Map([[String.raw`C:\work`, { loading: true }]]) });
    expect(loading[3]).toMatchObject({ message: 'reading' });
  });

  test('an unreadable root shows its error', () => {
    const rows = rowsOf({ expanded: [String.raw`C:\work`], states: new Map([[String.raw`C:\work`, { error: true }]]) });
    expect(rows[3]).toMatchObject({ message: 'error' });
  });

  test('an empty root says so and keeps its folder buttons', () => {
    const rows = rowsOf({ expanded: [String.raw`C:\work`], states: new Map([[String.raw`C:\work`, { overview: overview([]) }]]) });
    expect(kinds(rows)).toStrictEqual(['root', 'footer', 'folder', 'folder', 'message']);
    expect(rows[4]).toMatchObject({ message: 'empty' });
  });

  test('an unreadable stage folder is reported above the results', () => {
    const rows = rowsOf({
      expanded: [String.raw`C:\work`],
      states: new Map([[String.raw`C:\work`, { overview: overview([source(String.raw`C:\work\a.mp4`)], { warnings: ['dir-unreadable'] }) }]]),
    });
    expect(rows[4]).toMatchObject({ message: 'unreadable' });
    expect(rows[5]).toMatchObject({ kind: 'group' });
  });

  test('a missing result row cannot be selected', () => {
    const states = new Map([[String.raw`C:\work`, { overview: overview([source(String.raw`C:\work\a.mp4`, { missing: [String.raw`C:\work\a-1.mp4`] })]) }]]);
    const rows = rowsOf({ expanded: [String.raw`C:\work`], states });
    const missing = rows.find((row) => row.missing === true);
    expect(missing).toMatchObject({ kind: 'result', path: String.raw`C:\work\a-1.mp4`, enabled: false });
  });

  test('a source whose file is gone cannot be selected', () => {
    const states = new Map([[String.raw`C:\work`, { overview: overview([source(String.raw`C:\work\a.mp4`, { folder: 'missing' })]) }]]);
    const rows = rowsOf({ expanded: [String.raw`C:\work`], states });
    expect(rows.find((row) => row.kind === 'source')).toMatchObject({ enabled: false });
  });

  test('keeps a skipped source apart from a finished one', () => {
    const states = new Map([[String.raw`C:\work`, { overview: overview([
      source(String.raw`C:\work\a.mp4`, { folder: 'finishedSkip' }),
      source(String.raw`C:\work\b.mp4`, { folder: 'finishedSrc' }),
    ]) }]]);
    const rows = rowsOf({ expanded: [String.raw`C:\work`], states });
    expect(rows.filter((row) => row.kind === 'source').map((row) => row.source?.folder)).toStrictEqual(['finishedSkip', 'finishedSrc']);
  });

  test('group titles are selectable, the footer is not', () => {
    const states = new Map([[String.raw`C:\work`, { overview: overview([source(String.raw`C:\work\a.mp4`)]) }]]);
    const rows = rowsOf({ expanded: [String.raw`C:\work`], states });
    expect(rows.filter((row) => row.kind === 'group').every((row) => row.enabled)).toBe(true);
    expect(rows.filter((row) => row.kind === 'footer').every((row) => !row.enabled)).toBe(true);
    expect(rows.find((row) => row.kind === 'root')?.enabled).toBe(true);
  });

  describe('groups', () => {
    /** Two groups with a source each, plus one result without a source (the unowned bucket). */
    const states = new Map([[String.raw`C:\work`, { overview: overview(
      [
        source(String.raw`C:\work\a.mp4`, { clips: [{ path: String.raw`C:\work\a-1.mp4`, folder: 'finishedClips' }] }),
        source(String.raw`C:\work\b.mp4`),
      ],
      { unowned: [{ path: String.raw`C:\work\finished_clips\zzz.mp4`, folder: 'finishedClips' }] },
    ) }]]);

    test('groups start expanded', () => {
      const rows = rowsOf({ expanded: [String.raw`C:\work`], states });
      expect(kinds(rows)).toStrictEqual(['root', 'footer', 'folder', 'folder', 'group', 'source', 'group', 'source', 'result', 'group', 'unowned']);
      expect(rows.filter((row) => row.kind === 'group').every((row) => row.expanded)).toBe(true);
    });

    test('a folded group keeps its title and count and hides its rows', () => {
      const rows = rowsOf({ expanded: [String.raw`C:\work`], collapsedGroups: [String.raw`C:\work|partial`], states });
      expect(kinds(rows)).toStrictEqual(['root', 'footer', 'folder', 'folder', 'group', 'source', 'group', 'group', 'unowned']);
      expect(rows.find((row) => row.group === 'partial')).toMatchObject({ enabled: true, expanded: false, count: 1 });
      expect(rows.filter((row) => row.kind === 'source').map((row) => row.path)).toStrictEqual([String.raw`C:\work\b.mp4`]);
      expect(rows.filter((row) => row.kind === 'result')).toHaveLength(0);
    });

    test('each group of each work root folds on its own', () => {
      const rows = rowsOf({
        roots: [root(String.raw`C:\work`), root(String.raw`D:\other`)],
        expanded: [String.raw`C:\work`, String.raw`D:\other`],
        collapsedGroups: [String.raw`C:\work|partial`],
        states: new Map([
          [String.raw`C:\work`, { overview: overview([source(String.raw`C:\work\a.mp4`, { clips: [{ path: String.raw`C:\work\a-1.mp4`, folder: 'finishedClips' }] })]) }],
          [String.raw`D:\other`, { overview: overview([source(String.raw`D:\other\b.mp4`, { clips: [{ path: String.raw`D:\other\b-1.mp4`, folder: 'finishedClips' }] })]) }],
        ]),
      });
      const partial = rows.filter((row) => row.group === 'partial');
      expect(partial.map((row) => [row.root, row.expanded])).toStrictEqual([
        [String.raw`C:\work`, false],
        [String.raw`D:\other`, true],
      ]);
      expect(rows.filter((row) => row.kind === 'result')).toHaveLength(1);
    });

    test('a filter shows the rows of a folded group', () => {
      // Hiding what the needle just found would look broken, so an active filter wins over a fold.
      const rows = rowsOf({ expanded: [String.raw`C:\work`], collapsedGroups: [String.raw`C:\work|partial`], states, filter: 'a-1' });
      expect(kinds(rows)).toStrictEqual(['root', 'footer', 'folder', 'folder', 'group', 'source', 'result']);
      expect(rows.find((row) => row.kind === 'group')).toMatchObject({ group: 'partial', expanded: true });
    });
  });

  describe('filter', () => {
    const states = new Map([
      [String.raw`C:\work`, { overview: overview([source(String.raw`C:\work\alpha.mp4`, { clips: [{ path: String.raw`C:\work\alpha-1.mp4`, folder: 'finishedClips' }] }), source(String.raw`C:\work\beta.mp4`)]) }],
      [String.raw`D:\other`, { overview: overview([source(String.raw`D:\other\gamma.mp4`)]) }],
    ]);

    test('an empty filter keeps every root', () => {
      const rows = rowsOf({ roots: [root(String.raw`C:\work`), root(String.raw`D:\other`)], states });
      expect(visibleRoots(rows)).toStrictEqual([String.raw`C:\work`, String.raw`D:\other`]);
    });

    test('a file name keeps the root and only the matching rows', () => {
      const all = rowsOf({ roots: [root(String.raw`C:\work`), root(String.raw`D:\other`)], expanded: [String.raw`C:\work`], states, filter: 'alpha' });
      expect(visibleRoots(all)).toStrictEqual([String.raw`C:\work`]);
      const sourceRows = all.filter((row) => row.kind === 'source');
      expect(sourceRows.map((row) => row.path)).toStrictEqual([String.raw`C:\work\alpha.mp4`]);
      expect(all.filter((row) => row.kind === 'result').map((row) => row.path)).toStrictEqual([String.raw`C:\work\alpha-1.mp4`]);
      expect(all.find((row) => row.kind === 'group')).toMatchObject({ count: 1 });
    });

    test('a path keeps all of that root and hides the others', () => {
      const rows = rowsOf({ roots: [root(String.raw`C:\work`), root(String.raw`D:\other`)], expanded: [String.raw`C:\work`], states, filter: String.raw`d:\other` });
      expect(visibleRoots(rows)).toStrictEqual([String.raw`D:\other`]);

      const byRootPath = rowsOf({ roots: [root(String.raw`C:\work`), root(String.raw`D:\other`)], expanded: [String.raw`C:\work`], states, filter: String.raw`c:\work` });
      expect(visibleRoots(byRootPath)).toStrictEqual([String.raw`C:\work`]);
      // Groups come first (sources without results are listed before the partial ones), so the
      // path match shows every row of the root, not just the ones whose name contains it.
      expect(byRootPath.filter((row) => row.kind === 'source').map((row) => row.path)).toStrictEqual([String.raw`C:\work\beta.mp4`, String.raw`C:\work\alpha.mp4`]);
    });

    test('a collapsed root stays visible while its loaded results match', () => {
      // Only expanded roots are read, so a root that was never opened can only match by its path.
      const rows = rowsOf({ roots: [root(String.raw`C:\work`), root(String.raw`D:\other`)], states, filter: 'alpha' });
      expect(visibleRoots(rows)).toStrictEqual([String.raw`C:\work`]);
    });

    test('shows the matches of a collapsed root that was already read', () => {
      // The results are there, so the root opens itself instead of hiding what the needle found.
      const rows = rowsOf({ roots: [root(String.raw`C:\work`)], states, filter: 'alpha' });
      expect(rows.find((row) => row.kind === 'root')).toMatchObject({ expanded: true });
      expect(rows.filter((row) => row.kind === 'source').map((row) => row.path)).toStrictEqual([String.raw`C:\work\alpha.mp4`]);
    });

    test('keeps a collapsed root single-row while its results are unread', () => {
      // Only expanded roots are read, so opening this one here would leave a "Reading..." row that
      // nothing ever fills and would start a scan for every keystroke.
      const rows = rowsOf({ roots: [root(String.raw`C:\work`)], filter: 'alpha' });
      expect(kinds(rows)).toStrictEqual(['root']);
      expect(rows[0]).toMatchObject({ expanded: false });
    });

    test('a root that is still being read stays visible while filtering', () => {
      const rows = rowsOf({ roots: [root(String.raw`D:\other`)], expanded: [String.raw`D:\other`], states: new Map([[String.raw`D:\other`, { loading: true }]]), filter: 'alpha' });
      expect(rows.map((row) => row.kind)).toStrictEqual(['root', 'folder', 'folder', 'message']);
    });
  });
});

describe('initialExpandedRoot', () => {
  const roots = [root(String.raw`C:\recent`), root(String.raw`C:\older`)];

  test('expands the current session root, wherever it is in the list', () => {
    expect(initialExpandedRoot(roots, String.raw`C:\older`)).toBe(String.raw`C:\older`);
  });

  test('falls back to the most recent root', () => {
    expect(initialExpandedRoot(roots, undefined)).toBe(String.raw`C:\recent`);
    expect(initialExpandedRoot(roots, String.raw`D:\elsewhere`)).toBe(String.raw`C:\recent`);
  });

  test('matches the current root the way the file system does', () => {
    expect(initialExpandedRoot(roots, String.raw`c:\OLDER`, { caseInsensitive: true })).toBe(String.raw`C:\older`);
    expect(initialExpandedRoot(roots, String.raw`c:\OLDER`)).toBe(String.raw`C:\recent`);
  });

  test('has nothing to expand without history', () => {
    expect(initialExpandedRoot([], String.raw`C:\work`)).toBeUndefined();
  });
});
