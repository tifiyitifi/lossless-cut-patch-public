import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import {
  finishPatchExportRun, isPatchExportRunRunning, setPatchExportRunProgress, startPatchExportRun,
} from '../../../../common/features/patchExportRun';
import type { PatchExportRun, PatchExportRunPhase } from '../../../../common/features/patchExportRun';

/**
The export that is running in this window (fork-owned).

It is deliberately *not* the shared `working` slot of `useLoading`: that one is a single boolean
that any operation may clear, and the in-flight export outlives them (the cutter keeps going).
Its own ref is what the guards (`isWorking`, the cut-list lock) and the overlay read.
*/
export interface PatchExportRunValue {
  /** The current run, `undefined` when nothing was exported in this session yet. */
  run: PatchExportRun | undefined;
  /** The run as of *now*, for callbacks that are created before a run starts. */
  isRunning: () => boolean;
  begin: () => void;
  setProgress: (progress: number) => void;
  finish: (phase: Exclude<PatchExportRunPhase, 'running'>) => void;
  /** Forget the run (it never reached a final phase). */
  clear: () => void;
}

const PatchExportRunContext = createContext<PatchExportRunValue | undefined>(undefined);

/**
Owns the run state for the whole patch shell.

A context instead of a hook per caller: the export starts in the cutting window's `App`, while
the overlay is rendered next to it and other layers (the finish dialog, the results windows) ask
whether an export is running.
*/
export function PatchExportRunProvider({ children }: { children: ReactNode }) {
  const [run, setRun] = useState<PatchExportRun | undefined>();
  const runRef = useRef<PatchExportRun | undefined>(undefined);

  const apply = useCallback((next: PatchExportRun | undefined) => {
    runRef.current = next;
    setRun(next);
  }, []);

  const begin = useCallback(() => {
    apply(startPatchExportRun());
  }, [apply]);

  const setProgress = useCallback((progress: number) => {
    const { current } = runRef;
    if (current == null) return;
    apply(setPatchExportRunProgress(current, progress));
  }, [apply]);

  const finish = useCallback((phase: Exclude<PatchExportRunPhase, 'running'>) => {
    const { current } = runRef;
    if (current == null) return;
    apply(finishPatchExportRun(current, phase));
  }, [apply]);

  const clear = useCallback(() => apply(undefined), [apply]);

  const value = useMemo<PatchExportRunValue>(() => ({
    run,
    isRunning: () => isPatchExportRunRunning(runRef.current),
    begin,
    setProgress,
    finish,
    clear,
  }), [begin, clear, finish, run, setProgress]);

  return <PatchExportRunContext.Provider value={value}>{children}</PatchExportRunContext.Provider>;
}

/** The export run of the current patch shell. `undefined` outside it (the results windows). */
export function usePatchExportRun(): PatchExportRunValue | undefined {
  return useContext(PatchExportRunContext);
}
