import { useCallback, useEffect, useRef, useState } from 'react';

import type { PatchDetachableReport } from '../../../../common/features/patchDeletable';
import mainApi from '../../mainApi';

/**
The report of one work area for the check panel (fork-owned).

The panel never scans the disk itself: the main process builds the same work-area overview the
work-folders dialog shows, narrowed to `detached_src_media` (see `common/features/patchDeletable`).
A rescan is asked for after a delete and when the window gains focus, because a finish job or an
export in another window may have moved files meanwhile.

A scan can be seconds on a work root that is a network share, so the hook does not scan twice at
once, and it ignores a focus rescan that arrives right after a finished one. An explicit refresh (the
panel's button, or the scan after a delete) skips both checks and forces the main process to scan
again instead of reusing its short-lived cache.

A request that must not be lost - the panel was switched to another work folder, or a refresh was
asked for while a scan ran - is queued instead of dropped: it runs as soon as the running scan ends,
so the panel never stays on "reading" (or on the rows of the folder it left) until the next focus.

Only the newest request may write the state: a rescan started by a focus can finish after one the
delete asked for, and the older answer would put the deleted rows back. The report remembers the root
it was read for, so a panel that switched folders shows "reading" until its own answer arrives
instead of the previous folder's rows.
*/

interface ReportState {
  /** The root `report` belongs to. */
  root: string | undefined;
  report: PatchDetachableReport | undefined;
  failed: boolean;
}

/** A scan still running: the root it reads, so a request for another root is not dropped. */
interface RunningScan {
  root: string | undefined;
}

/** A request that arrived while a scan was running. Only the newest one is kept. */
interface QueuedScan {
  force: boolean;
}

/** A focus rescan within this window after the last one would only repeat the scan. */
const minRescanMs = 2000;

export function useDetachableReport(root: string | undefined) {
  const [state, setState] = useState<ReportState>({ root: undefined, report: undefined, failed: false });
  const [refreshing, setRefreshing] = useState(false);
  const requestRef = useRef(0);
  const runningRef = useRef<RunningScan | undefined>(undefined);
  const queuedRef = useRef<QueuedScan | undefined>(undefined);
  const lastReadRef = useRef<{ root: string | undefined, at: number } | undefined>(undefined);
  // A queued scan runs with the newest root, so it goes through the newest `fetchReport`.
  const fetchRef = useRef<(options?: { force?: boolean }) => Promise<boolean>>(undefined);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const fetchReport = useCallback(async (options?: { force?: boolean }): Promise<boolean> => {
    const running = runningRef.current;
    if (running != null) {
      // Another root, or an explicit refresh, must not be dropped because a scan is already running
      // (the window is reused for another work folder, and a delete asks for a forced rescan).
      // A redundant focus rescan of the root that is being read is dropped.
      if (options?.force === true || running.root !== root) {
        queuedRef.current = { force: options?.force === true };
        return true;
      }
      return false;
    }
    const last = lastReadRef.current;
    if (options?.force !== true && last != null && last.root === root && Date.now() - last.at < minRescanMs) return false;

    runningRef.current = { root };
    const target = root;
    const request = requestRef.current + 1;
    requestRef.current = request;
    try {
      try {
        const report = await mainApi.patchDetachableReport(target, options);
        if (requestRef.current === request) setState({ root: target, report, failed: false });
      } catch (err) {
        console.error('Failed to read the detached-source report', err);
        if (requestRef.current === request) setState({ root: target, report: undefined, failed: true });
      }
    } finally {
      runningRef.current = undefined;
      lastReadRef.current = { root: target, at: Date.now() };
      const queued = queuedRef.current;
      queuedRef.current = undefined;
      // The reading flag belongs to the newest request: with one queued, the panel keeps reading
      // until that scan is done (the scan itself clears it below, including when it is skipped).
      if (queued == null && requestRef.current === request) setRefreshing(false);
      if (queued != null && aliveRef.current) {
        fetchRef.current?.({ force: queued.force })
          .then((started) => {
            if (!started && aliveRef.current) setRefreshing(false);
          })
          .catch((err: unknown) => {
            if (aliveRef.current) setRefreshing(false);
            console.error('Failed to read the detached-source report', err);
          });
      }
    }
    return true;
  }, [root]);

  useEffect(() => {
    fetchRef.current = fetchReport;
  }, [fetchReport]);

  useEffect(() => {
    fetchReport().catch((err: unknown) => { console.error('Failed to read the detached-source report', err); });
  }, [fetchReport]);

  /** Ask for a new report; the panel shows its reading state until the answer lands. */
  const reload = useCallback(async (options?: { force?: boolean }) => {
    setRefreshing(true);
    // A request that only queues the scan counts as started: the queued run clears the flag.
    const started = await fetchReport(options);
    // A skipped rescan leaves the previous state in place, so the reading flag must not stick.
    if (!started) setRefreshing(false);
  }, [fetchReport]);

  return { report: state.report, loading: refreshing || state.root !== root, failed: state.failed, reload };
}
