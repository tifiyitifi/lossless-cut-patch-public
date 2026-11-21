import { normalizeManifestPath } from '../patchExport/manifest.js';
import compareStrings from '../patchExport/stringOrder.js';
import { getPathFileName, getPathStem, isSamePath } from '../patchFinish/paths.js';

import type { PatchFinishLedger, PatchFinishLedgerEntry, PatchSourceFingerprint } from './ledger.js';

/**
Pair the sources and results of a work area (fork-owned, pure).

The overview answers "what became of this source": the cut results and merged results that belong
to it, or the fact that it has none. Everything the pairing needs arrives from the main process
(scanned folders, the finished-job ledger, the outputs the project files record), so the grouping
itself can be tested without touching the disk.

Pairing is done in tiers, strongest first:

1. `ledger`: the finish job recorded the final absolute paths (survives renames and an archived
   project file);
2. `project`: the `.llc` next to the source carries the outputs of its finish job (file names);
3. `name`: the result file name starts with the source's stem (`source-1-…`, `source-merge`);
4. otherwise the result is *unowned* - the source may have been deleted, or the file was put there
   by hand.

A tier never takes a file another tier already claimed, so a wrong guess cannot hide a real result.
*/

export type PatchOverviewSourceFolder = 'detachedSrc' | 'finishedSrc' | 'finishedSkip' | 'missing';

export type PatchOverviewResultFolder = 'finishedClips' | 'finishedMerged' | 'detachedClips' | 'detachedMerged';

export type PatchOverviewPairing = 'ledger' | 'project' | 'name' | 'none';

/** `none` = no result at all (the source is the one the user has to look at). */
export type PatchOverviewSourceStatus = 'none' | 'clipsOnly' | 'mergedOnly' | 'parkedOnly' | 'complete';

export type PatchOverviewGroupId = 'isolated' | 'partial' | 'complete' | 'sourceGone' | 'unowned';

export type PatchOverviewWarning =
  /** Nothing to scan: no working directory and no open file. */
  | 'no-work-root'
  /** A stage folder could not be read; it is shown as empty. */
  | 'dir-unreadable';

export interface PatchOverviewResultRef {
  path: string;
  folder: PatchOverviewResultFolder;
}

export interface PatchOverviewSource {
  path: string;
  folder: PatchOverviewSourceFolder;
  /** Kept cut results. */
  clips: PatchOverviewResultRef[];
  /** Kept merged results. */
  merged: PatchOverviewResultRef[];
  /** Cut results parked in `detached_clips` (pending deletion). */
  parkedClips: PatchOverviewResultRef[];
  /** Merged results parked in `detached_merged` (pending deletion). */
  parkedMerged: PatchOverviewResultRef[];
  /** Results the ledger records but that are not on disk anymore. */
  missing: string[];
  /** The strongest tier that paired a result with this source. */
  pairing: PatchOverviewPairing;
}

export interface PatchOverviewUnowned {
  path: string;
  folder: PatchOverviewResultFolder;
}

export interface PatchOverviewDirs {
  detachedSrcMediaDir: string | undefined;
  finishedSrcMediaDir: string | undefined;
  /** `<finished area>/finished_skip_src`: sources the user skipped. */
  finishedSkipSrcMediaDir: string | undefined;
  finishedClipsDir: string | undefined;
  finishedMergedDir: string | undefined;
  detachedClipsDir: string | undefined;
  detachedMergedDir: string | undefined;
}

/** Do the folders the buttons open exist right now? */
export interface PatchOverviewOpenTargets {
  detachedSources: boolean;
  finishedSources: boolean;
  finishedSkipSources: boolean;
  finishedClips: boolean;
  finishedMerged: boolean;
}

/** The outputs a `.llc` next to a source records (file names relative to that folder). */
export interface PatchOverviewProjectRecord {
  sourcePath: string;
  clips: string[];
  merged: string[];
}

/** Everything the main process reads before grouping. */
export interface PatchOverviewScan {
  workRoot: string | undefined;
  dirs: PatchOverviewDirs;
  /** Media files of `detached_src_media`, `finished_src_media` and `finished_skip_src`. */
  sources: readonly { path: string, folder: 'detachedSrc' | 'finishedSrc' | 'finishedSkip' }[];
  finishedClips: readonly string[];
  finishedMerged: readonly string[];
  detachedClips: readonly string[];
  detachedMerged: readonly string[];
  projectRecords: readonly PatchOverviewProjectRecord[];
  ledger: PatchFinishLedger;
  /**
  Fingerprints of the sources a missing ledger entry could describe, keyed by
  `normalizeManifestPath` (fork-owned). The main process reads them only for the files whose name
  matches such an entry, so a work area with no moved sources pays nothing.
  */
  sourceFingerprints?: ReadonlyMap<string, PatchSourceFingerprint> | undefined;
  openTargets: PatchOverviewOpenTargets;
  warnings?: readonly PatchOverviewWarning[] | undefined;
}

export interface PatchOverviewStats {
  /** Source videos that exist (detached + finished). */
  sources: number;
  /** Kept cut results in `finished_clips`. */
  clips: number;
  /** Kept merged results in `finished_merged`. */
  merged: number;
  /** Sources without a single result (kept or parked). */
  isolated: number;
  clipsOnly: number;
  mergedOnly: number;
  parkedOnly: number;
  complete: number;
  /** Sources the ledger knows whose file is gone (results still on disk). */
  sourceGone: number;
  /** Result files that no source owns. */
  unowned: number;
  /** Recorded results that are not on disk anymore. */
  missing: number;
}

export interface PatchOverview {
  workRoot: string | undefined;
  dirs: PatchOverviewDirs;
  sources: PatchOverviewSource[];
  unowned: PatchOverviewUnowned[];
  stats: PatchOverviewStats;
  openTargets: PatchOverviewOpenTargets;
  warnings: PatchOverviewWarning[];
}

export interface PatchOverviewGroup {
  id: PatchOverviewGroupId;
  sources: PatchOverviewSource[];
  unowned: PatchOverviewUnowned[];
}

/** The file-name separators a result may use after the source stem. */
const resultNameSeparators = ['-', ' ', '_'];

/**
Does a result file name belong to a source, judging by the stem alone?

Only the shapes the app's own name rules produce count (`source-1-…`, `source - label-merge`): the
source stem must be the whole result stem or be followed by a separator, so `b` never claims
`bar-1`.
*/
export function isResultNameOfSource(resultStem: string, sourceStem: string, { caseInsensitive }: { caseInsensitive: boolean }) {
  const result = caseInsensitive ? resultStem.toLowerCase() : resultStem;
  const source = caseInsensitive ? sourceStem.toLowerCase() : sourceStem;
  if (source === '') return false;
  if (result === source) return true;
  return resultNameSeparators.some((separator) => result.startsWith(`${source}${separator}`));
}

/** The status a source row shows (kept results win over parked ones). */
export function getPatchOverviewSourceStatus(source: Pick<PatchOverviewSource, 'clips' | 'merged' | 'parkedClips' | 'parkedMerged'>): PatchOverviewSourceStatus {
  const kept = source.clips.length + source.merged.length;
  const parked = source.parkedClips.length + source.parkedMerged.length;
  if (kept === 0 && parked === 0) return 'none';
  if (source.clips.length > 0 && source.merged.length > 0) return 'complete';
  if (source.clips.length > 0) return 'clipsOnly';
  if (source.merged.length > 0) return 'mergedOnly';
  return 'parkedOnly';
}

interface ResultPoolEntry {
  path: string;
  folder: PatchOverviewResultFolder;
  claimed: boolean;
}

function bucketOf(folder: PatchOverviewResultFolder): 'clips' | 'merged' | 'parkedClips' | 'parkedMerged' {
  switch (folder) {
    case 'finishedClips': { return 'clips'; }
    case 'finishedMerged': { return 'merged'; }
    case 'detachedClips': { return 'parkedClips'; }
    case 'detachedMerged': { return 'parkedMerged'; }
    default: { return 'clips'; }
  }
}

/** The overview of one work area. */
export function groupPatchResultsOverview(scan: PatchOverviewScan, { caseInsensitive }: { caseInsensitive: boolean }): PatchOverview {
  const normalize = (path: string) => normalizeManifestPath(path, { caseInsensitive });
  const samePath = (a: string, b: string) => isSamePath(a, b, { caseInsensitive });

  const pool: ResultPoolEntry[] = [
    ...scan.finishedClips.map((path) => ({ path, folder: 'finishedClips' as const, claimed: false })),
    ...scan.finishedMerged.map((path) => ({ path, folder: 'finishedMerged' as const, claimed: false })),
    ...scan.detachedClips.map((path) => ({ path, folder: 'detachedClips' as const, claimed: false })),
    ...scan.detachedMerged.map((path) => ({ path, folder: 'detachedMerged' as const, claimed: false })),
  ];

  const takeByPath = (path: string) => {
    const entry = pool.find((candidate) => !candidate.claimed && samePath(candidate.path, path));
    if (entry != null) entry.claimed = true;
    return entry;
  };

  const findAllByName = (name: string, folders: readonly PatchOverviewResultFolder[]) => pool.filter((candidate) => (
    !candidate.claimed
    && folders.includes(candidate.folder)
    && (caseInsensitive ? getPathFileName(candidate.path).toLowerCase() === name.toLowerCase() : getPathFileName(candidate.path) === name)
  ));

  const rows = new Map<string, PatchOverviewSource>();

  const ensureRow = (path: string, folder: PatchOverviewSourceFolder) => {
    const key = normalize(path);
    const existing = rows.get(key);
    if (existing != null) return existing;
    const row: PatchOverviewSource = {
      path,
      folder,
      clips: [],
      merged: [],
      parkedClips: [],
      parkedMerged: [],
      missing: [],
      pairing: 'none',
    };
    rows.set(key, row);
    return row;
  };

  const place = (row: PatchOverviewSource, entry: ResultPoolEntry) => {
    const bucket = bucketOf(entry.folder);
    row[bucket].push({ path: entry.path, folder: entry.folder });
  };

  for (const source of scan.sources) ensureRow(source.path, source.folder);

  const fileNameKey = (path: string) => {
    const name = getPathFileName(path);
    return caseInsensitive ? name.toLowerCase() : name;
  };

  /**
  The row a ledger entry belongs to when its source was moved inside the work area (fork-owned).

  A finish job may move the source (detached, finished, skipped), and the ledger then holds the
  previous job under the old path. The file name narrows the candidates; the fingerprint decides, so
  a different video with the same name is never taken. An entry written before the fingerprint was
  recorded falls back to exactly one same-name source - the app's own result names and project files
  are built from that name, and there is nothing else to compare for those old entries.
  */
  const findMovedSourceRow = (entry: PatchFinishLedgerEntry) => {
    const name = fileNameKey(entry.source);
    const candidates = [...rows.values()].filter((row) => row.folder !== 'missing' && fileNameKey(row.path) === name);
    if (candidates.length === 0) return undefined;
    const identity = entry.sourceIdentity;
    if (identity == null) return candidates.length === 1 ? candidates[0] : undefined;
    const matching = candidates.filter((row) => {
      const fingerprint = scan.sourceFingerprints?.get(normalize(row.path));
      return fingerprint != null && fingerprint.size === identity.size && fingerprint.hash === identity.hash;
    });
    return matching.length === 1 ? matching[0] : undefined;
  };

  // Tier 1: the ledger knows the final paths of the last finished job of this source.
  for (const entry of scan.ledger.entries) {
    const claimed: ResultPoolEntry[] = [];
    const missing: string[] = [];

    for (const path of entry.clips) {
      const found = takeByPath(path);
      if (found != null) claimed.push(found);
      else missing.push(path);
    }
    for (const path of entry.merged) {
      const found = takeByPath(path);
      if (found != null) claimed.push(found);
      else missing.push(path);
    }
    for (const path of [...entry.parkedClips, ...entry.parkedMerged]) {
      const found = takeByPath(path);
      if (found != null) claimed.push(found);
    }

    // Parked results are pending deletions; a missing one is not worth a warning.
    const row = rows.get(normalize(entry.source))
      ?? (claimed.length > 0 ? findMovedSourceRow(entry) : undefined)
      ?? (claimed.length > 0 ? ensureRow(entry.source, 'missing') : undefined);
    if (row == null) continue;
    for (const result of claimed) place(row, result);
    row.missing.push(...missing);
    row.pairing = 'ledger';
  }

  // Tier 2: the project file next to the source lists the outputs by file name.
  // A name that two sources' records both list belongs to exactly one of them, and the name cannot
  // say which: handing it to whichever row is reached first would show the other source's result
  // under this one, and a detached source with a "kept result" is what the deletion check offers to
  // delete. The folder the result is in decides instead (a finished result belongs to a finished
  // source, a parked one to a detached source - the same rule the name tier uses); when that is not
  // unique either, the result stays unowned rather than guessed.
  const nameKey = (name: string) => (caseInsensitive ? name.toLowerCase() : name);
  const isFinishedSourceRow = (row: PatchOverviewSource) => row.folder === 'finishedSrc' || row.folder === 'finishedSkip';
  const recordRowsByName = new Map<string, PatchOverviewSource[]>();
  for (const record of scan.projectRecords) {
    const row = rows.get(normalize(record.sourcePath));
    if (row == null || row.pairing === 'ledger') continue;
    for (const name of [...record.clips, ...record.merged]) {
      const owners = recordRowsByName.get(nameKey(name));
      if (owners == null) recordRowsByName.set(nameKey(name), [row]);
      else if (!owners.includes(row)) owners.push(row);
    }
  }
  const mayClaimName = (row: PatchOverviewSource, name: string, entry: ResultPoolEntry) => {
    const owners = recordRowsByName.get(nameKey(name)) ?? [];
    if (owners.length <= 1) return true;
    const preferFinished = entry.folder === 'finishedClips' || entry.folder === 'finishedMerged';
    const matching = owners.filter((owner) => (preferFinished ? isFinishedSourceRow(owner) : owner.folder === 'detachedSrc'));
    return matching.length === 1 && matching[0] === row;
  };
  const claimRecordNames = (row: PatchOverviewSource, names: readonly string[], folders: readonly PatchOverviewResultFolder[]) => {
    let claimedAny = false;
    for (const name of names) {
      // Several folders can hold the same file name (one kept, one parked). Try each candidate in
      // turn: the first one this row's record may claim wins, so a finished entry that a detached
      // row is refused does not hide the detached row's own copy of that name.
      const entry = findAllByName(name, folders).find((candidate) => mayClaimName(row, name, candidate));
      if (entry == null) continue;
      entry.claimed = true;
      place(row, entry);
      claimedAny = true;
    }
    return claimedAny;
  };

  for (const record of scan.projectRecords) {
    const row = rows.get(normalize(record.sourcePath));
    if (row == null || row.pairing === 'ledger') continue;

    const clipsClaimed = claimRecordNames(row, record.clips, ['finishedClips', 'detachedClips']);
    const mergedClaimed = claimRecordNames(row, record.merged, ['finishedMerged', 'detachedMerged']);
    // A stale name (the result was renamed after the job) is not a missing file: the ledger and the
    // name tier are the places that know better.
    if (clipsClaimed || mergedClaimed) row.pairing = 'project';
  }

  // Tier 3: the result name starts with the source stem. The longest stem wins, so `a` does not
  // take the results of `a-1`; an ambiguous match is left unowned instead of guessed.
  for (const entry of pool) {
    if (entry.claimed) continue;
    const resultStem = getPathStem(entry.path);

    const matches = [...rows.values()].filter((row) => isResultNameOfSource(resultStem, getPathStem(row.path), { caseInsensitive }));
    if (matches.length === 0) continue;

    const longest = Math.max(...matches.map((row) => getPathStem(row.path).length));
    let best = matches.filter((row) => getPathStem(row.path).length === longest);
    if (best.length > 1) {
      // The same name in `detached_src_media` and a finished folder: the folder the result is in
      // decides which one is meant. Both finished folders count as "finished": a source the user
      // skipped is still a source whose kept results belong to it.
      const preferFinished = entry.folder === 'finishedClips' || entry.folder === 'finishedMerged';
      const isFinishedSource = (folder: PatchOverviewSourceFolder) => folder === 'finishedSrc' || folder === 'finishedSkip';
      const filtered = best.filter((row) => (preferFinished ? isFinishedSource(row.folder) : row.folder === 'detachedSrc'));
      if (filtered.length === 1) best = filtered;
    }
    const [row] = best;
    if (row == null || best.length !== 1) continue;

    entry.claimed = true;
    place(row, entry);
    if (row.pairing === 'none') row.pairing = 'name';
  }

  const sources = [...rows.values()];
  const unowned: PatchOverviewUnowned[] = pool
    .filter((entry) => !entry.claimed)
    .map((entry) => ({ path: entry.path, folder: entry.folder }));

  // The user looks at what has no result first: isolated, then incomplete, then complete. The work
  // area was already sorted by name, so the order inside a rank stays stable.
  const rank = (source: PatchOverviewSource) => {
    const status = getPatchOverviewSourceStatus(source);
    if (status === 'none') return 0;
    if (status === 'complete') return 2;
    return 1;
  };
  sources.sort((a, b) => rank(a) - rank(b) || compareStrings(normalize(a.path), normalize(b.path)));

  const existingSources = sources.filter((source) => source.folder !== 'missing');
  const countStatus = (status: PatchOverviewSourceStatus) => existingSources.filter((source) => getPatchOverviewSourceStatus(source) === status).length;

  const stats: PatchOverviewStats = {
    sources: existingSources.length,
    clips: scan.finishedClips.length,
    merged: scan.finishedMerged.length,
    isolated: countStatus('none'),
    clipsOnly: countStatus('clipsOnly'),
    mergedOnly: countStatus('mergedOnly'),
    parkedOnly: countStatus('parkedOnly'),
    complete: countStatus('complete'),
    sourceGone: sources.length - existingSources.length,
    unowned: unowned.length,
    missing: sources.reduce((total, source) => total + source.missing.length, 0),
  };

  return {
    workRoot: scan.workRoot,
    dirs: scan.dirs,
    sources,
    unowned,
    stats,
    openTargets: scan.openTargets,
    warnings: [...(scan.warnings ?? [])],
  };
}

/**
The rows of the overview, in display order.

`sourceGone` collects the sources whose file is not on disk anymore (the ledger still knows their
results), so they do not appear in the buckets of the sources the user can still open.
*/
export function buildOverviewGroups(overview: PatchOverview): PatchOverviewGroup[] {
  const gone = (source: PatchOverviewSource) => source.folder === 'missing';
  const status = (source: PatchOverviewSource) => getPatchOverviewSourceStatus(source);

  return [
    { id: 'isolated', sources: overview.sources.filter((source) => !gone(source) && status(source) === 'none'), unowned: [] },
    { id: 'partial', sources: overview.sources.filter((source) => !gone(source) && status(source) !== 'none' && status(source) !== 'complete'), unowned: [] },
    { id: 'complete', sources: overview.sources.filter((source) => !gone(source) && status(source) === 'complete'), unowned: [] },
    { id: 'sourceGone', sources: overview.sources.filter(gone), unowned: [] },
    { id: 'unowned', sources: [], unowned: overview.unowned },
  ];
}
