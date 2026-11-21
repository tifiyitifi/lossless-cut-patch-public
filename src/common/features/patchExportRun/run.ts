/**
The export that is running in this window (pure, fork-owned).

The in-flight export is a snapshot: the cut list is captured when the user confirms, and every
file, name and manifest record is planned from it (see the comment on `onExportConfirm`). This
module only describes the run for the UI: whether an export is in flight and how far it got.

The renderer keeps one of these in a ref: unlike the shared `working` slot of `useLoading`, it is
not cleared by an unrelated operation (loading a file), so the overlay and the guards survive.
*/

export type PatchExportRunPhase = 'running' | 'done' | 'failed';

export interface PatchExportRun {
  /** The overall progress the cutter reported, 0..1; `undefined` until the first report. */
  progress: number | undefined;
  phase: PatchExportRunPhase;
}

/** Start a run. */
export function startPatchExportRun(): PatchExportRun {
  return { progress: undefined, phase: 'running' };
}

/** Is the export still cutting? Only a running export locks the cut list and the file switch. */
export function isPatchExportRunRunning(run: PatchExportRun | undefined): boolean {
  return run?.phase === 'running';
}

/** One progress report from the cutter. Ignored once the run has finished. */
export function setPatchExportRunProgress(run: PatchExportRun, progress: number): PatchExportRun {
  if ((run.phase !== 'running') || !Number.isFinite(progress)) return run;
  return { ...run, progress: Math.min(Math.max(progress, 0), 1) };
}

/** Move the run to its final phase. */
export function finishPatchExportRun(run: PatchExportRun, phase: Exclude<PatchExportRunPhase, 'running'>): PatchExportRun {
  return { ...run, phase };
}
