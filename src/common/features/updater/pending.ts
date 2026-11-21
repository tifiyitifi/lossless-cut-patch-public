// Fork-only: the note the app leaves behind before it hands its files to the updater.
//
// It exists because the hand-over is the one update step nobody can watch: the app closes, a script
// it does not control either replaces the program files or does not, and the next launch is the only
// place that can tell the two apart. The record is written *before* the updater starts (a record
// written afterwards would never exist) and is consumed exactly once, so a stale note can never
// greet the user again.

import semver from 'semver';

/** Name of the hand-off record, inside the updates folder. */
export const pendingUpdateFileName = 'pending.json';

export interface PendingUpdate {
  /** The version that handed over. */
  from: string;
  /** The version being installed. */
  to: string;
  /** The package that was handed over; kept for a manual retry when the update did not land. */
  packagePath: string;
  /** ISO timestamp, for the log only. */
  startedAt: string;
}

/** Parses one record, or undefined when the payload is not one. */
export function parsePendingUpdate(value: unknown): PendingUpdate | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { from, to, packagePath, startedAt } = value as Record<string, unknown>;
  if (typeof to !== 'string' || to.trim() === '') return undefined;
  return {
    from: typeof from === 'string' ? from : '',
    to: to.trim(),
    packagePath: typeof packagePath === 'string' ? packagePath : '',
    startedAt: typeof startedAt === 'string' ? startedAt : '',
  };
}

// What became of the hand-off, now that the app is running again.
//
// `applied` means the running build is the version that was handed over. A running build *newer*
// than the record also counts: the user may have installed the next release by hand in between, and
// reporting that as "the last update did not finish" would be wrong. Anything older (including an
// unreadable version) reads as not applied.
export function pendingUpdateOutcome({ runningVersion, pending }: {
  runningVersion: string;
  pending: PendingUpdate;
}): 'applied' | 'notApplied' {
  const running = semver.valid(runningVersion.trim());
  const target = semver.valid(pending.to);
  if (running == null || target == null) return 'notApplied';
  return semver.gte(running, target) ? 'applied' : 'notApplied';
}
