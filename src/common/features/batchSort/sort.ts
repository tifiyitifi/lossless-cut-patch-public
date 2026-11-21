/**
The batch list's sort model (patch, fork-owned).

The upstream list has one toggle: file name, ascending or descending. Patch mode needs the keys a
file manager offers - name, extension, size, modification time and duration - in both directions,
plus the hand-made order the list started with. The decision what the order *is* lives here, in one
pure function, so the UI only has to say which key was clicked.

Two rules are not obvious and are therefore pinned by tests:

- An unknown value (a file that could not be read, a container without a duration) sorts **last in
  both directions**. Flipping it with the direction is the classic bug: desc would put every
  unreadable file at the top, where it is the first thing the user sees.
- The tie-break tail is **always ascending**: file name, then path. So equal sizes (or equal
  modification times) keep a stable, readable order in both directions instead of shuffling.
*/

export interface BatchSortItem {
  path: string;
  name: string;
}

export type BatchSortKey = 'name' | 'ext' | 'size' | 'mtime' | 'duration';

export type BatchSortDirection = 'asc' | 'desc';

/**
`manual` is the list's own order: the order the files were added in, or the order the user made by
dragging rows. It is not "no order" - it is the order the array already has.
*/
export type BatchSortSpec =
  | { key: BatchSortKey, direction: BatchSortDirection }
  | { key: 'manual' };

/** What the sort needs to know about one file besides its path and name. */
export interface BatchFileSortMeta {
  /** File size in bytes. */
  size?: number | undefined;
  /** Last modification time, in milliseconds since the epoch. */
  mtime?: number | undefined;
  /** Container duration in seconds. */
  duration?: number | undefined;
}

/** The keys in menu order. `manual` is not one of them: it is not a sort, it is the list as it is. */
export const batchSortKeys: readonly BatchSortKey[] = ['name', 'ext', 'size', 'mtime', 'duration'];

export function isManualSortSpec(spec: BatchSortSpec): spec is { key: 'manual' } {
  return spec.key === 'manual';
}

/** Which meta fields a key has to read before it can sort. Name and extension read the name only. */
export function metaFieldsForSortKey(key: BatchSortKey): readonly (keyof BatchFileSortMeta)[] {
  if (key === 'size' || key === 'mtime' || key === 'duration') return [key];
  return [];
}

/**
Whether a value can be sorted on.

`0` counts as unknown for every key, not only for size: a container that reports a zero duration
means "not known" (live recordings, some TS files), and a zero modification time is not a real file
time either. Such a row belongs at the bottom, not at the top.
*/
export function isKnownSortValue(value: number | undefined): value is number {
  return value != null && Number.isFinite(value) && value > 0;
}

/** The lower-case extension of a file name, or `''` when it has none (`.bashrc`, `name.`). */
export function getSortExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

/**
The spec a click on `key` produces: the same key flips the direction, another key starts ascending.

Clicking the same key twice is the way a file manager offers both directions without a second
control, and it keeps the menu small.
*/
export function nextSortSpec(current: BatchSortSpec, key: BatchSortKey): { key: BatchSortKey, direction: BatchSortDirection } {
  if (!isManualSortSpec(current) && current.key === key) {
    return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  }
  return { key, direction: 'asc' };
}

/**
One collator for the whole run: `localeCompare` with the same options creates one per call, and a
sort calls the comparison O(n log n) times.
*/
const nameCollator = new Intl.Collator('en-US', { numeric: true });

function compareNames(a: string, b: string) {
  if (a === b) return 0;
  return nameCollator.compare(a, b);
}

function comparePaths(a: string, b: string) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** The tie-break tail: name, then path, ascending in both directions (see the module doc). */
function compareTail(a: BatchSortItem, b: BatchSortItem) {
  const byName = compareNames(a.name, b.name);
  if (byName !== 0) return byName;
  return comparePaths(a.path, b.path);
}

/**
A numeric comparison that keeps unknown values at the bottom in both directions.

`direction` is `1` for ascending and `-1` for descending; it only ever applies to two *known*
values, so an unreadable file cannot jump to the top when the direction flips.
*/
function compareKnownValues(a: number | undefined, b: number | undefined, direction: number) {
  const aKnown = isKnownSortValue(a);
  const bKnown = isKnownSortValue(b);
  if (aKnown !== bKnown) return aKnown ? -1 : 1;
  if (!aKnown || !bKnown) return 0;
  // Both are known; the guard above only narrowed the booleans, so narrow the values again.
  if (a == null || b == null) return 0;
  if (a === b) return 0;
  return direction * (a < b ? -1 : 1);
}

interface Comparable<T extends BatchSortItem> {
  file: T;
  index: number;
  meta: BatchFileSortMeta | undefined;
}

function comparePrimary<T extends BatchSortItem>(a: Comparable<T>, b: Comparable<T>, key: BatchSortKey, direction: number) {
  if (key === 'name') return direction * compareNames(a.file.name, b.file.name);
  if (key === 'ext') {
    const extensionA = getSortExtension(a.file.name);
    const extensionB = getSortExtension(b.file.name);
    if (extensionA !== extensionB) return direction * (extensionA < extensionB ? -1 : 1);
    // The same extension is a group: its members follow the same direction as the groups.
    return direction * compareNames(a.file.name, b.file.name);
  }
  if (key === 'size') return compareKnownValues(a.meta?.size, b.meta?.size, direction);
  if (key === 'mtime') return compareKnownValues(a.meta?.mtime, b.meta?.mtime, direction);
  return compareKnownValues(a.meta?.duration, b.meta?.duration, direction);
}

/**
The list in the order `spec` asks for, as a new array.

`metaFor` is asked only for the rows the sort looks at; a key that needs no meta never calls it, so
sorting by name or extension costs nothing beyond the comparison.
*/
export function sortBatchFiles<T extends BatchSortItem>(
  files: readonly T[],
  spec: BatchSortSpec,
  metaFor: (path: string) => BatchFileSortMeta | undefined,
): T[] {
  if (isManualSortSpec(spec)) return [...files];

  const direction = spec.direction === 'asc' ? 1 : -1;
  // A name or extension sort never looks at meta, so it must not ask for it either: the caller may
  // have to read the file system for the answer.
  const needsMeta = metaFieldsForSortKey(spec.key).length > 0;
  const comparable = files.map((file, index) => ({ file, index, meta: needsMeta ? metaFor(file.path) : undefined }));

  comparable.sort((a, b) => {
    const primary = comparePrimary(a, b, spec.key, direction);
    if (primary !== 0) return primary;
    const tail = compareTail(a.file, b.file);
    if (tail !== 0) return tail;
    // Never reached for two different paths; keeps the sort stable for identical rows.
    return a.index - b.index;
  });

  return comparable.map(({ file }) => file);
}

/** The direction label of a spec, for the menu; `undefined` for the manual order. */
export function getSortDirection(spec: BatchSortSpec): BatchSortDirection | undefined {
  return isManualSortSpec(spec) ? undefined : spec.direction;
}

/**
The cached details of the rows `files` still holds, as a new map.

The session cache outlives the panel (see the renderer's `features/batchSort/sortSession`), so
without this it would remember every file the list ever had for the rest of the run: a row that
left and was added back would be sorted by the size and duration read *before* whatever changed it,
because the "is it known?" check would find the old value and never read the file again. Pruning
whenever the row set changes keeps the cache saying the same thing as the list.

The keys of the rows that stay are kept, so hiding and showing the panel still costs nothing.
*/
export function pruneBatchSortMeta(
  meta: ReadonlyMap<string, BatchFileSortMeta>,
  files: readonly { path: string }[],
): Map<string, BatchFileSortMeta> {
  if (meta.size === 0) return new Map();

  const paths = new Set(files.map((file) => file.path));
  return new Map([...meta].filter(([path]) => paths.has(path)));
}
