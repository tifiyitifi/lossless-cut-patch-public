import pMap from 'p-map';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { PatchOverview } from '../../../../common/features/patchResultsOverview';
import { collectOverviewFilePaths } from '../../../../common/features/patchResultsOverview';
import mainApi from '../../mainApi';
import { readFileStats } from '../../util';

/**
The size and the duration of the files an expanded work folder lists (patch, fork-owned).

The dialog shows the numbers next to every file so a result can be judged without opening it, and
this hook reads them for the files of one overview:

- the size comes from one `stat`, which is cheap and answers in milliseconds;
- the duration comes from the main process (`patchReadBatchDurations`), which reads the container
  header first and falls back to FFprobe for the containers it does not understand, in chunks so the
  dialog can show how far it got.

Everything is silent: a file that cannot be read simply keeps its empty line (the same rule the
source list follows), and closing the dialog stops the dialog from showing more numbers - the
`stat` pass already running finishes in the background, and no further duration chunk is asked for.
The values are kept for the lifetime of the dialog: folding a folder away and back does not read the
same file again, while opening the dialog later reads everything anew (a finish job may have moved or
rewritten the files meanwhile).
*/

export interface WorkFolderFileDetails {
  /** Bytes. A 0-byte result is shown as `0 B` on purpose: that is a failed export at a glance. */
  size?: number | undefined;
  /** Seconds; `undefined` when neither the header nor FFprobe could read it. */
  duration?: number | undefined;
}

export interface WorkFolderFileDetailsProgress {
  done: number;
  total: number;
}

/** `stat` calls in flight at once. The file system answers them off the UI thread. */
const statsConcurrency = 8;

/** Rows collected before the list is re-rendered, so a big folder does not render once per file. */
const statsFlushSize = 64;

/** Files per duration request: large enough to keep the IPC cheap, small enough to move the count. */
const durationChunkSize = 32;

export function useWorkFolderFileDetails() {
  const [details, setDetails] = useState<ReadonlyMap<string, WorkFolderFileDetails>>(() => new Map());
  const [progress, setProgress] = useState<WorkFolderFileDetailsProgress | undefined>(undefined);
  /** Paths a run was already started for; a second root that shares a file does not read it again. */
  const requestedRef = useRef(new Set<string>());
  const mountedRef = useRef(true);
  /**
  One entry per `load()`. Two roots can be expanded while the first is still reading, and the paths
  are disjoint (see `requestedRef`), so the footer shows the sum instead of one run overwriting the
  other's total or clearing the count while the other still reads.
  */
  const runProgressRef = useRef(new Map<number, WorkFolderFileDetailsProgress>());
  const nextRunIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const publishProgress = useCallback(() => {
    if (!mountedRef.current) return;
    let done = 0;
    let total = 0;
    for (const value of runProgressRef.current.values()) {
      done += value.done;
      total += value.total;
    }
    setProgress(total === 0 ? undefined : { done, total });
  }, []);

  const updateRunProgress = useCallback((runId: number, value: WorkFolderFileDetailsProgress | undefined) => {
    if (value == null) runProgressRef.current.delete(runId);
    else runProgressRef.current.set(runId, value);
    publishProgress();
  }, [publishProgress]);

  const merge = useCallback((values: ReadonlyMap<string, WorkFolderFileDetails>) => {
    if (!mountedRef.current || values.size === 0) return;
    setDetails((previous) => {
      const next = new Map(previous);
      for (const [path, value] of values) next.set(path, { ...next.get(path), ...value });
      return next;
    });
  }, []);

  const addOverview = useCallback((overview: PatchOverview) => {
    const paths = collectOverviewFilePaths(overview).filter((path) => !requestedRef.current.has(path));
    if (paths.length === 0) return;
    for (const path of paths) requestedRef.current.add(path);

    const runId = nextRunIdRef.current + 1;
    nextRunIdRef.current = runId;

    const load = async () => {
      // Sizes first and all at once: the row shows its size while the duration is still being read,
      // and a folder of a thousand files is a handful of re-renders instead of a thousand.
      let pending = new Map<string, WorkFolderFileDetails>();
      await pMap(paths, async (path) => {
        try {
          const stats = await readFileStats(path);
          pending.set(path, { size: Number(stats.size) });
        } catch {
          // A file that vanished between the scan and now keeps an empty line; the dialog never fails
          // over it, exactly like the source list.
        }
        if (pending.size >= statsFlushSize) {
          merge(pending);
          pending = new Map();
        }
      }, { concurrency: statsConcurrency });
      merge(pending);
      if (!mountedRef.current) return;

      updateRunProgress(runId, { done: 0, total: paths.length });
      try {
        for (let index = 0; index < paths.length; index += durationChunkSize) {
          if (!mountedRef.current) return;
          const chunk = paths.slice(index, index + durationChunkSize);
          // eslint-disable-next-line no-await-in-loop
          const result = await mainApi.patchReadBatchDurations(chunk).catch((error: unknown) => {
            console.error('Failed to read the file durations for the work folders dialog', error);
            return undefined;
          });
          if (!mountedRef.current) return;
          // One failed request must not abandon the rest of the folder: the remaining chunks are
          // asked for as usual, and the rows they cover still get their duration.
          if (result == null) continue;

          const values = new Map<string, WorkFolderFileDetails>();
          for (const path of chunk) {
            const value = result[path];
            if (typeof value === 'number' && Number.isFinite(value) && value > 0) values.set(path, { duration: value });
          }
          merge(values);
          updateRunProgress(runId, { done: Math.min(index + chunk.length, paths.length), total: paths.length });
        }
      } finally {
        // Also on an early exit: a run that stopped must not keep its count in the footer.
        updateRunProgress(runId, undefined);
      }
    };

    load().catch((error: unknown) => {
      console.error('Failed to read the file details for the work folders dialog', error);
      updateRunProgress(runId, undefined);
    });
  }, [merge, updateRunProgress]);

  return { details, progress, addOverview };
}
