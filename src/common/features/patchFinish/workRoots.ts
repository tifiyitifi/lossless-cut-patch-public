/**
The `open-workpath-list` rows (pure types + selection logic).

One history entry becomes two rows: the root the user works in (the folder that holds the source
videos) and its work area (`.losslesscut_work`). The main process resolves and stats them; the
renderer shows the missing folders greyed out instead of opening nothing, and Enter only ever
lands on a folder that exists.
*/
export interface PatchWorkRootPathInfo {
  /** The directory that contains `.losslesscut_work` (the folder the user picks videos from). */
  root: string;
  lastUsed: number;
  workDir: string;
  rootExists: boolean;
  workDirExists: boolean;
}

export interface PatchWorkRootsListing {
  roots: PatchWorkRootPathInfo[];
}

export type PatchWorkRootRowKind = 'root' | 'work';

export interface PatchWorkRootRow {
  /** The root the two rows belong to. */
  root: string;
  kind: PatchWorkRootRowKind;
  /** The folder this row opens. */
  path: string;
  exists: boolean;
}

/** Two rows per root, source folder first: that is the folder the user wants to get back to. */
export function buildPatchWorkRootRows(roots: readonly PatchWorkRootPathInfo[]): PatchWorkRootRow[] {
  return roots.flatMap((entry): PatchWorkRootRow[] => [
    { root: entry.root, kind: 'root', path: entry.root, exists: entry.rootExists },
    { root: entry.root, kind: 'work', path: entry.workDir, exists: entry.workDirExists },
  ]);
}

/** Does a root match the filter? Both displayed paths count, not just the root. */
function matchesPatchWorkRoot(entry: PatchWorkRootPathInfo, needle: string) {
  if (needle === '') return true;
  return entry.root.toLowerCase().includes(needle) || entry.workDir.toLowerCase().includes(needle);
}

/** Filter the roots by path (empty = all of them). */
export function filterPatchWorkRoots(roots: readonly PatchWorkRootPathInfo[], query: string): PatchWorkRootPathInfo[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...roots];
  return roots.filter((entry) => matchesPatchWorkRoot(entry, needle));
}

/** The existing rows, in display order (the only rows the selection may land on). */
function selectableIndexes(rows: readonly PatchWorkRootRow[]) {
  return rows.flatMap((row, index) => (row.exists ? [index] : []));
}

/**
The row the selection should show: `index` itself when it exists, else the next existing row,
else the previous one, else `index` (nothing in the list exists).
*/
export function nearestPatchWorkRootRow(rows: readonly PatchWorkRootRow[], index: number): number {
  const selectable = selectableIndexes(rows);
  if (selectable.length === 0) return index;
  return selectable.find((candidate) => candidate >= index) ?? selectable.at(-1)!;
}

/**
Move the selection by `delta` selectable rows (missing rows are skipped over), clamped to the
list. A row that does not exist snaps to the nearest existing one first.
*/
export function movePatchWorkRootRow(rows: readonly PatchWorkRootRow[], index: number, delta: number): number {
  const selectable = selectableIndexes(rows);
  if (selectable.length === 0) return index;
  const anchor = selectable.findIndex((candidate) => candidate >= index);
  const from = anchor === -1 ? selectable.length - 1 : anchor;
  const target = Math.min(Math.max(0, from + delta), selectable.length - 1);
  return selectable[target]!;
}

/** The first / last selectable row, for Home / End. */
export function firstPatchWorkRootRow(rows: readonly PatchWorkRootRow[]): number {
  const selectable = selectableIndexes(rows);
  return selectable[0] ?? 0;
}

export function lastPatchWorkRootRow(rows: readonly PatchWorkRootRow[]): number {
  const selectable = selectableIndexes(rows);
  return selectable.at(-1) ?? 0;
}
