import type { PatchFinishDirs, PatchWorkHistory, PatchWorkRootPathInfo, PatchWorkRootsListing } from '../../../common/features/patchFinish/index.js';
import { emptyPatchWorkHistory, isSamePath, normalizePath } from '../../../common/features/patchFinish/index.js';

/**
The rows of `open-workpath-list` (`opl`): every work root, newest first, with the folders the list
can open.

Folders are stat'ed (not created): a missing source folder or work area is shown greyed out
instead of silently creating an empty folder for every root the user ever touched.

`fallbackRoot` is the work root of the current session (see `resolvePatchWorkRoot`). It is shown
first even when it has not reached the history yet, so the list also works before the first
export. It is not duplicated when the history already knows it.
*/

export interface ListPatchWorkRootsDeps {
  getHistory: () => PatchWorkHistory;
  getDirs: (root: string) => PatchFinishDirs | undefined;
  exists: (path: string) => Promise<boolean>;
  fallbackRoot?: string | undefined;
  /** Does the file system of this machine ignore path case? */
  caseInsensitive?: boolean | undefined;
  /**
  The work-history privacy lock is engaged (fork-owned).

  The full history is not read then; only `fallbackRoot` (the work root of the open video) is
  returned. The caller passes no fallback root when no video is open, so a locked history without a
  current video is an empty list. This is deliberately decided here, not in the renderer: the
  dialog, the legacy list and any future caller all go through this function.
  */
  historyLocked?: boolean | undefined;
}

export async function listPatchWorkRoots(deps: ListPatchWorkRootsDeps): Promise<PatchWorkRootsListing> {
  const history = deps.historyLocked === true ? emptyPatchWorkHistory() : deps.getHistory();
  const roots: PatchWorkRootPathInfo[] = [];

  const fallbackRoot = deps.fallbackRoot?.trim();
  const candidates = [...history.roots];
  if (
    fallbackRoot != null
    && fallbackRoot !== ''
    && deps.getDirs(fallbackRoot) != null
    && candidates.every((entry) => !isSamePath(entry.root, fallbackRoot, { caseInsensitive: deps.caseInsensitive ?? false }))
  ) {
    candidates.unshift({ root: fallbackRoot, lastUsed: 0 });
  }

  for (const entry of candidates) {
    const dirs = deps.getDirs(entry.root);
    if (dirs != null) {
      // eslint-disable-next-line no-await-in-loop
      const [rootExists, workDirExists] = await Promise.all([
        deps.exists(entry.root),
        deps.exists(dirs.workDir),
      ]);
      roots.push({
        // The listing is data for the dialog, so it is spelled the way every comparison and the
        // history already spell a path: the work area is built with `node:path.join`, which uses
        // the native separator (`\` on Windows), while the root comes from the history as `/`.
        // Normalizing both here keeps the dialog, its filter and its copied paths consistent; the
        // file-system calls above still use the raw spelling.
        root: normalizePath(entry.root),
        lastUsed: entry.lastUsed,
        workDir: normalizePath(dirs.workDir),
        rootExists,
        workDirExists,
      });
    }
  }

  return { roots };
}
