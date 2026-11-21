import { constants as fsConstants } from 'node:fs';
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  applyExportRecordPatch, applyFinishReportToManifest, emptyPatchExportManifest, findManifestFileKey, parsePatchExportManifest, removeManifestFileRecord, updateManifestResultPath,
} from '../../../common/features/patchExport/index.js';
import type { FinishManifestChange, PatchExportManifest, PatchExportRecordPatch } from '../../../common/features/patchExport/index.js';
import { defaultPatchDirNames } from '../../../common/features/patchWork/workDirs.js';
import type { PatchDirNames } from '../../../common/features/patchWork/workDirs.js';
import { getPatchWorkDirs } from '../patchWork/workDirs.js';
import logger from '../../logger.js';

/**
The incremental-export manifest (fork-owned).

It lives in the work area next to the clips, so it travels with the results. Every write is
serialized and goes through a temporary file: a half-written manifest would make the next export
regenerate everything (safe, but slow) or, worse, lose track of the results.
*/
const manifestFileName = 'export-manifest.json';

let writeQueue: Promise<unknown> = Promise.resolve();

function isErrnoCode(error: unknown, code: string) {
  return typeof error === 'object' && error != null && (error as { code?: unknown }).code === code;
}

export function getPatchExportManifestPath(workRoot: string | undefined, dirNames: PatchDirNames = defaultPatchDirNames) {
  const workDirs = getPatchWorkDirs(workRoot, dirNames);
  return workDirs == null ? undefined : join(workDirs.workDir, manifestFileName);
}

/**
Keep a copy of a manifest that could not be read, instead of silently overwriting it on the
next export. Best effort: the export must still continue (it only regenerates the results).

An earlier backup is never overwritten: the first copy is the state from before the damage
started, and a later read of the same file would otherwise replace it with the same bad data.
The copy uses `COPYFILE_EXCL`, so two windows reading at once cannot claim one name.
*/
async function backupUnreadableManifest(path: string) {
  for (let index = 1; index <= 20; index += 1) {
    const backupPath = index === 1 ? `${path}.bad` : `${path}.bad.${index}`;
    try {
      // eslint-disable-next-line no-await-in-loop
      await copyFile(path, backupPath, fsConstants.COPYFILE_EXCL);
      return;
    } catch (error) {
      // A taken name means "try the next one"; anything else (no permission, disk) is not worth
      // failing the export over.
      if (!isErrnoCode(error, 'EEXIST')) return;
    }
  }
}

/** How many file, segment, merged and chapter records the raw manifest object claims to have. */
function countRawRecords(value: unknown) {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) return undefined;
  const { files } = value as { files?: unknown };
  // A `files` that is not a map (an array, a string) is a corrupt manifest that the parser replaces
  // with an empty one: nothing can be counted, and the next write would lose it.
  if (typeof files !== 'object' || files == null || Array.isArray(files)) return undefined;

  let segments = 0;
  let merged = 0;
  let chapters = 0;
  let badChapters = 0;
  for (const file of Object.values(files)) {
    if (!(typeof file === 'object' && file != null && !Array.isArray(file))) {
      continue;
    }

    const { segments: rawSegments, merged: rawMerged } = file as { segments?: unknown, merged?: unknown };
    if (typeof rawSegments === 'object' && rawSegments != null && !Array.isArray(rawSegments)) segments += Object.keys(rawSegments).length;
    if (rawMerged !== undefined) {
      merged += 1;
      if (typeof rawMerged === 'object' && rawMerged != null && !Array.isArray(rawMerged)) {
        const { chapters: rawChapters } = rawMerged as { chapters?: unknown };
        if (Array.isArray(rawChapters)) chapters += rawChapters.length;
        // A `chapters` that is not an array is dropped wholesale by the parser.
        else if (rawChapters !== undefined) badChapters += 1;
      }
    }
  }
  return { files: Object.keys(files).length, segments, merged, chapters, badChapters };
}

/**
Did the file have records that the schema dropped (a corrupt or unknown-version manifest)?

Every dropped record is lost for good on the next write (the parsed manifest is what gets
written back), so the backup is taken for *any* difference - one bad file record next to a
valid one, or one bad segment inside a valid file record -, not only for a manifest that ends
up empty.
*/
function hasDroppedRecords(value: unknown, parsed: PatchExportManifest) {
  const raw = countRawRecords(value);
  // Not a manifest at all (a JSON array, a string, or a `files` that is not a map): the parser
  // replaces it with an empty manifest, so the file is lost on the next write unless it is copied.
  if (raw == null) return true;
  let parsedSegments = 0;
  let parsedMerged = 0;
  let parsedChapters = 0;
  for (const file of Object.values(parsed.files)) {
    parsedSegments += Object.keys(file.segments).length;
    if (!(file.merged != null)) {
      continue;
    }

    parsedMerged += 1;
    parsedChapters += file.merged.chapters?.length ?? 0;
  }
  return raw.files !== Object.keys(parsed.files).length
    || raw.segments !== parsedSegments
    || raw.merged !== parsedMerged
    || raw.chapters !== parsedChapters
    || raw.badChapters > 0;
}

/** Read the manifest; a missing or unreadable file means "nothing is tracked yet". */
export async function readPatchExportManifest(workRoot: string | undefined, dirNames: PatchDirNames = defaultPatchDirNames): Promise<PatchExportManifest> {
  const path = getPatchExportManifestPath(workRoot, dirNames);
  if (path == null) return emptyPatchExportManifest();

  try {
    // A manifest saved by a hand editor may start with a BOM; it is not part of the JSON.
    const text = (await readFile(path, 'utf8')).replace(/^\uFEFF/, '');
    const raw: unknown = JSON.parse(text);
    const manifest = parsePatchExportManifest(raw);
    if (hasDroppedRecords(raw, manifest)) await backupUnreadableManifest(path);
    return manifest;
  } catch (error) {
    if (!isErrnoCode(error, 'ENOENT')) {
      logger.warn('Failed to read the export manifest', error);
      await backupUnreadableManifest(path);
    }
    return emptyPatchExportManifest();
  }
}

function enqueue<T>(operation: () => Promise<T>) {
  const next = writeQueue.then(operation, operation);
  writeQueue = next.catch(() => undefined);
  return next;
}

async function writeManifestFile(path: string, manifest: PatchExportManifest) {
  await mkdir(dirname(path), { recursive: true });
  // patch: the temp name carries the pid. Two windows may share one work area
  // (`allowMultipleInstances`); a fixed name would let both write the same file at the same time,
  // interleaving their JSON. The rename stays atomic either way.
  const tempPath = `${path}.${process.pid}.tmp`;
  await writeFile(tempPath, JSON.stringify(manifest, null, 2), 'utf8');
  await rename(tempPath, path);
}

/** Does the file system treat paths that differ only in case as the same file? */
const caseInsensitivePaths = process.platform === 'win32' || process.platform === 'darwin';

/**
Apply one export's record to the manifest (fork-owned).

The read and the write happen inside the same queue entry: the export planned from a snapshot it
read before the cuts started, so writing that snapshot back would erase a rename made in the
results window meanwhile. The record is merged into a fresh read instead (see
`applyExportRecordPatch`).
*/
export function updatePatchExportManifest(workRoot: string | undefined, sourcePath: string, patch: PatchExportRecordPatch, dirNames: PatchDirNames = defaultPatchDirNames): Promise<PatchExportManifest> {
  const path = getPatchExportManifestPath(workRoot, dirNames);
  if (path == null) return Promise.resolve(emptyPatchExportManifest());

  return enqueue(async () => {
    const fresh = await readPatchExportManifest(workRoot, dirNames);
    // The stored key wins: the same source can be opened with other separators, another case or a
    // `..` segment, and the record has to be updated in place instead of being duplicated (the
    // read / remove / rename paths already compare that way, see `findManifestFileKey`).
    const key = findManifestFileKey(fresh.files, sourcePath, { caseInsensitive: caseInsensitivePaths }) ?? sourcePath;
    const next: PatchExportManifest = {
      ...fresh,
      files: { ...fresh.files, [key]: applyExportRecordPatch(fresh.files[key], patch, { caseInsensitive: caseInsensitivePaths }) },
    };
    await writeManifestFile(path, next);
    return next;
  });
}

/** Follow a result rename in the manifest; the read-modify-write is one queue entry. */export function updatePatchExportManifestResultPath(workRoot: string | undefined, change: { from: string, to: string, label?: string | undefined, sourcePath?: string | undefined }, dirNames: PatchDirNames = defaultPatchDirNames): Promise<{ updated: boolean }> {
  const path = getPatchExportManifestPath(workRoot, dirNames);
  if (path == null) return Promise.resolve({ updated: false });

  return enqueue(async () => {
    const fresh = await readPatchExportManifest(workRoot, dirNames);
    const { manifest, updated } = updateManifestResultPath(fresh, change, { caseInsensitive: caseInsensitivePaths });
    if (updated) await writeManifestFile(path, manifest);
    return { updated };
  });
}

/**
Follow what a finish job did to the files (fork-owned).

A stopped job keeps the record of its source on purpose (the user runs it again), so the record has
to describe the disk as the attempt left it - see `applyFinishReportToManifest`. A job that ended
after keeping its cut results (`clips: keep`) keeps the record too, and then drops the merged result
the job moved away: the work area only holds what is still there.

Best effort: the caller reports the job, and a manifest that cannot be written only costs the next
attempt its shortcut (it is read from disk again either way).
*/
export function updatePatchExportManifestAfterFinish(
  workRoot: string | undefined,
  change: FinishManifestChange,
  dirNames: PatchDirNames = defaultPatchDirNames,
  options: { dropMovedMerged?: boolean | undefined } = {},
): Promise<{ updated: boolean }> {
  const path = getPatchExportManifestPath(workRoot, dirNames);
  if (path == null) return Promise.resolve({ updated: false });

  return enqueue(async () => {
    const fresh = await readPatchExportManifest(workRoot, dirNames);
    const { manifest, updated } = applyFinishReportToManifest(fresh, change, {
      caseInsensitive: caseInsensitivePaths,
      ...(options.dropMovedMerged != null && { dropMovedMerged: options.dropMovedMerged }),
    });
    if (updated) await writeManifestFile(path, manifest);
    return { updated };
  });
}

/**
Forget the record of the source file whose job just ended (fork-owned).

The finish flow calls this once every artifact has left the work area: the next export of the same
source must cut everything again instead of reusing files that are no longer there. The read and
the write are one queue entry, so a rename made meanwhile is not lost.
*/
export function removePatchExportManifestSourceRecord(workRoot: string | undefined, sourcePath: string, dirNames: PatchDirNames = defaultPatchDirNames): Promise<{ removed: boolean }> {
  const path = getPatchExportManifestPath(workRoot, dirNames);
  if (path == null) return Promise.resolve({ removed: false });

  return enqueue(async () => {
    const fresh = await readPatchExportManifest(workRoot, dirNames);
    const { manifest, removed } = removeManifestFileRecord(fresh, sourcePath, { caseInsensitive: caseInsensitivePaths });
    if (removed) await writeManifestFile(path, manifest);
    return { removed };
  });
}

/** Forget everything (the next export regenerates all results). */
export function clearPatchExportManifest(workRoot: string | undefined, dirNames: PatchDirNames = defaultPatchDirNames) {
  const path = getPatchExportManifestPath(workRoot, dirNames);
  if (path == null) return Promise.resolve();

  return enqueue(async () => {
    try {
      await unlink(path);
    } catch (error) {
      if (!isErrnoCode(error, 'ENOENT')) throw error;
    }
  });
}
