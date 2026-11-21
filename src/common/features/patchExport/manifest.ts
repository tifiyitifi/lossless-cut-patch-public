import type { FileNameTemplateContext } from '../../userTypes.js';
import { parseRuleCutNameContext } from '../patchData/cutName.js';
import type { PatchNameContext } from '../patchPlayer/playerMode.js';
import type { PatchMergedChapter } from '../patchMerged/mergedChapters.js';
import { parsePatchMergedChapters } from '../patchMerged/mergedChapters.js';
import type { PatchTailMode } from '../patchExportPolicy/tailEnd.js';

/** How one cut result was recorded at export time. */
export interface PatchManifestSegmentRecord {
  start: number;
  end: number;
  label?: string | undefined;
  path: string;
  nameContext?: PatchNameContext | undefined;
  /** The source segment's color, so the merged result reuses the same scheme. */
  segColorIndex?: number | undefined;
  /**
  How the result reaches its end (fork-owned, only the last result of an export).

  Part of the result's identity: a record without it (or with another mode) was cut with another
  tail rule, so the result has to be cut again.
  */
  tail?: PatchTailMode | undefined;
  /**
  The export signature the result was cut with (fork-owned).

  The signature belongs to the *result*, not to the file: an export that only cuts some of the
  segments must not make the other results look current. A record without one is from an older
  manifest and is cut again (its content cannot be proven).
  */
  signature?: string | undefined;
}

/** One cut result the merged file was built from, in merge order (fork-owned). */
export interface PatchManifestMergedInput {
  segId: string;
  start: number;
  end: number;
  /**
  The export signature the result had when it went into the merge.

  Absent for a result of an older manifest, whose content cannot be proven: a merge recorded from
  such a result does not let the finish job delete it.
  */
  signature?: string | undefined;
  /** The result's tail rule when it went into the merge (fork-owned, part of its identity). */
  tail?: PatchTailMode | undefined;
}

/** The merged result of a source file (only when merging is enabled). */
export interface PatchManifestMergedRecord {
  signature: string;
  path: string;
  /**
  The cut results the merged file was built from, in merge order (fork-owned).

  This is the evidence the finish job needs: a merged file may only replace the cut results it
  really contains. File timestamps cannot tell that (a copied work area, a restored backup or a
  clock change reorders them), so the merge records what went in. Missing on records written
  before the merge kept this.
  */
  inputs?: PatchManifestMergedInput[] | undefined;
  /**
  The merged file's read-only chapters (fork-owned).

  Stored with the merged file so the merged-result window can be reopened after a restart (the
  resume command) with the same chapters and their cut-queue numbers. Missing on records written
  before the chapters were recorded.
  */
  chapters?: PatchMergedChapter[] | undefined;
}

/** Everything the incremental export knows about one source file. */
export interface PatchExportFileRecord {
  /**
  The signature under which *every* tracked result of this source was produced (fork-owned).

  It is only advanced when an export covered all of them, so it can be inherited by a result of
  an older manifest (a result without a signature of its own). The authoritative signature is the
  one of each result (see `PatchManifestSegmentRecord`).
  */
  signature: string;
  segments: Record<string, PatchManifestSegmentRecord>;
  /**
  The order the last export cut the results in (fork-owned).

  Patch mode cuts and merges in the cut queue's order, not in timeline order. The queue order is the
  user's decision, so it is stored with the source's record: the results window and a later merge
  read it back from here (the clips player and a restart would otherwise fall back to start times).
  Only the segments the export selected are listed - a deselected segment is not part of the results
  any more, and the merge must not pick it up from an older order.

  Missing on records written before the order was kept: the merge then uses timeline order, which is
  what it always did.
  */
  order?: string[] | undefined;
  merged?: PatchManifestMergedRecord | undefined;
}

/**
The order without empty or repeated identities (fork-owned).

`undefined` when nothing is left: an empty order says nothing, so it is stored as "not recorded"
and the caller falls back to timeline order.
*/
export function normalizeOrder(order: readonly string[] | undefined): string[] | undefined {
  if (order == null) return undefined;
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const segId of order) {
    if (segId.length === 0 || seen.has(segId)) continue;
    seen.add(segId);
    normalized.push(segId);
  }
  return normalized.length > 0 ? normalized : undefined;
}

/**
The recorded order restricted to the segments a record still has (fork-owned).

A result that left the manifest (a finish job moved or deleted it) must not stay in the order: the
next merge would look for a result the work area no longer holds.
*/
export function trimOrder(order: readonly string[] | undefined, segments: Readonly<Record<string, unknown>>): string[] | undefined {
  if (order == null) return undefined;
  return normalizeOrder(order.filter((segId) => Object.hasOwn(segments, segId)));
}

/** Is the recorded order the one an export would record now? (fork-owned) */
export function isSameOrder(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const left = normalizeOrder(a) ?? [];
  const right = normalizeOrder(b) ?? [];
  return left.length === right.length && left.every((segId, index) => segId === right[index]);
}

/** The incremental-export manifest stored in the work area. */
export interface PatchExportManifest {
  version: 1;
  files: Record<string, PatchExportFileRecord>;
}

export const patchExportManifestVersion = 1;

export function emptyPatchExportManifest(): PatchExportManifest {
  return { version: patchExportManifestVersion, files: {} };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

function parseNameContext(value: unknown): PatchNameContext | undefined {
  if (!isObject(value)) return undefined;

  // patch: the cut results are named by the `{token}` rule (see `cutName.ts`); its record carries
  // `kind: 'rule'`. A record without it is the upstream `${}` template.
  if (value['kind'] === 'rule') return parseRuleCutNameContext(value);

  const { template, outputDir, context, emptyLabelSuffix, maxLabelLength, safeOutputFileName } = value;

  if (typeof template !== 'string' || template.length === 0 || (typeof outputDir !== 'string')) return undefined;
  if (!isObject(context) || typeof context['FILENAME'] !== 'string' || !Array.isArray(context['FILES'])) return undefined;
  if (typeof context['EXT'] !== 'string' || typeof context['EPOCH_MS'] !== 'number' || (typeof emptyLabelSuffix !== 'string')) return undefined;
  if (typeof maxLabelLength !== 'number' || !Number.isFinite(maxLabelLength) || (typeof safeOutputFileName !== 'boolean')) return undefined;

  return {
    template,
    outputDir,
    context: context as unknown as FileNameTemplateContext,
    emptyLabelSuffix,
    maxLabelLength,
    safeOutputFileName,
  };
}

function parseSegment(value: unknown): PatchManifestSegmentRecord | undefined {
  if (!isObject(value)) return undefined;
  const { start, end, label, path, nameContext, signature, segColorIndex, tail } = value;
  if (typeof start !== 'number' || !Number.isFinite(start) || typeof end !== 'number' || !Number.isFinite(end)) return undefined;
  // A result has a length: a reversed (or empty) range is a corrupt record, and the job or the
  // merge would only fail on it later.
  if (!(end > start)) return undefined;
  if (typeof path !== 'string' || path.length === 0) return undefined;
  if (label !== undefined && typeof label !== 'string') return undefined;
  if (signature !== undefined && typeof signature !== 'string') return undefined;
  if (segColorIndex !== undefined && (typeof segColorIndex !== 'number' || !Number.isFinite(segColorIndex) || segColorIndex < 0)) return undefined;
  if (tail !== undefined && tail !== 'end' && tail !== 'frame') return undefined;

  return {
    start,
    end,
    label,
    path,
    nameContext: parseNameContext(nameContext),
    signature,
    ...((segColorIndex !== undefined) && { segColorIndex: Math.floor(segColorIndex) }),
    ...((tail !== undefined) && { tail }),
  };
}

function parseMergedInputs(value: unknown): PatchManifestMergedInput[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const inputs = value.flatMap((entry): PatchManifestMergedInput[] => {
    if (!isObject(entry)) return [];
    const { segId, start, end, signature, tail } = entry;
    if (typeof segId !== 'string' || segId.length === 0 || typeof start !== 'number' || !Number.isFinite(start)) return [];
    if (typeof end !== 'number' || !Number.isFinite(end)) return [];
    if (signature !== undefined && typeof signature !== 'string') return [];
    if (tail !== undefined && tail !== 'end' && tail !== 'frame') return [];
    return [{ segId, start, end, ...((signature !== undefined) && { signature }), ...((tail !== undefined) && { tail }) }];
  });
  // A partially readable list proves nothing about the merge: treat it as "not recorded".
  return inputs.length === value.length && inputs.length > 0 ? inputs : undefined;
}

function parseOrder(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  // Anything but a list of identities says nothing about the order: fall back to timeline order
  // instead of merging a partially readable sequence.
  if (!value.every((segId): segId is string => typeof segId === 'string')) return undefined;
  return normalizeOrder(value);
}

function parseMerged(value: unknown): PatchManifestMergedRecord | undefined {
  if (!isObject(value)) return undefined;
  const { signature, path, chapters, inputs } = value;
  if (typeof signature !== 'string' || signature.length === 0 || typeof path !== 'string' || path.length === 0) return undefined;
  const parsedChapters = chapters === undefined ? [] : parsePatchMergedChapters(chapters);
  const parsedInputs = parseMergedInputs(inputs);
  return {
    signature,
    path,
    ...((parsedInputs != null) && { inputs: parsedInputs }),
    ...((parsedChapters.length > 0) && { chapters: parsedChapters }),
  };
}

/** Resolve the `.` and `..` segments of a path. */
function resolveDotSegments(path: string) {
  const isAbsolute = path.startsWith('/');
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') {
      // Nothing to do: the segment names the current directory.
    } else if (segment === '..') {
      const last = segments.at(-1);
      if (last != null && last !== '..') segments.pop();
      else if (!isAbsolute) segments.push('..');
    } else {
      segments.push(segment);
    }
  }
  const resolved = segments.join('/');
  return isAbsolute ? `/${resolved}` : resolved;
}

/**
A path in a form that can be compared across sessions (fork-owned).

The same file can be opened with different separators (`C:\a\b` vs `C:/a/b`) or a different case
(`C:\Videos` vs `c:\videos`). On Windows and macOS the file system treats those as the same file,
so the manifest lookup has to as well; on Linux they may be different files.

The `.` and `..` segments are resolved as well, so `a/./b` and `a/c/../b` are the same file.
*/
export function normalizeManifestPath(path: string, { caseInsensitive }: { caseInsensitive: boolean }) {
  const unified = path.replaceAll('\\', '/').replaceAll(/\/+/g, '/').replace(/\/$/, '');
  const resolved = resolveDotSegments(unified);
  return caseInsensitive ? resolved.toLowerCase() : resolved;
}

/**
The key of the manifest record for a source file. The exact key wins; otherwise the path is
matched with `normalizeManifestPath`, so a source opened with another spelling still finds its
records (and the update keeps using the stored key instead of adding a duplicate).
*/
export function findManifestFileKey(files: Readonly<Record<string, unknown>>, sourcePath: string, { caseInsensitive }: { caseInsensitive: boolean }): string | undefined {
  if (Object.hasOwn(files, sourcePath)) return sourcePath;
  const target = normalizeManifestPath(sourcePath, { caseInsensitive });
  return Object.keys(files).find((key) => normalizeManifestPath(key, { caseInsensitive }) === target);
}

/**
Validate a manifest read from disk (it is our file, but it is on disk and can be edited/corrupted).

Anything malformed is dropped instead of failing the export: a missing record only means the
result is regenerated, which is always safe.
*/
/**
Point a renamed result at its new path.

The results window renames a file on disk; the manifest has to follow it. Otherwise the next
export thinks the result is gone (and cuts it again) and the merge cannot find it.

The path is matched the way the file system does: the same file can be spelled with other
separators or (on Windows/macOS) another case, and the rename must still find it.

The result belongs to one source file, so only the record of that source is updated: another
source may have a result with the same name (the name templates of two sources collided), and
its record is not the file that was renamed. When the source is not known (or the manifest does
not know it), every record is searched.

Pure: the manifest is copied, not mutated, so a caller can keep the old one.
*/
export function updateManifestResultPath(manifest: PatchExportManifest, { from, to, label, sourcePath }: {
  from: string,
  to: string,
  label?: string | undefined,
  /** The source file the renamed result belongs to. */
  sourcePath?: string | undefined,
}, { caseInsensitive }: { caseInsensitive: boolean }): { manifest: PatchExportManifest, updated: boolean } {
  let didUpdate = false;
  const files: Record<string, PatchExportFileRecord> = {};
  const fromKey = normalizeManifestPath(from, { caseInsensitive });

  // The record of the source the result belongs to. Without it (or without a record for it), every
  // record is searched.
  const sourceKey = sourcePath != null ? findManifestFileKey(manifest.files, sourcePath, { caseInsensitive }) : undefined;

  for (const [filePath, record] of Object.entries(manifest.files)) {
    if (sourceKey == null || filePath === sourceKey) {
      const segments: Record<string, PatchManifestSegmentRecord> = {};

      for (const [segId, segment] of Object.entries(record.segments)) {
        if (normalizeManifestPath(segment.path, { caseInsensitive }) === fromKey) {
          didUpdate = true;
          segments[segId] = { ...segment, path: to, ...((label !== undefined) && { label }) };
        } else {
          segments[segId] = segment;
        }
      }

      const merged = record.merged != null && normalizeManifestPath(record.merged.path, { caseInsensitive }) === fromKey
        ? { ...record.merged, path: to }
        : record.merged;
      if (merged !== record.merged) didUpdate = true;

      files[filePath] = { ...record, segments, merged };
    } else {
      // The record of another source: its result with the same name is not the file that was
      // renamed.
      files[filePath] = record;
    }
  }

  return { manifest: didUpdate ? { ...manifest, files } : manifest, updated: didUpdate };
}

/** What one export writes into the manifest record of its source file. */
export interface PatchExportRecordPatch {
  /**
  Source stat + export parameters of this export. It becomes the signature of the file only when
  it covered every tracked result (see `applyExportRecordPatch`).
  */
  signature: string;
  /** The records this export knows (the whole record, including retained segments). */
  segments: Readonly<Record<string, PatchManifestSegmentRecord>>;
  /** Segments this export wrote or renamed: their record is authoritative. */
  replacedSegIds: readonly string[];
  /** Segments to forget (their clips were deleted by this export). */
  removedSegIds: readonly string[];
  /**
  The order the export selected its segments in (fork-owned). Leave it undefined to keep the stored
  order; an export that selected nothing clears it.
  */
  order?: string[] | undefined;
  /** The merged result this export wrote or kept; leave the stored one when undefined. */
  merged?: PatchManifestMergedRecord | undefined;
}

/**
Merge one export's record into the *fresh* manifest (fork-owned).

The export plans from a manifest it read before the (long) cuts started. Writing that snapshot
back would erase anything another window changed meanwhile (a result rename). Only the segments
the export really wrote or renamed replace the on-disk record; a retained segment keeps the newer
path when another window renamed it, and a record another window removed is not resurrected.

The paths are compared the way the file system does (`caseInsensitive` tells whether paths that
differ only in case are the same file).
*/
export function applyExportRecordPatch(fresh: PatchExportFileRecord | undefined, patch: PatchExportRecordPatch, { caseInsensitive }: { caseInsensitive: boolean }): PatchExportFileRecord {
  const replaced = new Set(patch.replacedSegIds);
  const removed = new Set(patch.removedSegIds);
  const segments: Record<string, PatchManifestSegmentRecord> = {};
  // The paths are compared the way the file system does: the same file can be spelled with other
  // separators or (on Windows/macOS) another case.
  const samePath = (a: string, b: string) => normalizeManifestPath(a, { caseInsensitive }) === normalizeManifestPath(b, { caseInsensitive });

  // Start from the fresh record: anything another window changed is kept unless this export
  // replaced or removed the segment.
  for (const [segId, segment] of Object.entries(fresh?.segments ?? {})) {
    if (!removed.has(segId)) segments[segId] = segment;
  }

  for (const [segId, segment] of Object.entries(patch.segments)) {
    if (!removed.has(segId)) {
      if (replaced.has(segId)) {
        segments[segId] = segment;
      } else {
        const freshSegment = segments[segId];
        // Same file: the export has the fresher label / name template. A different path means
        // another window renamed the result while this export was running - that path wins.
        if (freshSegment != null && samePath(freshSegment.path, segment.path)) segments[segId] = segment;
      }
    }
  }

  const merged = patch.merged ?? fresh?.merged;

  // The signature of the file stands for the parameters *every* tracked result was produced with,
  // so it may only be advanced when this export covered all of them. A result that was not cut
  // again keeps the content it has, and the file's signature must not claim otherwise: a result of
  // an older manifest would inherit it and look current (with content of other parameters).
  const everyResultIsCurrent = Object.values(segments).every((segment) => segment.signature === patch.signature);
  const signature = everyResultIsCurrent ? patch.signature : (fresh?.signature ?? patch.signature);

  // A caller that does not touch the order (the merge) keeps the stored one; an export that
  // selected nothing (`[]`) clears it. Only results the record still has stay in the order.
  const order = trimOrder(patch.order !== undefined ? patch.order : fresh?.order, segments);

  return { signature, segments, ...((order != null) && { order }), ...((merged != null) && { merged }) };
}

/**
Forget the record of one source file (fork-owned).

The finish flow deletes it once the job is over: every artifact has left the incremental pipeline
(moved to `finished_*`, `detached_*` or deleted), so the next export of the same source starts
from scratch instead of reusing files that are no longer in the working area.

Pure: the manifest is copied, not mutated.
*/
export function removeManifestFileRecord(manifest: PatchExportManifest, sourcePath: string, { caseInsensitive }: { caseInsensitive: boolean }): { manifest: PatchExportManifest, removed: boolean } {
  const key = findManifestFileKey(manifest.files, sourcePath, { caseInsensitive });
  if (key == null) return { manifest, removed: false };
  const files: Record<string, PatchExportFileRecord> = {};
  for (const [filePath, record] of Object.entries(manifest.files)) {
    if (filePath !== key) files[filePath] = record;
  }
  return { manifest: { ...manifest, files }, removed: true };
}

/** What a finish job that stopped halfway did to the files of one source (fork-owned). */
export interface FinishManifestChange {
  /** The source file the job ran for (the manifest key as the job knew it). */
  sourcePath: string;
  /** Where the source video is now, when the job moved it before it stopped. */
  newSourcePath?: string | undefined;
  /** Every file the job moved before it stopped (video, project file, merged result, cut results). */
  moved: readonly { from: string, to: string }[];
  /** Every file the job deleted (a cut result, its project file, the merged result). */
  deleted: readonly string[];
}

/**
Point the manifest record of a source at what a *stopped* finish job really left on disk (fork-owned).

A job that stops keeps its manifest record on purpose, so the user can run it again. But the record
then still describes the state from before the attempt: a moved source is still keyed by its old
path (the retry would find no record at all), a moved result is still recorded where it no longer
is (`clips-missing`, which blocks the retry), and an already deleted result looks missing too.

So the record follows the disk:
- the record moves to the source's new path when the job moved the video;
- a result that the job moved out of the work area, or deleted, leaves the record: the finish flow
  is over for it (a later export cuts it again);
- the merged result keeps its place in the record (it may still be deleted or moved), with its path
  updated;
- the results that left the record are dropped from the merged file's inputs and chapters as well,
  otherwise the remaining results could no longer be proven to be inside the merged file - and the
  retry would have to move them aside instead of deleting them.

Pure: the manifest is copied, not mutated.
*/
export function applyFinishReportToManifest(
  manifest: PatchExportManifest,
  change: FinishManifestChange,
  { caseInsensitive, dropMovedMerged = false }: {
    caseInsensitive: boolean;
    /**
    A merged result the job moved is gone from the incremental pipeline. A stopped job keeps it in
    the record (a retry may still find it where it went, `follow`); a job that ended drops it, so
    the record describes what the work area still holds.
    */
    dropMovedMerged?: boolean | undefined;
  },
): { manifest: PatchExportManifest, updated: boolean } {
  const key = findManifestFileKey(manifest.files, change.sourcePath, { caseInsensitive });
  if (key == null) return { manifest, updated: false };
  const record = manifest.files[key];
  if (record == null) return { manifest, updated: false };

  // The same file may be spelled with other separators or (on Windows/macOS) another case.
  const samePath = (a: string, b: string) => normalizeManifestPath(a, { caseInsensitive }) === normalizeManifestPath(b, { caseInsensitive });
  const wasDeleted = (path: string) => change.deleted.some((entry) => samePath(entry, path));
  const movedTo = (path: string) => change.moved.find((entry) => samePath(entry.from, path))?.to;

  /** Results whose file the job moved or deleted: they are no longer tracked in the work area. */
  const leftRecords = new Set<string>();
  const segments: Record<string, PatchManifestSegmentRecord> = {};
  for (const [segId, segment] of Object.entries(record.segments)) {
    const destination = movedTo(segment.path);
    if (wasDeleted(segment.path) || (destination != null && !samePath(destination, segment.path))) {
      leftRecords.add(segId);
    } else {
      segments[segId] = segment;
    }
  }

  let { merged } = record;
  if (merged != null) {
    if (wasDeleted(merged.path)) {
      merged = undefined;
    } else {
      const destination = movedTo(merged.path);
      if (destination != null && !samePath(destination, merged.path)) {
        merged = dropMovedMerged ? undefined : { ...merged, path: destination };
      }
    }
    if (merged != null && leftRecords.size > 0) {
      // A result that left the record cannot be part of what the merged file is proven to contain.
      const inputs = merged.inputs?.filter((input) => !leftRecords.has(input.segId));
      const chapters = merged.chapters?.filter((chapter) => !leftRecords.has(chapter.segId));
      merged = {
        ...merged,
        ...(inputs !== undefined && inputs.length !== merged.inputs?.length && { inputs }),
        ...(chapters !== undefined && chapters.length !== merged.chapters?.length && { chapters }),
      };
    }
  }

  // A result that left the record leaves the order too: the next merge must not look for it.
  const nextRecord: PatchExportFileRecord = { ...record, segments, merged, order: trimOrder(record.order, segments) };
  const files: Record<string, PatchExportFileRecord> = {};
  for (const [filePath, fileRecord] of Object.entries(manifest.files)) {
    if (filePath !== key) files[filePath] = fileRecord;
  }
  const nextKey = change.newSourcePath != null && !samePath(change.newSourcePath, key) ? change.newSourcePath : key;

  // A job that ended and kept nothing leaves nothing to track. A stopped job always records what it
  // reached (the retry needs it), so only the end-of-job caller asks for this.
  if (dropMovedMerged && Object.keys(segments).length === 0 && merged == null) {
    return { manifest: { ...manifest, files }, updated: true };
  }

  files[nextKey] = nextRecord;

  return { manifest: { ...manifest, files }, updated: true };
}

export function parsePatchExportManifest(value: unknown): PatchExportManifest {
  if (!isObject(value) || value['version'] !== patchExportManifestVersion || !isObject(value['files'])) {
    return emptyPatchExportManifest();
  }

  const files: Record<string, PatchExportFileRecord> = {};

  for (const [sourcePath, fileValue] of Object.entries(value['files'])) {
    if (!(isObject(fileValue) && typeof fileValue['signature'] === 'string' && isObject(fileValue['segments']))) {
      continue;
    }

    const segments: Record<string, PatchManifestSegmentRecord> = {};
    for (const [segId, segmentValue] of Object.entries(fileValue['segments'])) {
      const segment = parseSegment(segmentValue);
      if (segment != null) segments[segId] = segment;
    }

    // The order is read without the records it names: a partly damaged segments map must not
    // reorder the merge, and an unknown identity is simply not merged.
    const order = trimOrder(parseOrder(fileValue['order']), segments);
    files[sourcePath] = {
      signature: fileValue['signature'],
      segments,
      ...((order != null) && { order }),
      merged: parseMerged(fileValue['merged']),
    };
  }

  return { version: patchExportManifestVersion, files };
}
