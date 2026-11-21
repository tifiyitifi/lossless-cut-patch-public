/**
A short-lived, per-work-root cache for the results overview (fork-owned).

The overview is a full scan of seven stage folders, the finished-job ledger and one project file per
source. On a work root that is a network share that is seconds of round trips, and several windows
ask for it at the same moment: the work-folders dialog expands a root, the deletion check opens, and
React's StrictMode runs the panel's mount effect twice in development. Building it once per root and
sharing the promise is what keeps those asks from becoming separate scans.

Two rules keep the cache honest:

- a request that is still running is always shared, even for a forced refresh, because a second scan
  in parallel would only add load;
- a finished result is reused for `ttlMs` unless the caller forces a refresh, and a failed scan is
  dropped immediately so the next request retries.

`invalidate` is called when something that the overview describes changed (a delete, a finish job),
so the next reader does not get the old rows. It is keyed like `get`, so the spelling a caller uses
cannot make it miss.
*/

import { normalizeManifestPath } from '../../../common/features/patchExport/manifest.js';

export interface PatchOverviewCacheOptions {
  /** How long a finished scan may be reused, in milliseconds. Defaults to three seconds. */
  ttlMs?: number;
  /** The clock, injectable for tests. */
  now?: () => number;
  /**
  Does the file system treat `C:\work` and `c:\work` as one folder? Windows and macOS do, Linux may
  not, so the caller passes what its path comparisons use.
  */
  caseInsensitive?: boolean;
}

export interface PatchOverviewCache<T> {
  /** The scan of this root; shared while running, reused briefly once finished. */
  get: (root: string | undefined, options?: { force?: boolean } | undefined) => Promise<T>;
  /** Forget one root, so the next request scans again. */
  invalidate: (root: string | undefined) => void;
  /** Forget every root. */
  clear: () => void;
}

interface CacheEntry<T> {
  promise: Promise<T>;
  /** When the scan finished; `undefined` while it is still running. */
  settledAt: number | undefined;
}

const defaultTtlMs = 3000;

export function createPatchOverviewCache<T>(
  build: (root: string | undefined) => Promise<T>,
  options: PatchOverviewCacheOptions = {},
): PatchOverviewCache<T> {
  const ttlMs = options.ttlMs ?? defaultTtlMs;
  const now = options.now ?? Date.now;
  const caseInsensitive = options.caseInsensitive === true;
  const entries = new Map<string, CacheEntry<T>>();

  // `undefined` is a valid root (the first run before a work area exists), so it gets a key too.
  // Everything else is keyed the way the file system compares a folder: the work root reaches this
  // cache from the history, from the cutting window and from a saved setting, so `C:\work`,
  // `C:/work/` and (on Windows) `c:\work` must be one entry - otherwise the same folder is scanned
  // twice, and an `invalidate` written in another spelling would miss the entry it meant.
  const keyOf = (root: string | undefined) => (root == null ? '' : normalizeManifestPath(root, { caseInsensitive }));

  const start = (root: string | undefined) => {
    const key = keyOf(root);
    const entry = { settledAt: undefined } as CacheEntry<T>;
    entries.set(key, entry);
    // The async wrapper keeps a synchronous throw from `build` in the promise, so the entry is
    // removed by the rejection handler below instead of staying half-built.
    entry.promise = (async () => build(root))().then((value) => {
      entry.settledAt = now();
      return value;
    }, (error: unknown) => {
      entries.delete(key);
      throw error;
    });
    return entry.promise;
  };

  return {
    get(root, requestOptions) {
      const key = keyOf(root);
      const existing = entries.get(key);
      if (existing != null) {
        // Running: always share it. Finished: reuse it while it is young, unless the caller asked
        // for a fresh scan (the panel's Refresh button, or a scan after a delete).
        if (existing.settledAt == null) return existing.promise;
        if (requestOptions?.force !== true && now() - existing.settledAt < ttlMs) return existing.promise;
      }
      return start(root);
    },
    invalidate(root) {
      entries.delete(keyOf(root));
    },
    clear() {
      entries.clear();
    },
  };
}
