import pMap from 'p-map';
import { useEffect, useRef, useState } from 'react';

import mainApi from '../../mainApi';

/**
The size, the modification time and the duration of the panel's files (fork-owned).

The same two steps the work-folders dialog uses: one `stat` for the size and the time, and the main
process for the duration (it reads the container header first and falls back to FFprobe). Everything
is silent - a file that cannot be read keeps an empty line - and the values are kept for the session
of the window, so scrolling and switching the selected source does not read the same file again.
*/

export interface DetachableFileDetails {
  /** Bytes; `undefined` when `stat` failed (the file is gone or nothing can read it). */
  size?: number | undefined;
  /** Milliseconds since the epoch. */
  mtime?: number | undefined;
  /** Seconds, when the container header or FFprobe could read it. */
  duration?: number | undefined;
}

const { stat } = window.require('node:fs/promises');

const statsConcurrency = 8;
const durationChunkSize = 32;

export function useDetachableFileDetails(paths: readonly string[]) {
  const [details, setDetails] = useState<ReadonlyMap<string, DetachableFileDetails>>(() => new Map());
  const requestedRef = useRef(new Set<string>());

  useEffect(() => {
    const pending = paths.filter((path) => !requestedRef.current.has(path));
    if (pending.length === 0) return undefined;
    for (const path of pending) requestedRef.current.add(path);

    let cancelled = false;
    const merge = (values: ReadonlyMap<string, DetachableFileDetails>) => {
      if (cancelled || values.size === 0) return;
      setDetails((previous) => {
        const next = new Map(previous);
        for (const [path, value] of values) next.set(path, { ...next.get(path), ...value });
        return next;
      });
    };

    const load = async () => {
      const stats = new Map<string, DetachableFileDetails>();
      await pMap(pending, async (path) => {
        try {
          const value = await stat(path);
          stats.set(path, { size: Number(value.size), mtime: value.mtimeMs });
        } catch {
          // A file that vanished keeps its empty line; the panel never fails over one file.
        }
      }, { concurrency: statsConcurrency });
      merge(stats);

      for (let index = 0; index < pending.length; index += durationChunkSize) {
        if (cancelled) return;
        const chunk = pending.slice(index, index + durationChunkSize);
        // eslint-disable-next-line no-await-in-loop -- the count moves per chunk, like the work-folders dialog
        const result = await mainApi.patchReadBatchDurations(chunk).catch((error: unknown) => {
          console.error('Failed to read the durations for the deletion check', error);
          return undefined;
        });
        if (cancelled || result == null) continue;
        const values = new Map<string, DetachableFileDetails>();
        for (const path of chunk) {
          const duration = result[path];
          if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) values.set(path, { duration });
        }
        merge(values);
      }
    };

    load().catch((error: unknown) => {
      console.error('Failed to read the file details for the deletion check', error);
    });

    return () => { cancelled = true; };
  }, [paths]);

  return details;
}
