import type { BatchFileSortMeta, BatchSortKey, BatchSortSpec } from '../../../../common/features/batchSort';
import { pruneBatchSortMeta, pruneUnavailableSortKeys } from '../../../../common/features/batchSort';

/**
The batch list's sort session (patch, fork-owned).

It lives outside the component on purpose. Patch mode hides the source list by unmounting
`BatchFilesList` (see `batchFilesListVisible` in App), so state held inside the panel would be
thrown away every time the list is hidden. "Session level" is exactly this: read once, survive
hiding and sorting, gone when the app closes.

The keys that failed to read stay disabled for the rest of the session too: the reason (no
permission on a folder, ffprobe missing) does not fix itself while the app runs, and re-enabling
would only show the same error again on the next click. What is remembered is the *files* that
failed, so replacing the batch re-enables the key: the reason was those files, and they are gone.
*/

type SortMetaField = keyof BatchFileSortMeta;

const metaByPath = new Map<string, BatchFileSortMeta>();
/** Per key: the files whose read failed. A key is disabled exactly while this set is non-empty. */
const failedPathsByKey = new Map<BatchSortKey, Set<string>>();
let spec: BatchSortSpec = { key: 'manual' };

/**
The fields already looked at for a path, successful or not.

The list reads every row's details in the background so its detail line is complete (see
`useBatchFileSort`). Without this, a file whose duration cannot be read would start a failing
probe every time the panel is shown again, for the whole session: the "is it known?" check can
never say yes for it. A *user-ordered* sort ignores this and retries loudly (that is what disables
the key and explains itself).
*/
const attemptedFieldsByPath = new Map<string, Set<SortMetaField>>();

export function isBatchSortFieldAttempted(path: string, field: SortMetaField) {
  return attemptedFieldsByPath.get(path)?.has(field) ?? false;
}

export function markBatchSortFieldsAttempted(path: string, fields: readonly SortMetaField[]) {
  const attempted = attemptedFieldsByPath.get(path);
  if (attempted == null) attemptedFieldsByPath.set(path, new Set(fields));
  else for (const field of fields) attempted.add(field);
}

export function getBatchSortMeta(path: string) {
  return metaByPath.get(path);
}

/** Add what was just read for a file; fields that were already known are kept. */
export function mergeBatchSortMeta(path: string, meta: BatchFileSortMeta) {
  metaByPath.set(path, { ...metaByPath.get(path), ...meta });
}

/**
Follow the list: forget the details of every file it no longer holds.

A path that is added back is read again instead of being sorted by the size or duration it had
before whatever changed it - the cache says "known" for a path, so without this the read would
never happen again (see `pruneBatchSortMeta` in `common/features/batchSort`). Called when the set
of rows changes, not on a reorder: a reorder keeps every path.
*/
export function pruneBatchSortMetaCache(files: readonly { path: string }[]) {
  // Applied in place (no early return on an unchanged size): one change can drop a row and add
  // another, and the two sets then have the same size while sharing nothing.
  const pruned = pruneBatchSortMeta(metaByPath, files);
  metaByPath.clear();
  for (const [path, meta] of pruned) metaByPath.set(path, meta);

  // The "already tried" marks follow the same rule: a file that is added back is read again
  // instead of being left without a duration because of a failed attempt from before.
  const paths = new Set(files.map((file) => file.path));
  for (const path of attemptedFieldsByPath.keys()) {
    if (!paths.has(path)) attemptedFieldsByPath.delete(path);
  }

  // A disabled key follows the failing files too: a batch whose unreadable files are all gone
  // (replaced by others, or the reason was those files) may be tried again. A batch that still
  // holds them keeps the key off, so the same dialog does not pop up on the next click.
  const prunedFailures = pruneUnavailableSortKeys(failedPathsByKey, files);
  failedPathsByKey.clear();
  for (const [key, failed] of prunedFailures) failedPathsByKey.set(key, failed);
}

export function getUnavailableBatchSortKeys(): ReadonlySet<BatchSortKey> {
  return new Set(failedPathsByKey.keys());
}

export function isBatchSortKeyUnavailable(key: BatchSortKey) {
  return failedPathsByKey.has(key);
}

/** Remember the files whose read failed for `key`; the key stays disabled while they are listed. */
export function markBatchSortKeyUnavailable(key: BatchSortKey, paths: readonly string[]) {
  if (paths.length === 0) return;
  const failed = failedPathsByKey.get(key);
  if (failed == null) failedPathsByKey.set(key, new Set(paths));
  else for (const path of paths) failed.add(path);
}

/**
The sort the list is in.

Kept here rather than in the panel so hiding and showing the list does not silently drop back to
"manual": the user sorted the list, and the next/previous keys follow that order.
*/
export function getBatchSortSpec() {
  return spec;
}

export function setBatchSortSpec(next: BatchSortSpec) {
  spec = next;
}
