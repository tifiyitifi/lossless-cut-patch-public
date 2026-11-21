import { normalizeManifestPath } from '../patchExport/manifest.js';
import compareStrings from '../patchExport/stringOrder.js';

/**
The ledger of finished jobs (fork-owned, pure).

The incremental-export manifest forgets a source at the end of a finish job on purpose: every
result has left the work area, so the next export must start from scratch instead of reusing files
that are no longer there. That also means the manifest cannot answer "what did this source become"
afterwards, and the file names alone are a guess once a result was renamed.

So a finish job leaves a short record of its outputs here. The record is not used by the export or
the finish flow at all: it only lets the results overview pair a source with the files it really
produced (see `features/patchResultsOverview`). Absolute paths are stored, so a moved work area or
an archived project file does not break the pairing.
*/

export const patchFinishLedgerFileName = 'finish-history.json';
export const patchFinishLedgerVersion = 1;
/** The ledger is a convenience, not a log: old entries are dropped once it grows this big. */
export const patchFinishLedgerMaxEntries = 5000;

/**
Fingerprint of a source video (fork-owned): its exact size plus a hash of its head, tail and size.

A finish job may **move** the source inside the work area (detached, finished, skipped). The ledger
keys an entry by the source path, so the next job records another entry under the new path and the
old one no longer matches a file. The file name narrows the candidates and the fingerprint decides
between them, so two different videos that share a name are not merged. A move that also **renames**
the source (a free ` (n)` name when the target is taken) is not paired, because the candidates are
found by the current name first. Entries written before the fingerprint was recorded simply have
none.
*/
export interface PatchSourceFingerprint {
  /** Exact size in bytes. */
  size: number;
  /** `sha256` of the size, the first and the last chunk of the file (see `readPatchSourceFingerprint`). */
  hash: string;
}

export interface PatchFinishLedgerEntry {
  /** The source video after the job (the finish flow may have renamed it). */
  source: string;
  /**
  The source's fingerprint when the job ran (fork-owned).

  A later job that moves the source records a new entry under the new path; the overview pairs the
  two by this fingerprint, so the results of both passes stay under the file that exists now.
  Missing on entries written before it was recorded - the overview then falls back to the file name.
  */
  sourceIdentity?: PatchSourceFingerprint | undefined;
  /** Cut results the job kept, at their final paths. */
  clips: string[];
  /** Merged results the job kept, at their final paths. */
  merged: string[];
  /** Cut results the job parked in `detached_clips` (pending deletion). */
  parkedClips: string[];
  /** Merged results the job parked in `detached_merged` (pending deletion). */
  parkedMerged: string[];
  /** Unix milliseconds of the job. */
  at: number;
}

export interface PatchFinishLedger {
  version: typeof patchFinishLedgerVersion;
  /** Newest first. */
  entries: PatchFinishLedgerEntry[];
}

export function emptyPatchFinishLedger(): PatchFinishLedger {
  return { version: patchFinishLedgerVersion, entries: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

function parsePathList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): string[] => (typeof entry === 'string' && entry.trim() !== '' ? [entry] : []));
}

/** A stored fingerprint, or `undefined` when it is missing or malformed (an old or hand-edited file). */
function parseSourceIdentity(value: unknown): PatchSourceFingerprint | undefined {
  if (!isRecord(value)) return undefined;
  const { size, hash } = value;
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return undefined;
  if (typeof hash !== 'string' || hash.trim() === '') return undefined;
  return { size, hash };
}

function normalizeLedgerPath(path: string, caseInsensitive: boolean) {
  return normalizeManifestPath(path, { caseInsensitive });
}

function sortLedgerEntries(entries: readonly PatchFinishLedgerEntry[]): PatchFinishLedgerEntry[] {
  return [...entries].sort((a, b) => (b.at !== a.at ? b.at - a.at : compareStrings(a.source, b.source)));
}

/**
Read a ledger stored on disk, dropping anything malformed.

A damaged ledger only costs the pairing precision of the overview (the file names are still a
fallback), so a bad entry is skipped instead of failing the read.
*/
export function parsePatchFinishLedger(value: unknown): PatchFinishLedger {
  if (!isRecord(value) || value['version'] !== patchFinishLedgerVersion || !Array.isArray(value['entries'])) {
    return emptyPatchFinishLedger();
  }

  const entries: PatchFinishLedgerEntry[] = [];
  for (const entry of value['entries']) {
    if (!isRecord(entry)) continue;

    const { source, at } = entry;
    if (typeof source !== 'string' || source.trim() === '') continue;
    if (typeof at !== 'number' || !Number.isFinite(at)) continue;

    const sourceIdentity = parseSourceIdentity(entry['sourceIdentity']);
    entries.push({
      source,
      ...(sourceIdentity != null && { sourceIdentity }),
      clips: parsePathList(entry['clips']),
      merged: parsePathList(entry['merged']),
      parkedClips: parsePathList(entry['parkedClips']),
      parkedMerged: parsePathList(entry['parkedMerged']),
      at,
    });
  }

  return { version: patchFinishLedgerVersion, entries: sortLedgerEntries(entries) };
}

/**
Record the outputs of one finish job (newest first, one entry per source).

The source is compared the way the file system does (`caseInsensitive`), so a work area opened
with another spelling still replaces its old entry instead of adding a second one.
*/
export function upsertPatchFinishLedgerEntry(
  ledger: PatchFinishLedger,
  entry: PatchFinishLedgerEntry,
  { caseInsensitive, max = patchFinishLedgerMaxEntries }: { caseInsensitive: boolean, max?: number | undefined },
): PatchFinishLedger {
  const key = normalizeLedgerPath(entry.source, caseInsensitive);
  const entries = ledger.entries.filter((existing) => normalizeLedgerPath(existing.source, caseInsensitive) !== key);
  entries.push(entry);
  return { version: patchFinishLedgerVersion, entries: sortLedgerEntries(entries).slice(0, Math.max(1, max)) };
}

/**
Point a ledger entry at a result that was renamed (or moved) on disk.

The results window renames a file after the job is over; without this the ledger would keep the
old path and the overview would report the new file as unowned. Returns `updated: false` when no
entry mentions the old path, so the caller can skip the write.
*/
export function renamePatchFinishLedgerPaths(
  ledger: PatchFinishLedger,
  { from, to, caseInsensitive }: { from: string, to: string, caseInsensitive: boolean },
): { ledger: PatchFinishLedger, updated: boolean } {
  const fromKey = normalizeLedgerPath(from, caseInsensitive);
  let updated = false;

  const same = (path: string) => normalizeLedgerPath(path, caseInsensitive) === fromKey;
  const renameList = (paths: readonly string[]) => paths.map((path) => (same(path) ? to : path));
  const touches = (paths: readonly string[]) => paths.some((path) => same(path));

  const entries = ledger.entries.map((entry) => {
    const entryTouches = same(entry.source) || touches(entry.clips) || touches(entry.merged) || touches(entry.parkedClips) || touches(entry.parkedMerged);
    if (!entryTouches) return entry;
    updated = true;
    return {
      ...entry,
      source: same(entry.source) ? to : entry.source,
      clips: renameList(entry.clips),
      merged: renameList(entry.merged),
      parkedClips: renameList(entry.parkedClips),
      parkedMerged: renameList(entry.parkedMerged),
    };
  });

  return { ledger: updated ? { ...ledger, entries } : ledger, updated };
}
