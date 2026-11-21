import type { PatchOverviewSource } from '../patchResultsOverview/groupResults.js';

/**
Which detached sources may be deleted for good (fork-owned, pure).

The check panel only offers deletion for what the app itself has proved it finished: a source that
sits in `detached_src_media` (the waiting-for-deletion folder) *and* still has a kept result on disk.
The two results folders are the kept ones (`finished_clips`, `finished_merged`); a parked result is
already waiting for its own deletion, so it never justifies deleting the source, and a result the
scan only knows from the ledger but could not find on disk is no proof at all.

The user may widen that set in the panel's deletion settings: a source that only carries one of the
extra reasons below can be deleted too once the user ticks that kind. Nothing is widened by default,
and the widening is still limited to sources of `detached_src_media` - the main process checks the
same fresh report before it unlinks anything (see `main/features/patchDeletable/delete.ts`).
*/

/** Why a row cannot be deleted: the reason the panel shows instead of a checkbox. */
export type PatchDetachableSourceReason =
  /** May be deleted: a detached source with a kept result on disk. */
  | 'deletable'
  /** A detached source whose only results are already parked for deletion. */
  | 'parked-only'
  /** A detached source whose recorded results are not on disk anymore. */
  | 'results-missing'
  /** A detached source that produced nothing. */
  | 'no-results'
  /** Not in `detached_src_media` (`finished_src_media`, `finished_skip_src`, or a gone source). */
  | 'not-detached';

/**
The reasons the deletion settings may turn into deletable ones (fork-owned).

`deletable` is already deletable, and `not-detached` never reaches the check panel (its report only
holds `detached_src_media`), so neither is offered as an option. `parked-only` is still a detached
source; only its results already wait for deletion.
*/
export type PatchDetachExtraDeletableReason = Exclude<PatchDetachableSourceReason, 'deletable' | 'not-detached'>;

/** The extra reasons, in the order the settings dialog lists them. */
export const patchDetachExtraDeletableReasons = [
  'no-results',
  'results-missing',
  'parked-only',
] as const satisfies readonly PatchDetachExtraDeletableReason[];

/**
Why this source may (or may not) be deleted.

`clips` / `merged` only ever hold files the scan found in the folder, so a kept result is an existing
file by construction; `missing` is the ledger's record of results that are gone.
*/
export function getPatchDetachableSourceReason(
  source: Pick<PatchOverviewSource, 'folder' | 'clips' | 'merged' | 'parkedClips' | 'parkedMerged' | 'missing'>,
): PatchDetachableSourceReason {
  if (source.folder !== 'detachedSrc') return 'not-detached';
  if (source.clips.length + source.merged.length > 0) return 'deletable';
  if (source.parkedClips.length + source.parkedMerged.length > 0) return 'parked-only';
  if (source.missing.length > 0) return 'results-missing';
  return 'no-results';
}

/** May this source be deleted for good? */
export function isPatchDetachableSource(
  source: Parameters<typeof getPatchDetachableSourceReason>[0],
): boolean {
  return getPatchDetachableSourceReason(source) === 'deletable';
}

/**
May this source be deleted, with the extra kinds the user allowed?

With no `extraReasons` (the default) this is exactly `isPatchDetachableSource`. A reason the user
allowed counts, but a source of another folder never does (`not-detached` is not an extra reason).
*/
export function isPatchDetachSourceDeletable(
  source: Parameters<typeof getPatchDetachableSourceReason>[0],
  extraReasons: readonly PatchDetachExtraDeletableReason[] = [],
): boolean {
  const reason = getPatchDetachableSourceReason(source);
  if (reason === 'deletable') return true;
  return (patchDetachExtraDeletableReasons as readonly string[]).includes(reason)
    && extraReasons.includes(reason as PatchDetachExtraDeletableReason);
}

/**
The extra deletion reasons stored in the patch settings.

Anything that is not one of the known reasons is dropped, duplicates are collapsed and the result is
returned in the dialog's order, so a hand-edited `patch-config.json` can never invent a reason or
reshuffle the saved value.
*/
export function parsePatchDetachExtraDeletableReasons(value: unknown): PatchDetachExtraDeletableReason[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<PatchDetachExtraDeletableReason>(patchDetachExtraDeletableReasons);
  return patchDetachExtraDeletableReasons.filter((reason) => allowed.has(reason) && value.includes(reason));
}

/** Is "Delete all" (nothing selected) also allowed to remove the sources of the extra reasons? */
export function parsePatchDetachAllIncludesExtra(value: unknown): boolean {
  return value === true;
}
