/**
What a permanent delete did to each file (fork-owned, pure).

The main process deletes the selected sources one at a time and never replaces a failed delete with a
second attempt or a silent success. The renderer only reports what came back, so the vocabulary is
shared and the counts are computed here instead of in a component.
*/

export type PatchDeleteStatus =
  /** Gone from disk. */
  | 'deleted'
  /** Windows still holds the file (a player, a preview, an antivirus scan); nothing was deleted. */
  | 'locked'
  /** The file is open in one of this app's windows; the user has to close it first. */
  | 'open-elsewhere'
  /** Re-validated at delete time: not a detached source with a kept result any more. */
  | 'not-deletable'
  /** Already gone before this run (another window, or an earlier attempt). */
  | 'missing'
  /** Anything else (permissions, a path that is no longer a file, ...). */
  | 'failed';

export interface PatchDeleteOutcome {
  path: string;
  status: PatchDeleteStatus;
  /** The system message for `failed` / a short reason for the other statuses. */
  detail?: string | undefined;
}

export interface PatchDeleteSummary {
  deleted: number;
  /** Everything that did not end up deleted. */
  failed: number;
}

/** Count what the run deleted and what it did not. */
export function summarizePatchDeleteOutcomes(outcomes: readonly PatchDeleteOutcome[]): PatchDeleteSummary {
  let deleted = 0;
  for (const outcome of outcomes) if (outcome.status === 'deleted') deleted += 1;
  return { deleted, failed: outcomes.length - deleted };
}
