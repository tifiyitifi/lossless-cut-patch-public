import { getPathFileName } from '../patchFinish/paths.js';
import type { PatchOverview, PatchOverviewPairing, PatchOverviewResultRef, PatchOverviewWarning } from '../patchResultsOverview/groupResults.js';
import compareStrings from '../patchExport/stringOrder.js';

import { getPatchDetachableSourceReason, isPatchDetachSourceDeletable } from './deletable.js';
import type { PatchDetachExtraDeletableReason, PatchDetachableSourceReason } from './deletable.js';

/**
The rows of the detached-source check (fork-owned, pure).

The check panel shows only `detached_src_media`: those are the sources waiting for deletion, and the
only folder whose sources the app may delete for good. Everything else stays in the work-folders
list, where the user handles it by hand.

Each row carries the reason it may (or may not) be deleted, the results it produced and the results
the ledger knows but could not find. The reason is computed by
`getPatchDetachableSourceReason`, so the panel never decides on its own. `deletable` follows the
reasons the user allowed in the deletion settings; with none allowed it is exactly "has a kept
result on disk".
*/

export interface PatchDetachableSourceRow {
  path: string;
  /** Why the row is (not) deletable; the panel shows it as the row's state. */
  reason: PatchDetachableSourceReason;
  deletable: boolean;
  /** Kept cut results on disk. */
  clips: PatchOverviewResultRef[];
  /** Kept merged results on disk. */
  merged: PatchOverviewResultRef[];
  /** Results already parked for their own deletion. */
  parked: PatchOverviewResultRef[];
  /** Result paths the ledger records that are not on disk anymore. */
  missing: string[];
  pairing: PatchOverviewPairing;
}

export interface PatchDetachableTotals {
  /** Sources in `detached_src_media`. */
  sources: number;
  /** Sources that may be deleted (kept result on disk). */
  deletable: number;
  /** Kept cut + merged results of those sources. */
  results: number;
}

export interface PatchDetachableReport {
  workRoot: string | undefined;
  detachedSrcMediaDir: string | undefined;
  rows: PatchDetachableSourceRow[];
  totals: PatchDetachableTotals;
  warnings: PatchOverviewWarning[];
}

/**
The rows of the check panel, built from a work-area overview.

`extraDeletableReasons` are the kinds the user allowed in the deletion settings; with none (the
default) only a source with a kept result on disk is deletable.
*/
export function buildPatchDetachableReport(
  overview: PatchOverview,
  extraDeletableReasons: readonly PatchDetachExtraDeletableReason[] = [],
): PatchDetachableReport {
  const rows = overview.sources
    .filter((source) => source.folder === 'detachedSrc')
    .map((source): PatchDetachableSourceRow => {
      const reason = getPatchDetachableSourceReason(source);
      return {
        path: source.path,
        reason,
        deletable: isPatchDetachSourceDeletable(source, extraDeletableReasons),
        clips: source.clips,
        merged: source.merged,
        parked: [...source.parkedClips, ...source.parkedMerged],
        missing: source.missing,
        pairing: source.pairing,
      };
    })
    .sort((a, b) => compareStrings(getPathFileName(a.path), getPathFileName(b.path)));

  return {
    workRoot: overview.workRoot,
    detachedSrcMediaDir: overview.dirs.detachedSrcMediaDir,
    rows,
    totals: {
      sources: rows.length,
      deletable: rows.filter((row) => row.deletable).length,
      results: rows.reduce((total, row) => total + row.clips.length + row.merged.length, 0),
    },
    warnings: [...overview.warnings],
  };
}
