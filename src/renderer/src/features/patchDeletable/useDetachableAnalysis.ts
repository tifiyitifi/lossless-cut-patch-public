import { useCallback, useEffect, useRef, useState } from 'react';

import type { PatchCheckSummary, PatchDeepCheckPhase } from '../../../../common/features/patchDeletable';
import { summarizePatchCheckOutcomes } from '../../../../common/features/patchDeletable';
import mainApi from '../../mainApi';

/**
A queue of deep checks for the deletion check's column headers (fork-owned).

One file at a time: two FFmpeg decodes of the same disk would halve both and make the progress
numbers meaningless. `start` takes the paths (the caller already decided which ones - see
`analysisScope.ts`), drops duplicates, and awaits each `run`; progress and the outcome reach the cards
through the existing IPC channel, so the hook only owns the queue and the counter the header shows.

The runner resolves with the phase its file ended in, which is how the header can summarize the batch
afterwards. A file whose run throws (the IPC itself failed) counts as nothing: no outcome was reported
for it, so guessing one would be worse than leaving it out.

`stop` clears the queue and aborts the file that is being decoded. The run that was aborted still
resolves (with `canceled`), so the loop ends after it, and the summary covers what the batch reached
before the stop.

`path` is the file being decoded right now. The panel looks its progress up in the states the IPC
channel already fills, so the header can show a percentage that moves without a second progress
channel.
*/
export interface DetachableAnalysisState {
  running: boolean;
  done: number;
  total: number;
  /** The file the queue is decoding now, for the header's percentage. */
  path: string | undefined;
  /** What the last finished batch did, until the panel dismisses it. */
  summary: PatchCheckSummary | undefined;
}

/** One file's run: resolves with the phase it ended in (see `PatchDeepCheckPhase`). */
export type DetachableAnalysisRunner = (path: string) => Promise<PatchDeepCheckPhase | undefined>;

export function useDetachableAnalysis(run: DetachableAnalysisRunner) {
  const [state, setState] = useState<DetachableAnalysisState>({ running: false, done: 0, total: 0, path: undefined, summary: undefined });
  const runRef = useRef(run);
  const queueRef = useRef<string[]>([]);
  const currentRef = useRef<string | undefined>(undefined);
  const runningRef = useRef(false);
  const stoppedRef = useRef(false);
  const aliveRef = useRef(true);

  // The runner closes over the file details, which keep arriving; the loop must call the latest one.
  useEffect(() => { runRef.current = run; }, [run]);
  // React mounts an effect twice in development (StrictMode): the cleanup of the first mount must not
  // leave the hook flagged as unmounted for good, or every later update is dropped and the header
  // stays on "Checking 0 of N" after the batch finished.
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const start = useCallback((paths: readonly string[]) => {
    if (runningRef.current) return;
    const queue = [...new Set(paths)];
    if (queue.length === 0) return;

    runningRef.current = true;
    stoppedRef.current = false;
    queueRef.current = queue;
    const total = queue.length;
    const phases: PatchDeepCheckPhase[] = [];
    let done = 0;
    setState({ running: true, done, total, path: queue[0], summary: undefined });

    const runQueue = async () => {
      while (queueRef.current.length > 0 && !stoppedRef.current) {
        const path = queueRef.current.shift();
        if (path == null) break;
        currentRef.current = path;
        if (aliveRef.current) setState({ running: true, done, total, path, summary: undefined });
        try {
          const phase = await runRef.current(path);
          if (phase != null) phases.push(phase);
        } catch (error) {
          console.error('A deep check of the batch failed to run', error);
        }
        currentRef.current = undefined;
        done += 1;
        if (aliveRef.current) setState({ running: true, done, total, path: undefined, summary: undefined });
      }
      runningRef.current = false;
      if (aliveRef.current) setState({ running: false, done, total: done, path: undefined, summary: summarizePatchCheckOutcomes(phases) });
    };
    runQueue().catch((error: unknown) => {
      console.error('The deep check batch stopped unexpectedly', error);
    });
  }, []);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    queueRef.current = [];
    const path = currentRef.current;
    if (path == null) return;
    mainApi.patchCancelDeepCheck({ path }).catch((error: unknown) => {
      console.error('Failed to cancel a deep check', error);
    });
  }, []);

  const clearSummary = useCallback(() => {
    setState((previous) => ({ ...previous, summary: undefined }));
  }, []);

  return { ...state, start, stop, clearSummary };
}
