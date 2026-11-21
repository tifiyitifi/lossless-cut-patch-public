import type { BatchSortKey } from './sort.js';

/**
Which sort keys stay disabled after the list changed (patch, fork-owned).

A sort the user asks for that cannot read a single file disables its key for the session: the
reason (no permission on a folder, ffprobe missing) does not fix itself while the app runs, so
re-enabling at once would only show the same dialog on the next click.

The failing files are remembered, not just the key, so a batch that is *replaced* gets its keys
back: the reason was those files, and they are no longer in the list. A batch that still holds
every file that failed keeps the key disabled. This is the same rule the meta cache follows
(`pruneBatchSortMeta`), and it lives here so both are unit tested.

The function is pure: the map it is given is left untouched, so the caller can replace its own
state with the result.
*/
export function pruneUnavailableSortKeys(
  failures: ReadonlyMap<BatchSortKey, ReadonlySet<string>>,
  files: readonly { path: string }[],
): Map<BatchSortKey, Set<string>> {
  const paths = new Set(files.map((file) => file.path));
  const pruned = new Map<BatchSortKey, Set<string>>();

  for (const [key, failedPaths] of failures) {
    const kept = new Set<string>();
    for (const path of failedPaths) if (paths.has(path)) kept.add(path);
    // No failing file left means the next attempt is about a different batch, so it may try again.
    if (kept.size > 0) pruned.set(key, kept);
  }

  return pruned;
}
