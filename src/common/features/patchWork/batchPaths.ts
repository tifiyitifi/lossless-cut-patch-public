import { getPathFileName, isSamePath } from '../patchFinish/paths.js';

/**
The source file list holds one row per file (fork-owned, pure).

A path reaches the list from several places (a drop, the file dialog, the HTTP API, and a finish
job that reports where it moved the source), and the same file can be spelled differently
(`C:\a\b.mp4`, `c:/a/b.mp4`). Upstream compares the strings exactly, so those spellings become
separate rows with the same name - and a finish job that maps the old path to the new one then
leaves two *identical* rows behind, which can no longer be told apart (or removed one by one).

These helpers compare the way the file system does (see `isSamePath`) and are used by patch mode
only: base mode keeps the upstream exact-string list untouched.
*/

/** One row of the source list, in the shape both the app and these helpers use. */
export interface PatchBatchEntry {
  path: string;
  name: string;
}

/** Keep the first occurrence of each file, dropping later spellings of the same one. */
function dedupeBy<T>(items: readonly T[], key: (item: T) => string, { caseInsensitive }: { caseInsensitive: boolean }): T[] {
  const keptKeys: string[] = [];
  return items.filter((item) => {
    const itemKey = key(item);
    if (keptKeys.some((existing) => isSamePath(existing, itemKey, { caseInsensitive }))) return false;
    keptKeys.push(itemKey);
    return true;
  });
}

/** One path per file (used for the selection, which is a plain path list). */
export function dedupePaths(paths: readonly string[], { caseInsensitive }: { caseInsensitive: boolean }): string[] {
  return dedupeBy(paths, (path) => path, { caseInsensitive });
}

/** One row per file. */
export function dedupeBatchPaths<T extends { path: string }>(entries: readonly T[], { caseInsensitive }: { caseInsensitive: boolean }): T[] {
  return dedupeBy(entries, (entry) => entry.path, { caseInsensitive });
}

/**
The list after appending `added`.

The whole result is deduplicated, not only the new part: a list written by an older build can
already hold two spellings of one file, and the next append is a good moment to heal it. The
first occurrence (and with it the user's row order) wins.
*/
export function appendBatchPaths<T extends { path: string }>(existing: readonly T[], added: readonly T[], { caseInsensitive }: { caseInsensitive: boolean }): T[] {
  const newEntries = dedupeBatchPaths(added, { caseInsensitive })
    .filter((entry) => existing.every((e) => !isSamePath(e.path, entry.path, { caseInsensitive })));
  return dedupeBatchPaths([...existing, ...newEntries], { caseInsensitive });
}

/**
The list after the finish job moved the source from `from` to `to`.

The entry follows the file (and takes its new name, which may have gained a ` (1)` suffix), and
any row that now points at the same file is folded into it - this is the step that used to leave
two identical rows when the list happened to hold the old path twice.
*/
export function updateBatchPath(entries: readonly PatchBatchEntry[], { from, to, caseInsensitive }: {
  from: string;
  to: string;
  caseInsensitive: boolean;
}): PatchBatchEntry[] {
  const moved = entries.map((entry) => (
    isSamePath(entry.path, from, { caseInsensitive })
      ? { path: to, name: getPathFileName(to) }
      : entry
  ));
  return dedupeBatchPaths(moved, { caseInsensitive });
}
