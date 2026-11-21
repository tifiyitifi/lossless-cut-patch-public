import { normalizePath } from './paths.js';
import compareStrings from '../patchExport/stringOrder.js';

/**
The most recent work roots (pure).

The fork keeps one work area per working directory, and a source without a working directory gets
its work area next to itself. The history therefore becomes a map of where the user has worked;
`open-workpath-list` (`opl`) shows it so the folders can be opened without remembering paths.

Bounded to 1000 roots, newest first. A root is a directory the app created `.losslesscut_work` in,
not the work area itself.
*/

export const patchWorkHistoryVersion = 1;
export const patchWorkHistoryMaxRoots = 1000;

export interface PatchWorkRootRecord {
  /** The directory that contains `.losslesscut_work`. */
  root: string;
  /** Unix milliseconds of the last time a work area was ensured there. */
  lastUsed: number;
}

export interface PatchWorkHistory {
  version: typeof patchWorkHistoryVersion;
  roots: PatchWorkRootRecord[];
}

export function emptyPatchWorkHistory(): PatchWorkHistory {
  return { version: patchWorkHistoryVersion, roots: [] };
}

/** Newest first; ties are alphabetical so the list is stable. */
export function sortWorkRoots(roots: readonly PatchWorkRootRecord[]): PatchWorkRootRecord[] {
  return [...roots].sort((a, b) => (
    b.lastUsed !== a.lastUsed ? b.lastUsed - a.lastUsed : compareStrings(a.root, b.root)
  ));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

/** The key a root is compared with (paths are compared the way the file system does). */
function rootKey(root: string, caseInsensitive: boolean) {
  const normalized = normalizePath(root);
  return caseInsensitive ? normalized.toLowerCase() : normalized;
}

/** Read the stored history, dropping anything malformed. */
export function parsePatchWorkHistory(value: unknown): PatchWorkHistory {
  if (!isRecord(value) || value['version'] !== patchWorkHistoryVersion || !Array.isArray(value['roots'])) return emptyPatchWorkHistory();
  const roots: PatchWorkRootRecord[] = [];
  for (const entry of value['roots']) {
    if (!isRecord(entry)) {
      continue;
    }

    const { root, lastUsed } = entry;
    if (typeof root === 'string' && root.trim() !== '' && typeof lastUsed === 'number' && Number.isFinite(lastUsed)) {
      roots.push({ root, lastUsed });
    }
  }
  return { version: patchWorkHistoryVersion, roots: sortWorkRoots(roots) };
}

/** Record that a work area was used at `root`, keeping the list bounded and duplicate-free. */
export function addWorkRoot(
  history: PatchWorkHistory,
  root: string,
  at: number,
  { caseInsensitive, max = patchWorkHistoryMaxRoots }: { caseInsensitive: boolean, max?: number | undefined },
): PatchWorkHistory {
  const normalizedRoot = normalizePath(root.trim());
  if (root.trim() === '' || normalizedRoot === '.' || normalizedRoot === '/') return history;

  const key = rootKey(normalizedRoot, caseInsensitive);
  const roots = history.roots.filter((entry) => rootKey(entry.root, caseInsensitive) !== key);
  roots.push({ root: normalizedRoot, lastUsed: at });
  return { version: patchWorkHistoryVersion, roots: sortWorkRoots(roots).slice(0, Math.max(1, max)) };
}
