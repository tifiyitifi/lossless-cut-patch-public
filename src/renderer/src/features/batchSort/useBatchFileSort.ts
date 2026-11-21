import i18n from 'i18next';
import { useCallback, useEffect, useRef, useState } from 'react';
import pMap from 'p-map';

import type { BatchSortDirection, BatchSortKey, BatchSortSpec } from '../../../../common/features/batchSort';
import { isManualSortSpec, metaFieldsForSortKey, nextSortSpec, sortBatchFiles } from '../../../../common/features/batchSort';
import mainApi from '../../mainApi';
import getSwal from '../../swal';
import { readFileStats } from '../../util';
import { getBatchSortMeta, getBatchSortSpec, getUnavailableBatchSortKeys, isBatchSortFieldAttempted, isBatchSortKeyUnavailable, markBatchSortFieldsAttempted, markBatchSortKeyUnavailable, mergeBatchSortMeta, pruneBatchSortMetaCache, setBatchSortSpec } from './sortSession';

/**
The batch list's sorting behaviour (patch, fork-owned).

The rules (what order a key produces) are in `common/features/batchSort`; this hook only supplies
the file facts they need and applies the result to the list:

- name and extension need nothing;
- size and modification time come from one `stat` pass (both at once, so switching between the two
  costs nothing);
- duration comes from the main process in chunks: it reads the container header first and falls back
  to ffprobe, so the panel can show progress and stop when the user picks another key.

The facts are also what the row's detail line shows (duration, size, modification time), so the
hook reads them in the background as soon as the list has rows - not only when a sort is asked for.
That read is silent: a file (or a batch) whose details cannot be read simply keeps an empty detail
line. A failure only becomes a dialog when the user asks for that sort, and then it disables that
one key for the session; name, extension, size and modification time keep working.
*/

export interface BatchSortProgress {
  done: number;
  total: number;
}

/** Files read per progress step: small enough to feel live, large enough to keep the IPC cheap. */
const durationChunkSize = 16;

/** `stat` calls in flight at once. The file system answers them off the UI thread. */
const statsConcurrency = 8;

/**
How long a row-set change waits before the newcomers' details are read.

Files arrive one batch at a time (a drop, a directory, the file dialog), and each batch is its own
state change: reading at once would start a run that the next batch immediately cancels.
*/
const rowSetResortDelayMs = 200;

async function showDurationUnavailable() {
  await getSwal().Swal.fire({
    icon: 'error',
    title: i18n.t('Sorting by duration is unavailable'),
    text: i18n.t('The duration of the files could not be read. Sorting by name, extension, file size and modification time still works.'),
  });
}

async function showFileDetailsUnavailable() {
  await getSwal().Swal.fire({
    icon: 'error',
    title: i18n.t('Sorting by file size and modification time is unavailable'),
    text: i18n.t('The file details could not be read. Sorting by name and extension still works.'),
  });
}

async function readDurations(paths: readonly string[], onProgress: (progress: BatchSortProgress) => void, isCancelled: () => boolean) {
  const values: Record<string, number> = {};

  for (let index = 0; index < paths.length; index += durationChunkSize) {
    if (isCancelled()) return undefined;
    const chunk = paths.slice(index, index + durationChunkSize);
    // eslint-disable-next-line no-await-in-loop
    const result = await mainApi.patchReadBatchDurations([...chunk]);
    for (const path of chunk) {
      const value = result[path];
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) values[path] = value;
    }
    onProgress({ done: Math.min(index + chunk.length, paths.length), total: paths.length });
  }

  return values;
}

async function fillMissingMeta(key: BatchSortKey, missing: readonly string[], onProgress: (progress: BatchSortProgress | undefined) => void, isCancelled: () => boolean, reportFailure: boolean) {
  if (missing.length === 0) return true;

  onProgress({ done: 0, total: missing.length });

  if (key === 'duration') {
    const values = await readDurations(missing, onProgress, isCancelled);
    onProgress(undefined);
    if (values == null || isCancelled()) return false;

    let known = 0;
    for (const path of missing) {
      const value = values[path];
      if (value != null) {
        mergeBatchSortMeta(path, { duration: value });
        known += 1;
      }
      // Marked even when the value came back unknown: the quiet background read must not probe an
      // unreadable file again on every show. A sort the user asks for ignores this mark.
      markBatchSortFieldsAttempted(path, ['duration']);
    }

    // Some files without a duration is normal (a stream copy without a header, a broken container):
    // they simply sort last. Only a total failure means the feature itself is unavailable.
    if (known === 0) {
      // A read nobody asked for must not disable the key or show a dialog: the rows simply stay
      // unknown and sort last until the user picks the key.
      if (!reportFailure) return false;
      markBatchSortKeyUnavailable('duration', missing);
      await showDurationUnavailable();
      return false;
    }
    return true;
  }

  let known = 0;
  let done = 0;
  await pMap(missing, async (path) => {
    try {
      const stats = await readFileStats(path);
      mergeBatchSortMeta(path, { size: Number(stats.size), mtime: Number(stats.mtimeMs) });
      known += 1;
    } catch {
      // An unreadable file stays "unknown" and sorts last; the batch is not failed over it.
    }
    // One `stat` answers both size and modification time (see `sortSession`).
    markBatchSortFieldsAttempted(path, ['size', 'mtime']);
    done += 1;
    if (!isCancelled()) onProgress({ done, total: missing.length });
  }, { concurrency: statsConcurrency });

  onProgress(undefined);
  if (isCancelled()) return false;

  if (known === 0) {
    if (!reportFailure) return false;
    markBatchSortKeyUnavailable('size', missing);
    markBatchSortKeyUnavailable('mtime', missing);
    await showFileDetailsUnavailable();
    return false;
  }
  return true;
}

export default function useBatchFileSort<T extends { path: string, name: string }>({ files, setFiles, enabled }: {
  files: readonly T[];
  setFiles: (files: T[]) => void;
  /** Base mode keeps the upstream toggle; the patch sorting behaviour is only used in patch mode. */
  enabled: boolean;
}) {
  const [spec, setSpecState] = useState<BatchSortSpec>(getBatchSortSpec);
  const [progress, setProgress] = useState<BatchSortProgress | undefined>();
  const [unavailableKeys, setUnavailableKeys] = useState<ReadonlySet<BatchSortKey>>(getUnavailableBatchSortKeys);

  // A run is cancelled by starting another one: the chunk loop checks this and stops asking.
  const runRef = useRef(0);

  // Hiding the list unmounts the panel. A background read must not keep spawning ffprobe for a list
  // nobody is looking at; what it already read stays in the session cache.
  useEffect(() => () => {
    runRef.current += 1;
  }, []);

  // The list can change while a duration read is in flight (files dropped, rows removed). Sorting
  // the array captured at click time would silently undo that, so the apply step reads the latest.
  const filesRef = useRef(files);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const refreshUnavailableKeys = useCallback(() => {
    setUnavailableKeys(getUnavailableBatchSortKeys());
  }, []);

  const applySort = useCallback((next: BatchSortSpec) => {
    setBatchSortSpec(next);
    setSpecState(next);
    if (isManualSortSpec(next)) return;
    setFiles(sortBatchFiles(filesRef.current, next, getBatchSortMeta));
  }, [setFiles]);

  /**
  Read everything the row's detail line shows for the rows that do not have it yet.

  This is the quiet read behind the list itself (and the resume after a sort interrupted it), so
  `reportFailure` is always off: no dialog, no disabled key, rows whose details are missing keep an
  empty detail line. Rows that were already looked at are skipped (`isBatchSortFieldAttempted`).
  */
  const prefetchDetails = useCallback(async (isCancelled: () => boolean) => {
    const statPaths = filesRef.current.map((file) => file.path).filter((path) => {
      const meta = getBatchSortMeta(path);
      if (meta?.size == null && !isBatchSortFieldAttempted(path, 'size')) return true;
      return meta?.mtime == null && !isBatchSortFieldAttempted(path, 'mtime');
    });
    if (statPaths.length > 0) {
      await fillMissingMeta('size', statPaths, (next) => { if (!isCancelled()) setProgress(next); }, isCancelled, false);
      if (isCancelled()) return;
    }

    const durationPaths = filesRef.current
      .map((file) => file.path)
      .filter((path) => getBatchSortMeta(path)?.duration == null && !isBatchSortFieldAttempted(path, 'duration'));
    if (durationPaths.length > 0) {
      await fillMissingMeta('duration', durationPaths, (next) => { if (!isCancelled()) setProgress(next); }, isCancelled, false);
    }
  }, []);

  /**
  Start the quiet read as its own run.

  It takes the run id, so it cancels whatever was in flight; the callers that cancel it (a sort, the
  manual order) start it again when they are done, which is how the detail line always ends up
  complete.
  */
  const startPrefetch = useCallback(() => {
    if (!enabled) return;
    runRef.current += 1;
    const runId = runRef.current;
    const isCancelled = () => runRef.current !== runId;
    prefetchDetails(isCancelled)
      .catch((err: unknown) => { console.error('Failed to read the details of the source files', err); })
      .finally(() => { if (!isCancelled()) setProgress(undefined); });
  }, [enabled, prefetchDetails]);

  /**
  Read what `key` needs for the rows that do not have it yet, reporting progress while it runs.

  A throw has to clear the progress as well: the icon reports "reading" and the menu stays closed
  while it does, so nothing else would ever reset it.
  */
  const fillMetaFromDisk = useCallback(async (key: BatchSortKey, runId: number, reportFailure: boolean) => {
    const isCancelled = () => runRef.current !== runId;

    const fields = metaFieldsForSortKey(key);
    const missing = fields.length === 0 ? [] : filesRef.current
      .map((file) => file.path)
      .filter((path) => {
        const meta = getBatchSortMeta(path);
        return fields.some((field) => meta?.[field] == null);
      });

    try {
      return await fillMissingMeta(key, missing, (next) => { if (!isCancelled()) setProgress(next); }, isCancelled, reportFailure);
    } finally {
      // A newer run owns the progress bar from now on, so only this run may clear it.
      if (!isCancelled()) setProgress(undefined);
    }
  }, []);

  /** Read what is missing, then put the list in the order `makeSpec` decides on. */
  const runSort = useCallback(async (key: BatchSortKey, makeSpec: () => BatchSortSpec, { reportFailure = true }: { reportFailure?: boolean } = {}) => {
    runRef.current += 1;
    const runId = runRef.current;

    const read = await fillMetaFromDisk(key, runId, reportFailure);
    if (!read || runRef.current !== runId) {
      // A failed read disables its key for the session; the list order stays as it was.
      if (isBatchSortKeyUnavailable(key)) refreshUnavailableKeys();
      return;
    }

    applySort(makeSpec());
    // The sort only read the key it was asked for; the detail line shows all three values, so the
    // remaining ones are picked up in the background - which also resumes a prefetch this run
    // cancelled.
    startPrefetch();
  }, [applySort, fillMetaFromDisk, refreshUnavailableKeys, startPrefetch]);

  const sortBy = useCallback(async (key: BatchSortKey) => {
    if (!enabled || filesRef.current.length === 0 || isBatchSortKeyUnavailable(key)) return;
    await runSort(key, () => nextSortSpec(getBatchSortSpec(), key));
  }, [enabled, runSort]);

  const setDirection = useCallback(async (direction: BatchSortDirection) => {
    const current = getBatchSortSpec();
    if (isManualSortSpec(current)) return;
    // A key whose read failed for the session has nothing cached and is not retried (see the module
    // doc): a flip would run the same failing read and show the same dialog again.
    if (isBatchSortKeyUnavailable(current.key)) {
      applySort({ key: current.key, direction });
      return;
    }
    // Rows can have arrived since the key was applied: read them first, or the flip would drop them
    // to the bottom as "unknown" instead of ordering them by the key.
    await runSort(current.key, () => ({ key: current.key, direction }));
  }, [applySort, runSort]);

  /** Back to the order the list has: the order it was added in, or the one the user dragged. */
  const resetToManual = useCallback(() => {
    // A read that is still running belongs to the sort the user just left: without this it finishes
    // and re-applies that key, replacing the order the user set by hand.
    runRef.current += 1;
    // That run's `finally` now sees a newer run and leaves the progress to it, so clear it here.
    setProgress(undefined);
    setBatchSortSpec({ key: 'manual' });
    setSpecState({ key: 'manual' });
    // The list still wants its detail line: the cancellation above was only meant for the sort.
    startPrefetch();
  }, [startPrefetch]);

  // The list can gain rows while a sort key is active (a drop, the file dialog, the API). The array
  // is then the old order plus the new rows, which is no longer the order the menu shows as checked.
  //
  // The same effect is what fills the detail line in the first place: on the first render of the
  // list, and whenever rows arrive, everything the row shows is read - then, if a key is active,
  // the sort is re-applied (a row with no details yet would otherwise sit at the bottom for good,
  // under a menu that claims the list is sorted by that key).
  const rowSetSignatureRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const signature = files.map((file) => file.path).sort().join('\n');
    const previousSignature = rowSetSignatureRef.current;
    rowSetSignatureRef.current = signature;
    const firstRender = previousSignature === undefined;
    const rowSetChanged = !firstRender && previousSignature !== signature;

    // The session cache is keyed by path and outlives this panel: follow the list, so a file it no
    // longer holds is forgotten and one added back is read again instead of being sorted by details
    // from before whatever changed it (see `pruneBatchSortMetaCache`). A reorder keeps every path,
    // so it is left alone.
    if (enabled && (firstRender || rowSetChanged)) {
      pruneBatchSortMetaCache(files);
      // A key that was disabled because of files the list no longer holds is available again.
      refreshUnavailableKeys();
    }

    if (!enabled || files.length === 0) return undefined;
    if (!firstRender && !rowSetChanged) return undefined;

    // Debounced: a drop arrives as one change per batch, and every change would otherwise start a
    // read that the next one cancels. Deferring also keeps the state update out of the effect's own
    // synchronous body.
    const runIdAtEffect = runRef.current;
    const timer = setTimeout(() => {
      // A sort started while we waited (a menu click, a drag back to the manual order) already read
      // every row that was missing, and it owns the list now: don't start a second run over it.
      if (runRef.current !== runIdAtEffect) return;

      const current = getBatchSortSpec();
      // Nobody asked for this read, so a failure stays quiet: the newcomers keep sorting last and
      // the key stays available.
      const resort = rowSetChanged && !isManualSortSpec(current) && !isBatchSortKeyUnavailable(current.key);

      runRef.current += 1;
      const runId = runRef.current;
      const isCancelled = () => runRef.current !== runId;

      prefetchDetails(isCancelled)
        .then(() => {
          if (isCancelled() || !resort) return;
          // The newcomers were not in the list when the key was applied: re-apply it now that their
          // details are known, so the check mark in the menu keeps describing the order.
          applySort(current);
        })
        .catch((err: unknown) => { console.error('Failed to read the details of the new files', err); })
        .finally(() => { if (!isCancelled()) setProgress(undefined); });
    }, rowSetResortDelayMs);
    return () => clearTimeout(timer);
  }, [applySort, enabled, files, prefetchDetails, refreshUnavailableKeys]);

  return { spec, progress, unavailableKeys, sortBy, setDirection, resetToManual };
}
