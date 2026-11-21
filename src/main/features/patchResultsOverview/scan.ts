import { access, readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { normalizeManifestPath } from '../../../common/features/patchExport/manifest.js';
import { readProjectExtras } from '../../../common/features/patchData/projectExtras.js';
import { hasPatchMediaExtension } from '../../../common/features/patchData/videoExtensions.js';
import { getPathFileName, getProjectFileName } from '../../../common/features/patchFinish/paths.js';
import { groupPatchResultsOverview, parsePatchProjectOutputs } from '../../../common/features/patchResultsOverview/index.js';
import type { PatchFinishLedger, PatchOverview, PatchOverviewProjectRecord, PatchOverviewWarning, PatchSourceFingerprint } from '../../../common/features/patchResultsOverview/index.js';
import { defaultPatchDirNames } from '../../../common/features/patchWork/workDirs.js';
import type { PatchDirNames } from '../../../common/features/patchWork/workDirs.js';

import { getPatchFinishDirs } from '../patchWork/workDirs.js';

import { readPatchSourceFingerprint } from './fingerprint.js';

/**
The scan behind the results overview (fork-owned).

The renderer never touches the disk: the main process reads the seven stage folders, the finished-job
ledger and the project files, and the pure grouping (`common/features/patchResultsOverview`) turns
that into rows. A missing folder is simply empty - the overview is a report, not a job, and it must
open before the first finish as well.

`detached_clips` / `detached_merged` are read for classification only: a discarded job parked its
results there, and without them its source would look like it never produced anything.
*/

export interface PatchResultsOverviewDeps {
  dirNames?: PatchDirNames | undefined;
  ledger: PatchFinishLedger;
  caseInsensitive: boolean;
  /** Absolute media paths of a folder, sorted; rejects with `ENOENT` when it does not exist. */
  listMediaFiles?: ((dir: string) => Promise<readonly string[]>) | undefined;
  readText?: ((path: string) => Promise<string>) | undefined;
  exists?: ((path: string) => Promise<boolean>) | undefined;
  /** The fingerprint of a source video (fork-owned); only called for a few candidates, see below. */
  fingerprintSource?: ((path: string) => Promise<PatchSourceFingerprint | undefined>) | undefined;
  /** A diagnostic sink; the overview never fails because of a folder or a project file. */
  log?: ((message: string, ...args: unknown[]) => void) | undefined;
}

async function listPatchMediaPaths(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && hasPatchMediaExtension(entry.name))
    .map((entry) => join(dir, entry.name))
    .sort((a, b) => a.localeCompare(b, 'en-US', { numeric: true }));
}

function isErrnoCode(error: unknown, code: string) {
  return typeof error === 'object' && error != null && (error as { code?: unknown }).code === code;
}

export async function buildPatchResultsOverview(workRoot: string | undefined, deps: PatchResultsOverviewDeps): Promise<PatchOverview> {
  const dirNames = deps.dirNames ?? defaultPatchDirNames;
  const listMediaFiles = deps.listMediaFiles ?? listPatchMediaPaths;
  const readText = deps.readText ?? ((path: string) => readFile(path, 'utf8'));
  // Async on purpose: this runs on the Electron main thread, which also serves every window and
  // IPC call. A synchronous `existsSync` on a network work root blocks the whole app for the length
  // of an SMB round trip (seconds when the share sleeps).
  const exists = deps.exists ?? (async (path: string) => {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  });

  const warnings: PatchOverviewWarning[] = [];
  const dirs = getPatchFinishDirs(workRoot, dirNames);

  if (workRoot == null || workRoot.trim() === '' || dirs == null) {
    warnings.push('no-work-root');
  }

  const readFolder = async (dir: string | undefined) => {
    if (dir == null) return [];
    try {
      return await listMediaFiles(dir);
    } catch (error) {
      if (!isErrnoCode(error, 'ENOENT')) {
        warnings.push('dir-unreadable');
        deps.log?.('Failed to read a result folder for the overview', dir, error);
      }
      return [];
    }
  };

  const [detachedSources, finishedSources, finishedSkipSources, finishedClips, finishedMerged, detachedClips, detachedMerged] = await Promise.all([
    readFolder(dirs?.detachedSrcMediaDir),
    readFolder(dirs?.finishedSrcMediaDir),
    readFolder(dirs?.finishedSkipSrcMediaDir),
    readFolder(dirs?.finishedClipsDir),
    readFolder(dirs?.finishedMergedDir),
    readFolder(dirs?.detachedClipsDir),
    readFolder(dirs?.detachedMergedDir),
  ]);

  const sources = [
    ...detachedSources.map((path) => ({ path, folder: 'detachedSrc' as const })),
    ...finishedSources.map((path) => ({ path, folder: 'finishedSrc' as const })),
    ...finishedSkipSources.map((path) => ({ path, folder: 'finishedSkip' as const })),
  ];

  // A finish job may move a source inside the work area, so the ledger holds its previous job under
  // the old path. The overview pairs such an entry with the file that exists now by its fingerprint;
  // only the sources whose name matches a moved entry are read, so a work area without any pays
  // nothing (a large source is hundreds of megabytes, and this may be a network share).
  const sourceFingerprints = new Map<string, PatchSourceFingerprint>();
  const normalize = (path: string) => normalizeManifestPath(path, { caseInsensitive: deps.caseInsensitive });
  const existingSourcePaths = new Set(sources.map((source) => normalize(source.path)));
  const movedEntries = deps.ledger.entries.filter((entry) => entry.sourceIdentity != null && !existingSourcePaths.has(normalize(entry.source)));
  if (movedEntries.length > 0) {
    const nameKey = (path: string) => {
      const name = getPathFileName(path);
      return deps.caseInsensitive ? name.toLowerCase() : name;
    };
    const movedNames = new Set(movedEntries.map((entry) => nameKey(entry.source)));
    const readFingerprint = deps.fingerprintSource ?? readPatchSourceFingerprint;
    for (const source of sources) {
      if (!movedNames.has(nameKey(source.path))) continue;
      // eslint-disable-next-line no-await-in-loop
      const fingerprint = await readFingerprint(source.path);
      if (fingerprint != null) sourceFingerprints.set(normalize(source.path), fingerprint);
    }
  }

  // The project file travels with its video and lists the outputs of the last finished job by name.
  // A source without one (an archived `.llc`, an older task, a hand-copied file) simply skips this
  // tier; the ledger and the file names still pair. The reads are chunked: a work folder can hold
  // thousands of sources, and opening that many files at once is what an unbounded `Promise.all`
  // would do here.
  const projectRecords: PatchOverviewProjectRecord[] = [];
  const projectChunkSize = 8;
  for (let index = 0; index < sources.length; index += projectChunkSize) {
    const chunk = sources.slice(index, index + projectChunkSize);
    // eslint-disable-next-line no-await-in-loop
    const records = await Promise.all(chunk.map(async (source): Promise<PatchOverviewProjectRecord | undefined> => {
      const projectPath = join(dirname(source.path), getProjectFileName(source.path));
      try {
        // One read instead of existence-then-read: on a work root that is a network share every
        // extra call is another round trip, and a missing project file is simply an ENOENT.
        const extras = readProjectExtras(await readText(projectPath));
        const outputs = parsePatchProjectOutputs(extras['patchExport']);
        return outputs == null ? undefined : { sourcePath: source.path, ...outputs };
      } catch (error) {
        if (!isErrnoCode(error, 'ENOENT')) deps.log?.('Failed to read the project file of a source for the overview', projectPath, error);
        return undefined;
      }
    }));
    projectRecords.push(...records.flatMap((record): PatchOverviewProjectRecord[] => (record == null ? [] : [record])));
  }

  const openTargets = {
    detachedSources: dirs?.detachedSrcMediaDir != null && await exists(dirs.detachedSrcMediaDir),
    finishedSources: dirs?.finishedSrcMediaDir != null && await exists(dirs.finishedSrcMediaDir),
    finishedSkipSources: dirs?.finishedSkipSrcMediaDir != null && await exists(dirs.finishedSkipSrcMediaDir),
    finishedClips: dirs?.finishedClipsDir != null && await exists(dirs.finishedClipsDir),
    finishedMerged: dirs?.finishedMergedDir != null && await exists(dirs.finishedMergedDir),
  };

  return groupPatchResultsOverview({
    workRoot,
    dirs: {
      detachedSrcMediaDir: dirs?.detachedSrcMediaDir,
      finishedSrcMediaDir: dirs?.finishedSrcMediaDir,
      finishedSkipSrcMediaDir: dirs?.finishedSkipSrcMediaDir,
      finishedClipsDir: dirs?.finishedClipsDir,
      finishedMergedDir: dirs?.finishedMergedDir,
      detachedClipsDir: dirs?.detachedClipsDir,
      detachedMergedDir: dirs?.detachedMergedDir,
    },
    sources,
    finishedClips,
    finishedMerged,
    detachedClips,
    detachedMerged,
    projectRecords,
    ledger: deps.ledger,
    sourceFingerprints,
    openTargets,
    warnings,
  }, { caseInsensitive: deps.caseInsensitive });
}
