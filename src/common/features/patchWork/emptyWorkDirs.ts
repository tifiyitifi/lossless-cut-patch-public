import { getRecognizedWorkDirNames } from './dirNames.js';
import { defaultPatchDirNames, patchFinishSubdirNames, patchRepairTmpDirName, patchWorkLockFileName, patchWorkSubdirs } from './workDirs.js';
import type { PatchDirNames } from './workDirs.js';

/**
Can a `.losslesscut_work` directory be cleaned up? (pure)

The fork only ever removes a work area by moving the *whole* directory to the OS recycle bin,
and only when it holds nothing except the app's own empty stage folders and export manifest.
This is a **whitelist**, not a "no media files" check: a file or folder the user created by hand
(even an empty `.txt`, or an empty folder) blocks the cleanup. The point is to make accidental
data loss impossible, not to delete as much as possible.

Entries are described relative to the work directory (`clips/a.mp4`, `detached_clips`,
`export-manifest.json.bad.1`), because the file system is scanned by the main process and the
decision must stay platform independent (shared code has no `node:path`).
*/

export type PatchWorkDirEntryKind = 'directory' | 'file' | 'other';

export interface PatchWorkDirEntry {
  /** Path relative to the work directory, `/` separated. */
  path: string;
  /** `other` covers symlinks, junctions and anything that is not a plain file or directory. */
  kind: PatchWorkDirEntryKind;
}

export interface PatchWorkDirClearDecision {
  clearable: boolean;
  /** Entries that are not on the whitelist (the first few are enough for a message). */
  blockers: string[];
}

/** The only stage folders that may exist under the work directory. */
export const patchWorkClearableSubdirs: readonly string[] = [
  patchWorkSubdirs.clips,
  patchWorkSubdirs.merged,
  // A finish job parks its pending deletions here; the kept results go to `losslesscut_finished`.
  ...patchFinishSubdirNames,
];

/**
App-owned folders nested inside a stage folder that may stay behind (fork-owned).

`clips/repairing_tmp` holds the temporary files of "Fix incorrect duration" / "Decimate video".
An emptied folder must not keep the work area from being cleaned up forever (nothing would ever
remove it), so the folder itself is whitelisted - but its **contents are not**: a file inside is
indistinguishable from something the user put there, and the whitelist never risks user data.
*/
const patchWorkClearableNestedDirs: readonly string[] = [
  `${patchWorkSubdirs.clips}/${patchRepairTmpDirName}`,
];

/** The export manifest and its temporary/backup siblings (always in the work directory root). */
const exportManifestFileName = 'export-manifest.json';
const exportManifestBadBackupPattern = /^export-manifest\.json\.bad\.\d+$/;
/**
A temp file of a manifest write. The pid is part of the name since several windows may share the
work area, so one window's interrupted write must not keep the area from being cleaned up.
*/
const exportManifestTempPattern = /^export-manifest\.json(\.\d+)?\.tmp$/;

function nameKey(name: string, caseInsensitive: boolean) {
  return caseInsensitive ? name.toLowerCase() : name;
}

function isWhitelistedManifestFile(name: string, caseInsensitive: boolean) {
  const key = nameKey(name, caseInsensitive);
  return key === exportManifestFileName
    || exportManifestTempPattern.test(key)
    || key === `${exportManifestFileName}.bad`
    || exportManifestBadBackupPattern.test(key);
}

/**
`a\b` -> `a/b`, strip a leading `./` and trailing slashes.

The scanner produces `/` already; this keeps a hand-built entry (or a Windows test) honest.
*/
export function normalizeWorkDirEntryPath(path: string) {
  return path.replaceAll('\\', '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
}

/**
Decide whether the scanned work directory is safe to move to the recycle bin.

Allowed:
- one of the known stage folders, at the top level, as a plain directory (other nested folders
  are not part of the layout and block the cleanup);
- the app's own `clips/repairing_tmp` folder (as a plain directory, empty), because nothing would
  ever remove an emptied temp folder and it must not pin the work area forever;
- the export manifest (and its `.tmp` / `.bad` siblings), at the top level, as a plain file;
- the work-area lock, but only when the caller holds it itself (`ignoreLock`). The finish job takes
  the lock before it runs and clears the work area at its end, so without this its own lock would
  refuse the cleanup it was asked to do. A cleanup that does not hold the lock (the `cewd` command)
  keeps treating it as "another window is using this folder".

Everything else blocks, including an empty file or an empty folder the user created. An empty
list is clearable: the stage folders themselves may be gone.
*/
export function getWorkDirClearDecision({ entries, caseInsensitive, ignoreLock = false }: {
  entries: readonly PatchWorkDirEntry[];
  caseInsensitive: boolean;
  /** The caller holds the work-area lock, so that lock file is its own. */
  ignoreLock?: boolean | undefined;
}): PatchWorkDirClearDecision {
  const allowedSubdirs = new Set(patchWorkClearableSubdirs.map((name) => nameKey(name, caseInsensitive)));
  const allowedNestedDirs = new Set(patchWorkClearableNestedDirs.map((name) => nameKey(name, caseInsensitive)));
  const lockKey = nameKey(patchWorkLockFileName, caseInsensitive);
  const blockers: string[] = [];

  for (const entry of entries) {
    const relative = normalizeWorkDirEntryPath(entry.path);
    const slash = relative.indexOf('/');
    const isTopLevel = slash === -1;
    const name = isTopLevel ? relative : relative.slice(0, slash);
    const allowed = (isTopLevel && (
      (entry.kind === 'directory' && allowedSubdirs.has(nameKey(name, caseInsensitive)))
      || (entry.kind === 'file' && (
        isWhitelistedManifestFile(name, caseInsensitive)
        || (ignoreLock && nameKey(name, caseInsensitive) === lockKey)
      ))
    )) || (!isTopLevel && entry.kind === 'directory' && allowedNestedDirs.has(nameKey(relative, caseInsensitive)));
    if (!allowed) blockers.push(relative);
  }

  return { clearable: blockers.length === 0, blockers };
}

/** Is a work directory path safe to scan/trash? (a real work area, never a root) */
export function isClearableWorkDirPath(path: string, { dirNames = defaultPatchDirNames, caseInsensitive = false }: {
  dirNames?: PatchDirNames | undefined;
  /** Windows/macOS compare folder names case-insensitively. */
  caseInsensitive?: boolean | undefined;
} = {}) {
  const trimmed = path.trim();
  if (trimmed === '') return false;
  const normalized = normalizeWorkDirEntryPath(trimmed);
  if (normalized === '' || normalized === '/' || normalized === '.' || /^[A-Za-z]:$/.test(normalized)) return false;
  // Deep defence: the caller is meant to pass the work area itself (`<root>/<work dir name>`), and
  // trashing its parent would take the whole working directory. Refuse anything else. The default
  // name keeps counting after a rename, so an old work area can still be cleaned up.
  const basename = normalized.split('/').at(-1) ?? '';
  return getRecognizedWorkDirNames(dirNames).some((name) => nameKey(basename, caseInsensitive) === nameKey(name, caseInsensitive));
}
