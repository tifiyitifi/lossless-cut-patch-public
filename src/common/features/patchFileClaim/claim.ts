import type { PidLockFile } from '../patchExportLock/pidLock.js';

/**
"Which file is in use in which window" (pure, fork-owned).

Two instances may run (`allowMultipleInstances`). They can share two kinds of files, and a claim
is how each is protected:

- the **source video**: a mark is saved in the project file next to it, so two windows on the
  same video would overwrite each other's project file - the last writer wins and the other
  window's marks are gone. Opening is refused (`open-sources` claims);
- a **cut result** the results window is playing: it is read-only, so two windows may read it at
  the same time - the claim only keeps another window from moving, deleting or overwriting the
  file under a running player (`open-results` claims).

The identity is the normalized path (separators and case, the way the file system compares them)
and the claim file name is a hash of it; the path itself is stored inside the file and compared
on read, so a hash collision between two dead claims cannot refuse a file.
*/

export interface FileClaim extends PidLockFile {
  /** The normalized path this claim is about. */
  path: string;
}

export function normalizeClaimPath(path: string, caseInsensitive: boolean) {
  const normalized = path.replaceAll('\\', '/').replace(/\/+$/, '');
  return caseInsensitive ? normalized.toLowerCase() : normalized;
}

/** FNV-1a over the normalized path, as 16 hex digits. */
function hashPath(normalizedPath: string) {
  const prime = 1099511628211n;
  const mask = 18446744073709551615n;
  let hash = 14695981039346656037n;
  for (let index = 0; index < normalizedPath.length; index += 1) {
    // eslint-disable-next-line no-bitwise
    hash ^= BigInt(normalizedPath.codePointAt(index) ?? 0);
    // eslint-disable-next-line no-bitwise
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

/**
The file name of the claim of one path (`.json` in the claims directory).

The prefix keeps the two kinds apart: a result and a source with the same path would otherwise
share a claim file, and a claim is meant to say *what* is in use.
*/
export function fileClaimFileName({ path, caseInsensitive, prefix }: {
  path: string;
  caseInsensitive: boolean;
  prefix: string;
}) {
  return `${prefix}-${hashPath(normalizeClaimPath(path, caseInsensitive))}.json`;
}

export function parseClaimFile(text: string): FileClaim | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed == null || Array.isArray(parsed)) return undefined;
  const { pid, startedAt, path } = parsed as { pid?: unknown, startedAt?: unknown, path?: unknown };
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0 || typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return undefined;
  if (typeof path !== 'string' || path === '') return undefined;
  return { pid, startedAt, path };
}

export function serializeClaimFile(claim: FileClaim) {
  return JSON.stringify(claim);
}

/**
Does this claim clash with `path`?

Only the same path counts: a claim for another file (another hash, or a hash collision) is not a
conflict. The window's own claim is not a conflict either - reopening the same file in the same
window is what a reload does.
*/
export function isFileClaimConflict({ claim, path, caseInsensitive, ownPid, alive, now, staleMs }: {
  claim: FileClaim;
  path: string;
  caseInsensitive: boolean;
  ownPid: number;
  alive: boolean;
  now: number;
  staleMs: number;
}): boolean {
  if ((claim.pid === ownPid) || (claim.path !== normalizeClaimPath(path, caseInsensitive))) return false;
  if (!alive) return false;
  if (!Number.isFinite(staleMs) || staleMs <= 0) return true;
  return now - claim.startedAt <= staleMs;
}

/**
How long a claim lives before it is taken over even though its pid is alive.

A reused pid is the only way a claim outlives its window, so this is a fallback, not a heartbeat.
*/
export const claimStaleAfterMs = 24 * 60 * 60 * 1000;

/** Did the owner of this claim disappear (or is the claim old enough to be a reused pid)? */
export function isClaimStale({ claim, alive, now }: {
  claim: FileClaim;
  alive: boolean;
  now: number;
}): boolean {
  if (!alive) return true;
  if (!Number.isFinite(claimStaleAfterMs) || claimStaleAfterMs <= 0) return false;
  return now - claim.startedAt > claimStaleAfterMs;
}

/**
Which of `paths` are claimed by another live process?

The caller reads the claims it can find and asks this one question, so the "in use" checks (a
rename, a finish job, an export that would overwrite) all agree on what counts.
*/
export function findPathsClaimedElsewhere({ claims, paths, ownPid, caseInsensitive, now }: {
  /** The claims that could be read, each with whether its owner still runs. */
  claims: readonly { claim: FileClaim, alive: boolean }[];
  /** The paths being checked, in the caller's spelling. */
  paths: readonly string[];
  ownPid: number;
  caseInsensitive: boolean;
  now?: number;
}): string[] {
  const wanted = new Map<string, string>();
  for (const path of paths) wanted.set(normalizeClaimPath(path, caseInsensitive), path);

  const currentTime = now ?? Date.now();
  return claims
    // A claim for a file nobody asked about (the common case: another source's results) is skipped
    // without touching the file system; a claim of this window is not a conflict.
    .filter(({ claim }) => claim.pid !== ownPid && wanted.has(claim.path))
    .filter(({ claim, alive }) => !isClaimStale({ claim, alive, now: currentTime }))
    .map(({ claim }) => wanted.get(claim.path))
    .filter((path): path is string => path != null);
}
