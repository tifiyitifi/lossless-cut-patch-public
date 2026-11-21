import type { PatchNameContext } from '../patchPlayer/playerMode.js';
import type { PatchExportFileRecord, PatchManifestMergedRecord, PatchManifestSegmentRecord } from './manifest.js';
import { normalizeManifestPath } from './manifest.js';
import { isSamePatchTime, patchTimeKey } from './time.js';
import type { PatchTailMode } from '../patchExportPolicy/tailEnd.js';

/** One currently selected segment, as the incremental export sees it. */
export interface PatchExportSegmentInput {
  segId: string;
  start: number;
  end: number;
  label?: string | undefined;
  /** The path the current name template produces. */
  path: string;
  nameContext?: PatchNameContext | undefined;
  /** The source segment's color, so the merged result reuses the same scheme. */
  segColorIndex?: number | undefined;
  /** How the last result reaches its end (fork-owned, part of the result's identity). */
  tail?: PatchTailMode | undefined;
}

/** What to do with one selected segment. */
export type PatchExportDecision =
  /** The result on disk is already correct; open it as-is. */
  | { index: number, kind: 'reuse' }
  /** The result content is correct but its name changed; rename it on disk. */
  | { index: number, kind: 'rename', from: string }
  /** Cut it (new segment, or the content changed). */
  | { index: number, kind: 'export', previous: PatchManifestSegmentRecord | undefined }
  /** Keep the previous result: the new name is taken by a file the app does not own. */
  | { index: number, kind: 'blocked', previous: PatchManifestSegmentRecord }
  /**
  Nothing is written and there is no previous result to keep: the wanted name is held by a file
  the app does not own, and overwriting is disabled. The caller reports it instead of claiming
  the foreign file as a result.
  */
  | { index: number, kind: 'skipped' };

/**
The manifest record one segment of this export was matched to (fork-owned).

The record is keyed by the segment identity, but a reopened project may carry another identity
(an older project file has none at all): then the record is found by what the result is - the
same path with the same times. A result whose identity survived is never matched to another
record.
*/
export function findPreviousSegmentMatch({ segments, segment, caseInsensitivePaths }: {
  /** The records of the source file. */
  segments: Readonly<Record<string, PatchManifestSegmentRecord>> | undefined,
  /** One selected segment of this export. */
  segment: PatchExportSegmentInput,
  /** Does the file system treat paths that differ only in case as the same file? */
  caseInsensitivePaths: boolean,
}): { segId: string, record: PatchManifestSegmentRecord } | undefined {
  const byId = segments?.[segment.segId];
  if (byId != null) return { segId: segment.segId, record: byId };
  if (segments == null) return undefined;
  const samePath = (a: string, b: string) => normalizeManifestPath(a, { caseInsensitive: caseInsensitivePaths }) === normalizeManifestPath(b, { caseInsensitive: caseInsensitivePaths });
  for (const [segId, candidate] of Object.entries(segments)) {
    if (isSamePatchTime(candidate.start, segment.start) && isSamePatchTime(candidate.end, segment.end) && samePath(candidate.path, segment.path)) {
      return { segId, record: candidate };
    }
  }
  return undefined;
}

export interface PatchExportPlan {
  decisions: PatchExportDecision[];
  /** Subset of `decisions`, in order; pass these to the cutter. */
  exports: { index: number, previous: PatchManifestSegmentRecord | undefined }[];
  renames: { from: string, to: string }[];
  /**
  The manifest key each segment was matched to, in segment order (`undefined` when the segment
  has no record). A key that differs from the segment's own identity is an adoption: a reopened
  project carries another identity, so the record moves to the new one.
  */
  previousKeys: (string | undefined)[];
  /** Old result files to delete after a successful export (never a target of this export). */
  obsoletePaths: string[];
  /**
  The names the renames free up. They are free before the cuts and the merge are written, so
  another result (the merged one) may take one of them.
  */
  vacatedPaths: string[];
  /**
  Paths the cutter may replace even when "overwrite output" is disabled: the paths this export
  writes to (they are the app's own results or the names its renames free up) and the names the
  renames free up. A path that another selected segment keeps (reuse / blocked) is never
  included.
  */
  ownedPaths: string[];
}

/** A result whose content did not change and that only needs a new name. */
interface RenameCandidate {
  /** Index of the segment in the export. */
  index: number;
  /** The path the result has now. */
  from: string;
  /** The path the result should have. */
  to: string;
  /** The candidate whose current result holds the wanted name (if it is one of ours). */
  holder?: RenameCandidate | undefined;
}

/**
The candidates that can be renamed instead of being cut again.

A result may take a name that is free, or a name that is held by another result of the same
export - as long as that result moves as well. The results of a cycle (A wants the name of B and
B wants the name of A) all move at the same time, so they are renamed as a whole.
*/
function resolveRenamable(candidates: readonly RenameCandidate[], exists: (path: string) => boolean): Set<number> {
  const renamable = new Set<number>();

  // A free name can be taken right away.
  for (const candidate of candidates) {
    if (!exists(candidate.to)) renamable.add(candidate.index);
  }

  // A cycle of results swaps names through a temporary name, so every member of it moves.
  for (const candidate of candidates) {
    const seen = new Set<number>();
    let current: RenameCandidate | undefined = candidate;
    while (current != null) {
      if (seen.has(current.index)) {
        const cycle = new Set<number>();
        let member: RenameCandidate | undefined = current;
        do {
          cycle.add(member.index);
          member = member.holder;
        } while (member != null && member !== current);
        for (const index of cycle) renamable.add(index);
        break;
      }
      seen.add(current.index);
      current = current.holder;
    }
  }

  // A result may take the name of a result that moves.
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of candidates) {
      if (!(!renamable.has(candidate.index) && candidate.holder != null && renamable.has(candidate.holder.index))) {
        continue;
      }

      renamable.add(candidate.index);
      changed = true;
    }
  }

  return renamable;
}

/**
A temporary name for a result that has to give its name to another result first.

`undefined` when every name is taken: the caller then leaves the results where they are, instead
of renaming one of them over a file that is already there.

The name must not be a path of the batch either: a result of the batch may have that name (a
template that ends with `.llctmp`), and the rename would overwrite it. `reserved` holds the paths
of the batch (and the temporary names that were already handed out).
*/
function temporaryResultPath(resultPath: string, exists: (path: string) => boolean, reserved: (path: string) => boolean): string | undefined {
  // The search is bounded: a leftover temporary file must not stall the export. When every name is
  // taken, the renames are given up and the results keep their old names.
  const maxAttempts = 100;
  let candidate = `${resultPath}.llctmp`;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (!exists(candidate) && !reserved(candidate)) return candidate;
    candidate = `${resultPath}.llctmp${attempt + 1}`;
  }
  return undefined;
}

/**
The signature a result of an older manifest may claim.

The results of a manifest that was written before they had a signature of their own have none.
They can inherit the signature of the file, but only when it is the signature of the export that
is running now: the signature of the file is only advanced when it covers *every* tracked result
(see `applyExportRecordPatch`), so it is the signature their content was produced with.
*/
export function resolveInheritedSignature({ record, signature }: {
  /** The record of the source file (it holds the file's signature). */
  record: PatchExportFileRecord | undefined;
  /** The signature of the export that is running now. */
  signature: string;
}): string | undefined {
  return record?.signature === signature ? signature : undefined;
}

/**
Classify the selected segments into reuse / rename / export / blocked.

Pure: file existence is injected, so the decision table is unit-testable.
*/
export function planIncrementalExport({ segments, record, signature, force, overwriteAllowed, exists, caseInsensitivePaths }: {
  segments: readonly PatchExportSegmentInput[];
  record: PatchExportFileRecord | undefined;
  signature: string;
  /** Force: ignore the manifest for reuse (still updates it afterwards). */
  force: boolean;
  /** The user's overwrite setting; without it, files the app does not own are never overwritten. */
  overwriteAllowed: boolean;
  exists: (path: string) => boolean;
  /** Does the file system treat paths that differ only in case as the same file? */
  caseInsensitivePaths: boolean;
}): PatchExportPlan {
  const decisions: PatchExportDecision[] = [];
  const exports: PatchExportPlan['exports'] = [];
  const renames: PatchExportPlan['renames'] = [];
  const obsolete = new Map<string, string>();

  /**
  The key of a path: the same file has the same key, however it is spelled.

  The file system decides what the same file is (`C:\a\b` is `C:/a/b`, and on Windows/macOS
  `A.mp4` is `a.mp4`), so the plan must compare the paths the same way: a result that is spelled
  differently is the same result, not a conflict.
  */
  const pathKey = (path: string) => normalizeManifestPath(path, { caseInsensitive: caseInsensitivePaths });
  const samePath = (a: string, b: string) => pathKey(a) === pathKey(b);

  const previousMatches = segments.map((segment) => findPreviousSegmentMatch({ segments: record?.segments, segment, caseInsensitivePaths }));
  const previousByIndex = previousMatches.map((match) => match?.record);
  const previousKeys = previousMatches.map((match) => match?.segId);

  // A result of an older manifest has no signature of its own and may inherit the file's one.
  const inheritedSignature = resolveInheritedSignature({ record, signature });
  const resultSignature = (previous: PatchManifestSegmentRecord | undefined) => previous?.signature ?? inheritedSignature;

  const isUnchanged = (segment: PatchExportSegmentInput, previous: PatchManifestSegmentRecord | undefined) => (
    previous != null
    && !force
    // The signature belongs to the result: a result that was cut with other parameters is not
    // current, even when the file record was updated by an export of other segments.
    && resultSignature(previous) === signature
    // The project file stores times with nanosecond precision, so a reopened project parses a
    // slightly different double. The times still name the same cut (see `time.ts`).
    && isSamePatchTime(previous.start, segment.start)
    && isSamePatchTime(previous.end, segment.end)
    // The tail rule changes the bytes of the last result, so a result cut with another rule is not
    // current even when its times are the same.
    && previous.tail === segment.tail
    && exists(previous.path)
  );

  const unchanged = segments.map((segment, index) => isUnchanged(segment, previousByIndex[index]));

  // The results whose content did not change only need a new name, so they can be renamed instead
  // of being cut again.
  const candidates: RenameCandidate[] = [];
  segments.forEach((segment, index) => {
    const previous = previousByIndex[index];
    if (previous == null || !unchanged[index] || samePath(previous.path, segment.path)) return;
    candidates.push({ index, from: previous.path, to: segment.path });
  });

  // The files that stay where they are: a segment that reuses its result (the name did not change)
  // keeps the file it has, so no other result may move it.
  const reusedPaths = new Set<string>();
  segments.forEach((segment, index) => {
    const previous = previousByIndex[index];
    if (previous == null || !unchanged[index]) return;
    if (samePath(previous.path, segment.path)) reusedPaths.add(pathKey(previous.path));
  });

  // The result that holds a wanted name is the one whose current path is that name. More than one
  // result may have the same current path (two records for the same file), so the holders of a
  // name are collected: the name then belongs to all of them.
  const candidatesByFrom = new Map<string, RenameCandidate[]>();
  for (const candidate of candidates) {
    const key = pathKey(candidate.from);
    const holders = candidatesByFrom.get(key);
    if (holders == null) candidatesByFrom.set(key, [candidate]);
    else holders.push(candidate);
  }
  for (const candidate of candidates) {
    const [holder] = candidatesByFrom.get(pathKey(candidate.to)) ?? [];
    if (holder != null) candidate.holder = holder;
  }

  let renamable = resolveRenamable(candidates, exists);

  // Two results that share a file cannot be renamed: the file is one, so moving it for one of them
  // would take it away from the other. A result that wants the name of such a file keeps its old
  // name as well, because the file stays where it is.
  const sharedFile = new Set<number>();
  for (const holders of candidatesByFrom.values()) {
    if (holders.length > 1) holders.forEach((holder) => sharedFile.add(holder.index));
  }
  // A result that reuses its file keeps it there: renaming it would take the file away from the
  // result that reuses it (the merge would read a file that is not there any more).
  for (const candidate of candidates) {
    if (reusedPaths.has(pathKey(candidate.from))) sharedFile.add(candidate.index);
  }
  for (const candidate of candidates) {
    if (renamable.has(candidate.index)) {
      if (sharedFile.has(candidate.index)) {
        renamable.delete(candidate.index);
      } else {
        // The holders may form a cycle (two results that swap names), so the walk keeps track of
        // where it has been.
        const seen = new Set<number>();
        let { holder } = candidate;
        while (holder != null && !seen.has(holder.index)) {
          seen.add(holder.index);
          if (sharedFile.has(holder.index)) {
            renamable.delete(candidate.index);
            break;
          }
          holder = holder.holder;
        }
      }
    }
  }

  // The renames are executed in order. When a result has to give its name to another result, both
  // go through a temporary name first, so the swap never needs a new cut. The temporary names must
  // be free: when they are not, the renames are given up and every result keeps its old name.
  let temporaryPaths: string[] | undefined;
  let toRename = candidates.filter((candidate) => renamable.has(candidate.index));
  if (toRename.some((candidate) => candidate.holder != null && renamable.has(candidate.holder.index))) {
    // The temporary names must not be a path of this batch: a result of the batch may have that
    // name, and the rename would overwrite it.
    const reservedPaths = new Set<string>();
    for (const candidate of toRename) {
      reservedPaths.add(pathKey(candidate.from));
      reservedPaths.add(pathKey(candidate.to));
    }
    const isReserved = (path: string) => reservedPaths.has(pathKey(path));

    const paths: string[] = [];
    let allFound = true;
    for (const candidate of toRename) {
      const path = temporaryResultPath(candidate.from, exists, isReserved);
      if (path == null) {
        allFound = false;
        break;
      }
      reservedPaths.add(pathKey(path));
      paths.push(path);
    }

    if (allFound) {
      temporaryPaths = paths;
    } else {
      renamable = new Set<number>();
      toRename = [];
    }
  }

  // Names the renames free up. The renames run before the cuts, so a new result may take them.
  const vacatedPaths = toRename.map((candidate) => candidate.from);
  const vacated = new Set(vacatedPaths.map((path) => pathKey(path)));

  // Preliminary decisions. Which names are really free depends on what every other selected
  // segment does, so the collisions are resolved afterwards.
  segments.forEach((segment, index) => {
    const previous = previousByIndex[index];

    if (previous != null && unchanged[index]) {
      if (samePath(previous.path, segment.path)) {
        decisions.push({ index, kind: 'reuse' });
        return;
      }

      // The content is right and the name can be taken: rename the file, do not cut it again.
      if (renamable.has(index)) {
        decisions.push({ index, kind: 'rename', from: previous.path });
        return;
      }

      // The new name is held by a file that stays where it is; keep the result under its old name.
      if (!overwriteAllowed) {
        decisions.push({ index, kind: 'blocked', previous });
        return;
      }

      // The user allowed overwriting the file that holds the name.
      decisions.push({ index, kind: 'export', previous });
      return;
    }

    // A cut is needed: a new segment, or its content changed (times or source/export settings).
    // The name is free when this segment's own old result holds it, or when a rename frees it
    // before the cuts start. A foreign file may only be replaced with the user's overwrite setting.
    const replacesOwnResult = previous != null && samePath(previous.path, segment.path);
    const nameIsFree = !exists(segment.path) || replacesOwnResult || vacated.has(pathKey(segment.path));
    if (!nameIsFree && !overwriteAllowed) {
      if (previous != null) decisions.push({ index, kind: 'blocked', previous });
      else decisions.push({ index, kind: 'skipped' });
      return;
    }

    decisions.push({ index, kind: 'export', previous });
  });

  // A result that stays (reuse, blocked, rename destination) must not be written over - not even
  // when overwriting is enabled - and two fresh cuts cannot share a name. Keep the first cut and
  // keep/skip the others. (The caller also refuses duplicate names before the cut.)
  // The decisions depend on each other: a result that keeps its old name occupies a name another
  // result wants, so the collisions are resolved until nothing changes any more (a chain of three
  // results needs three rounds).
  let changed = true;
  while (changed) {
    changed = false;
    const staying = new Set<string>();
    for (const decision of decisions) {
      if (decision.kind === 'reuse' || decision.kind === 'rename') staying.add(pathKey(segments[decision.index]!.path));
      else if (decision.kind === 'blocked') staying.add(pathKey(decision.previous.path));
    }

    const targets = new Set<string>();
    for (const [index, decision] of decisions.entries()) {
      if (!(decision.kind === 'export')) {
        continue;
      }

      const target = segments[index]!.path;
      if (!staying.has(pathKey(target)) && !targets.has(pathKey(target))) {
        targets.add(pathKey(target));
      } else {
        // Do not keep a result under a name another fresh cut already writes to, and not under a
        // name another result keeps either: the two results would share one file. A name the
        // renames free up is not a name to keep either: the file moves away.
        const { previous } = decision;
        const previousKey = previous != null ? pathKey(previous.path) : undefined;
        const canKeepPrevious = previous != null && previousKey != null
          && !targets.has(previousKey) && !staying.has(previousKey) && !vacated.has(previousKey);
        decisions[index] = canKeepPrevious && previous != null
          ? { index, kind: 'blocked', previous }
          : { index, kind: 'skipped' };
        changed = true;
      }
    }
  }

  // The paths the results occupy after this export: nothing else may be written over them.
  const stayingPaths = new Set<string>();
  for (const decision of decisions) {
    switch (decision.kind) {
      case 'reuse':
      case 'rename': {
        stayingPaths.add(pathKey(segments[decision.index]!.path));
        break;
      }
      case 'blocked': {
        stayingPaths.add(pathKey(decision.previous.path));
        break;
      }
      case 'export': {
        exports.push({ index: decision.index, previous: decision.previous });
        break;
      }
      default: {
        break;
      }
    }
  }

  for (const { index, previous } of exports) {
    // The old file is only obsolete when it is a *different* file than the new one: a result that
    // was only respelled (another case) is the file that was just written.
    if (previous != null && !samePath(previous.path, segments[index]!.path)) obsolete.set(pathKey(previous.path), previous.path);
  }
  // The renames are executed in order. When a result has to give its name to another result, both
  // go through a temporary name first, so the swap never needs a new cut.
  if (temporaryPaths != null) {
    toRename.forEach((candidate, i) => {
      renames.push({ from: candidate.from, to: temporaryPaths[i]! });
    });
    toRename.forEach((candidate, i) => {
      renames.push({ from: temporaryPaths[i]!, to: candidate.to });
    });
  } else {
    toRename.forEach((candidate) => {
      renames.push({ from: candidate.from, to: candidate.to });
    });
  }

  // A path that this export writes to must never also be deleted afterwards (e.g. two segments
  // swapping names): the new content would be removed right away. A path a result *keeps* must
  // not be deleted either: the file is still in use.
  const targets = new Set<string>();
  for (const entry of exports) targets.add(pathKey(segments[entry.index]!.path));
  for (const rename of renames) targets.add(pathKey(rename.to));

  // Only the old results this export replaces (plus the names it frees) may be overwritten without
  // the user's "overwrite output" setting. A result that stays is never in this set.
  const ownedPaths: string[] = [];
  const ownedKeys = new Set<string>();
  const addOwned = (path: string) => {
    const key = pathKey(path);
    if (stayingPaths.has(key) || ownedKeys.has(key)) return;
    ownedKeys.add(key);
    ownedPaths.push(path);
  };
  // The path the cutter writes to: it may replace the file it is the app's own result, even when
  // the file is spelled differently than the one the manifest knows.
  for (const { index } of exports) addOwned(segments[index]!.path);
  // The names the renames free up: a cut may take one of them.
  for (const path of vacatedPaths) addOwned(path);

  return {
    decisions,
    exports,
    renames,
    previousKeys,
    obsoletePaths: [...obsolete].filter(([key]) => !targets.has(key) && !stayingPaths.has(key)).map(([, path]) => path),
    vacatedPaths,
    ownedPaths,
  };
}

/**
May the merged file be replaced when there is no work area (base mode)?

Without the manifest there is no ownership information: the merged file may only be replaced
when the user allows it. The upstream decision is the same - the merge is skipped when the file
exists and "overwrite output" is off.
*/
export function mayReplaceMergedFile({ exists, overwriteAllowed, owned }: {
  /** Does the merged file already exist? */
  exists: boolean;
  /** The user's "overwrite output" setting. */
  overwriteAllowed: boolean;
  /** Is the merged file a result of this app (the manifest knows it)? */
  owned: boolean;
}) {
  return owned || overwriteAllowed || !exists;
}

/**
The clips the cutter may replace even when "overwrite output" is disabled (fork-owned).

The clips of a merged-only export are temporary files of this app: the merge is built from
them, so they have to be the current ones. A leftover clip of an earlier export (the same name,
but cut with other parameters) is rewritten instead of being merged as it is - the merge would
then not match the signature it is recorded with.

Only the tracked export (patch mode with a work area) does this: in base mode the clips are
ordinary output files and the user's setting decides.
*/
export function collectOwnedClipPaths({ mergedOnly, incremental, segments }: {
  /** Are the clips temporary (the merged file is the only result)? */
  mergedOnly: boolean;
  /** Is the export tracked (patch mode with a work area)? */
  incremental: boolean;
  /** The segments of this export (the clip of a segment is `segment.path`). */
  segments: readonly PatchExportSegmentInput[];
}): string[] {
  if (!mergedOnly || !incremental) return [];
  return segments.map((segment) => segment.path);
}

export interface PatchMergedPlan {
  /**
  `reuse` / `rename` keep the result, `regenerate` rebuilds it (the target is the previous merged
  file, is free, or the user allowed replacing it), `blocked` keeps the previous merged result
  because the new name is taken, and `skipped` means there is nothing to keep and nothing may be
  written: the caller must not claim the file for this export.
  */
  action: 'reuse' | 'rename' | 'regenerate' | 'blocked' | 'skipped';
  /** The file that will exist after the export (the old path when blocked, the taken path when skipped). */
  path: string;
  /** Old merged file to delete after a successful export. */
  obsoletePath?: string | undefined;
}

/** Decide whether the merged result can be reused, renamed, or has to be rebuilt. */
export function planMergedExport({ path, signature, previous, force, overwriteAllowed, exists, caseInsensitivePaths, freePaths }: {
  path: string;
  signature: string;
  previous: PatchManifestMergedRecord | undefined;
  force: boolean;
  overwriteAllowed: boolean;
  exists: (candidatePath: string) => boolean;
  /** Does the file system treat paths that differ only in case as the same file? */
  caseInsensitivePaths: boolean;
  /**
  The names that are free before the merge is written (the result renames free them up). A name
  that is still taken after the renames is not free.
  */
  freePaths?: readonly string[] | undefined;
}): PatchMergedPlan {
  const previousPath = previous?.path;
  const previousExists = previous != null && exists(previous.path);
  // The merged file is the same file when it is spelled differently (another case or separator).
  const samePath = (a: string, b: string) => normalizeManifestPath(a, { caseInsensitive: caseInsensitivePaths }) === normalizeManifestPath(b, { caseInsensitive: caseInsensitivePaths });
  const targetExists = exists(path) && (freePaths ?? []).every((freePath) => !samePath(freePath, path));
  const targetIsPrevious = previous != null && previousPath != null && samePath(previousPath, path);
  const obsoletePath = previousExists && previousPath != null && !samePath(previousPath, path) ? previousPath : undefined;

  if (previous == null || force || previous.signature !== signature || !previousExists) {
    // A rebuild would write to `path`. A file the app does not own may only be replaced when the
    // user asked for it; otherwise keep the old merged result (or report nothing for a first merge).
    if (targetExists && !targetIsPrevious && !overwriteAllowed) {
      return previousExists && previous != null
        ? { action: 'blocked', path: previous.path }
        : { action: 'skipped', path };
    }
    return { action: 'regenerate', path, obsoletePath: previousExists ? obsoletePath : undefined };
  }

  if (targetIsPrevious) return { action: 'reuse', path };

  if (!targetExists) return { action: 'rename', path };

  if (overwriteAllowed) return { action: 'regenerate', path, obsoletePath };

  return { action: 'blocked', path: previous.path };
}

/**
The name template a result is renamed with.

The template that is in use now wins: a result that is reused may have been cut with another
template (the two rendered the same path), and a later label rename must use the current one -
otherwise the file is renamed with a template the user does not use anymore.
*/
export function resolveResultNameContext({ current, previous }: {
  /** The template of the export that is running now. */
  current: PatchNameContext | undefined;
  /** The template the result was cut with. */
  previous: PatchNameContext | undefined;
}): PatchNameContext | undefined {
  return current ?? previous;
}

/**
The segment records after an export.

Records for segments that are not in this export are retained (the user asked to keep unchecked
results). A result that was skipped by the cutter is only recorded if we already tracked it: the
app must never adopt a file it did not create.

Every record carries the signature of the export its content comes from: a result that was not
cut again (it was reused, renamed or kept) keeps the signature of the export that cut it.
*/
export function mergeExportRecords({ previousSegments, segments, decisions, createdIndices, signature, previousKeys, caseInsensitivePaths = false }: {
  previousSegments: Readonly<Record<string, PatchManifestSegmentRecord>>;
  segments: readonly PatchExportSegmentInput[];
  decisions: readonly PatchExportDecision[];
  /** Input indexes whose export actually created the file (not skipped by the overwrite setting). */
  createdIndices: ReadonlySet<number>;
  /** The signature of this export (the content of every result it cuts). */
  signature: string;
  /**
  The manifest key each segment was matched to (see `PatchExportPlan`): a reopened project may
  carry another identity, so the record is adopted under the new one.
  */
  previousKeys?: readonly (string | undefined)[] | undefined;
  /** Does the file system treat paths that differ only in case as the same file? */
  caseInsensitivePaths?: boolean | undefined;
}): { records: Record<string, PatchManifestSegmentRecord>, removedSegIds: string[] } {
  const records: Record<string, PatchManifestSegmentRecord> = { ...previousSegments };

  for (const decision of decisions) {
    const segment = segments[decision.index]!;

    switch (decision.kind) {
      case 'reuse': {
        const adoptedKey = previousKeys?.[decision.index];
        const previous = (adoptedKey != null ? previousSegments[adoptedKey] : undefined) ?? records[segment.segId];
        // The name did not change, but the template that produced it may have (the two render the
        // same path). Keep the current variables, so a later label rename uses the template in use.
        if (previous != null) {
          records[segment.segId] = { ...previous, label: segment.label, nameContext: resolveResultNameContext({ current: segment.nameContext, previous: previous.nameContext }), signature, ...((segment.segColorIndex != null) && { segColorIndex: segment.segColorIndex }), ...((segment.tail !== undefined) && { tail: segment.tail }) };
        }
        break;
      }
      case 'rename': {
        const previous = records[segment.segId];
        records[segment.segId] = {
          start: segment.start,
          end: segment.end,
          label: segment.label,
          path: segment.path,
          nameContext: resolveResultNameContext({ current: segment.nameContext, previous: previous?.nameContext }),
          // The content did not change, so it is the one of this export: the result learns its
          // signature (a result of an older manifest has none).
          signature,
          ...((segment.segColorIndex != null) && { segColorIndex: segment.segColorIndex }),
          ...((segment.tail !== undefined) && { tail: segment.tail }),
        };
        break;
      }
      case 'export': {
        if (createdIndices.has(decision.index)) {
          records[segment.segId] = {
            start: segment.start,
            end: segment.end,
            label: segment.label,
            path: segment.path,
            nameContext: segment.nameContext,
            signature,
            ...((segment.segColorIndex != null) && { segColorIndex: segment.segColorIndex }),
            ...((segment.tail !== undefined) && { tail: segment.tail }),
          };
        } else if (decision.previous != null) {
          records[segment.segId] = decision.previous;
        }
        break;
      }
      case 'blocked': {
        records[segment.segId] = decision.previous;
        break;
      }
      case 'skipped': {
        // Nothing was written and there is no result to keep. Do not adopt the foreign file.
        break;
      }
    }
  }

  // A reopened project carries another identity: the record moved to the new one, so the old key
  // must not stay behind as a second record of the same file. Only exact duplicates (same path and
  // times) of a record of this export are stale; anything else stays.
  const currentSegIds = new Set(segments.map((segment) => segment.segId));
  const pathKey = (path: string) => normalizeManifestPath(path, { caseInsensitive: caseInsensitivePaths });
  const occupied = new Set<string>();
  for (const [segId, entry] of Object.entries(records)) {
    if (currentSegIds.has(segId)) occupied.add(`${pathKey(entry.path)}|${patchTimeKey(entry.start)}|${patchTimeKey(entry.end)}`);
  }
  const kept: Record<string, PatchManifestSegmentRecord> = {};
  const removedSegIds: string[] = [];
  for (const [segId, entry] of Object.entries(records)) {
    if (!currentSegIds.has(segId) && occupied.has(`${pathKey(entry.path)}|${patchTimeKey(entry.start)}|${patchTimeKey(entry.end)}`)) {
      removedSegIds.push(segId);
    } else {
      kept[segId] = entry;
    }
  }

  return { records: kept, removedSegIds };
}

/**
The records of the clips that were deleted (fork-owned).

The clips of a merged-only export are temporary: the ones the export cut are deleted after the
merge, so the manifest must not keep a record of a file that is not there anymore - the next
export would look for a result that does not exist.

Only the records of the segments of this export are considered, and the paths are compared the
way the file system does (a record may spell the path differently).
*/
export function pruneDeletedClipRecords({ records, segments, deletedPaths, caseInsensitivePaths }: {
  records: Readonly<Record<string, PatchManifestSegmentRecord>>;
  /** The segments of this export (the clip of a segment is `segment.path`). */
  segments: readonly PatchExportSegmentInput[];
  /** The clip files that were deleted. */
  deletedPaths: readonly string[];
  /** Does the file system treat paths that differ only in case as the same file? */
  caseInsensitivePaths: boolean;
}): { records: Record<string, PatchManifestSegmentRecord>, removedSegIds: string[] } {
  const pathKey = (path: string) => normalizeManifestPath(path, { caseInsensitive: caseInsensitivePaths });
  const deleted = new Set(deletedPaths.map((path) => pathKey(path)));
  const exportedSegIds = new Set(segments.map((segment) => segment.segId));

  const kept: Record<string, PatchManifestSegmentRecord> = {};
  const removedSegIds: string[] = [];
  for (const [segId, record] of Object.entries(records)) {
    if (exportedSegIds.has(segId) && deleted.has(pathKey(record.path))) {
      removedSegIds.push(segId);
    } else {
      kept[segId] = record;
    }
  }

  return { records: kept, removedSegIds };
}

/**
The signature each selected result will have after this export.

A result that is cut now (or reused) has the signature of this export. A result that could not be
cut (its name is taken) keeps the content it has, so it keeps the signature of the export that
cut it - or the signature it inherits (a result of an older manifest). A segment that produced no
result has none.
*/
export function resolveResultSignatures({ decisions, signature, inheritedSignature, createdIndices }: {
  decisions: readonly PatchExportDecision[];
  /** The signature of this export. */
  signature: string;
  /** The signature a result of an older manifest may claim (see `resolveInheritedSignature`). */
  inheritedSignature?: string | undefined;
  /**
  The indexes whose export really wrote the file. A cut that did not happen leaves the old
  content in place, so the result keeps the signature of that content.
  */
  createdIndices?: ReadonlySet<number> | undefined;
}): (string | undefined)[] {
  return decisions.map((decision) => {
    switch (decision.kind) {
      case 'skipped': {
        return undefined;
      }
      case 'blocked': {
        return decision.previous.signature ?? inheritedSignature;
      }
      case 'export': {
        if (createdIndices != null && !createdIndices.has(decision.index)) {
          return decision.previous?.signature ?? inheritedSignature;
        }
        return signature;
      }
      default: {
        return signature;
      }
    }
  });
}
