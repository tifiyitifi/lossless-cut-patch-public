import type { PatchDetachGridItemKind } from './grid.js';
import type { PatchDeepCheckPhase } from './health.js';

/**
What a column header says while a full decode check runs, and what the last one found (fork-owned, pure).

The check window has one batch at a time and two columns. A batch belongs to the column whose button
started it - that is the only column that may show progress or offer "stop", because a progress number
under the other column's button would claim a check of files that are not being checked. The other
column is blocked until the run ends, so it never starts a silent second batch.

The last finished batch is summarized with the outcomes the queue collected: a file that was stopped,
a file whose check could not start and a file that failed are three different things, and the panel
shows each count separately instead of folding them into "failed".
*/

/** What one column's check button shows right now. */
export type PatchCheckHeaderState =
  /** No batch runs: the column shows its normal action. */
  | { readonly state: 'idle' }
  /** This column owns the running batch; `percent` is the file being decoded. */
  | { readonly state: 'running'; readonly percent: number | undefined }
  /** Another column owns the running batch, so this column waits. */
  | { readonly state: 'blocked' };

/** The whole percentage the header shows, or `undefined` while the duration (and with it the ratio) is unknown. */
export function getPatchCheckPercent(ratio: number | undefined): number | undefined {
  if (ratio == null || !Number.isFinite(ratio)) return undefined;
  return Math.min(100, Math.max(0, Math.round(ratio * 100)));
}

/** Which of the two column buttons shows the batch, and with which percentage. */
export function describePatchCheckHeader({ ownerKind, kind, running, ratio }: {
  /** The column whose button started the batch; `undefined` when nothing runs. */
  ownerKind: PatchDetachGridItemKind | undefined;
  /** The column of the button that asks. */
  kind: PatchDetachGridItemKind;
  running: boolean;
  /** The decode progress of the file being checked now (0..1). */
  ratio?: number | undefined;
}): PatchCheckHeaderState {
  if (!running) return { state: 'idle' };
  if (ownerKind !== kind) return { state: 'blocked' };
  return { state: 'running', percent: getPatchCheckPercent(ratio) };
}

/** What the last finished batch did, counted by outcome. */
export interface PatchCheckSummary {
  /** Every file the batch actually ran; `idle` / `running` phases are not counted. */
  readonly total: number;
  /** Every packet decoded. */
  readonly passed: number;
  /** FFmpeg stopped on a damaged packet. */
  readonly failed: number;
  /** The user (or the closing window) stopped it. */
  readonly stopped: number;
  /** The check could not even start (no FFmpeg binary, the file is locked, ...). */
  readonly unavailable: number;
}

/** Count the outcomes of one batch; a file the batch never got a phase for is not counted at all. */
export function summarizePatchCheckOutcomes(phases: readonly PatchDeepCheckPhase[]): PatchCheckSummary {
  let passed = 0;
  let failed = 0;
  let stopped = 0;
  let unavailable = 0;
  for (const phase of phases) {
    switch (phase) {
      case 'ok': { passed += 1; break; }
      case 'failed': { failed += 1; break; }
      case 'canceled': { stopped += 1; break; }
      case 'unavailable': { unavailable += 1; break; }
      default: { break; }
    }
  }
  return { total: passed + failed + stopped + unavailable, passed, failed, stopped, unavailable };
}
