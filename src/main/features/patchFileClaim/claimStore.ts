import { mkdir, open, readFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import {
  claimStaleAfterMs, fileClaimFileName, findPathsClaimedElsewhere, isClaimStale, isFileClaimConflict, normalizeClaimPath, parseClaimFile, serializeClaimFile,
} from '../../../common/features/patchFileClaim/index.js';
import type { FileClaim } from '../../../common/features/patchFileClaim/index.js';

/**
Claim files on disk (fork-owned).

Two windows of the app may run (`allowMultipleInstances`) and may share files. Whether a shared
file is refused on open (a source video) or only protected from being moved (a cut result), the
bookkeeping is the same: a tiny pid file per path in a directory of the user's config, taken with
`wx` so two windows cannot both win, and taken over when its owner is gone.

The store is a factory because the app runs two of them - `open-sources` and `open-results` - and
each keeps its own "one claim per window" state: a window holds one source and one playing result.
*/
export interface PatchClaimFsDeps {
  mkdir: (dir: string) => Promise<unknown>;
  openExclusive: (path: string) => Promise<{ write: (text: string) => Promise<unknown>, close: () => Promise<unknown> }>;
  readFile: (path: string) => Promise<string>;
  readdir: (dir: string) => Promise<string[]>;
  unlink: (path: string) => Promise<unknown>;
  isPidAlive: (pid: number) => boolean;
  now: () => number;
  pid: number;
}

export type PatchClaimResult = | { ok: true }
  | { ok: false, reason: 'busy', holder: { path: string, pid: number } }
  | { ok: false, reason: 'error', message: string };

export interface PatchClaimStore {
  /** Claim `path` for this window (releasing the claim it held before: one file per kind). */
  claim: (params: { path: string, claimsDir: string, caseInsensitive: boolean }) => Promise<PatchClaimResult>;
  /** Release every claim this window holds (switching files, closing the app). */
  release: () => Promise<void>;
  /** Remove the claim files of windows that are gone. Returns how many were removed. */
  sweep: (params: { claimsDir: string }) => Promise<number>;
  /**
  Which of `paths` are claimed by *another* live window?

  Reads only the claim files of the paths asked about (the name is a hash of the path), so checking
  a handful of results never lists or parses a directory.
  */
  findClaimedElsewhere: (params: { claimsDir: string, paths: readonly string[], caseInsensitive: boolean }) => Promise<string[]>;
  /** The paths this window claims right now, for tests and diagnostics. */
  heldPaths: () => string[];
}

function errorCode(error: unknown) {
  return (error as { code?: unknown } | undefined)?.code;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isPidAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === 'EPERM';
  }
}

const defaultDeps: PatchClaimFsDeps = {
  mkdir: async (dir) => mkdir(dir, { recursive: true }),
  openExclusive: async (path) => {
    const handle = await open(path, 'wx');
    return {
      write: (text) => handle.writeFile(text, 'utf8'),
      close: () => handle.close(),
    };
  },
  readFile: (path) => readFile(path, 'utf8'),
  readdir: (dir) => readdir(dir),
  unlink: (path) => unlink(path),
  isPidAlive,
  now: Date.now,
  pid: process.pid,
};

/** Read one claim file; `undefined` when it is missing or unusable (both mean "no claim"). */
async function readClaim(claimPath: string, deps: PatchClaimFsDeps): Promise<FileClaim | undefined> {
  try {
    return parseClaimFile(await deps.readFile(claimPath));
  } catch {
    return undefined;
  }
}

export function createPatchClaimStore({ prefix, deps: overrides }: {
  /** The kinds of claim must not collide: `source-<hash>.json` / `result-<hash>.json`. */
  prefix: string;
  deps?: Partial<PatchClaimFsDeps> | undefined;
}): PatchClaimStore {
  const deps = { ...defaultDeps, ...overrides };
  /** The claims this window holds: normalized path -> claim file path. */
  const heldClaims = new Map<string, string>();

  const releaseHeld = async ({ keep }: { keep?: string | undefined } = {}) => {
    const stale = [...heldClaims].filter(([heldPath]) => heldPath !== keep);
    for (const [heldPath, claimPath] of stale) {
      heldClaims.delete(heldPath);
      // Only delete the claim file this process wrote: another window may have taken it over (a pid
      // it read as dead), and removing that file would free the claim of a live window.
      // eslint-disable-next-line no-await-in-loop
      const claim = await readClaim(claimPath, deps);
      if (claim == null || claim.pid === deps.pid) {
        // eslint-disable-next-line no-await-in-loop
        await deps.unlink(claimPath).catch(() => undefined);
      }
    }
  };

  /**
  The claim calls are serialized: "one file per kind" is decided by `releaseHeld`, and two claims
  in flight at once (a fast playlist switch) would otherwise let the older one finish last and keep
  a claim on a file the window no longer plays.
  */
  let claimQueue: Promise<unknown> = Promise.resolve();

  const claimNow = async ({ path, claimsDir, caseInsensitive }: { path: string, claimsDir: string, caseInsensitive: boolean }): Promise<PatchClaimResult> => {
    const normalized = normalizeClaimPath(path, caseInsensitive);
    try {
      await deps.mkdir(claimsDir);
    } catch (error) {
      return { ok: false, reason: 'error', message: errorMessage(error) };
    }

    const claimPath = join(claimsDir, fileClaimFileName({ path, caseInsensitive, prefix }));

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const handle = await deps.openExclusive(claimPath);
        try {
          // eslint-disable-next-line no-await-in-loop
          await handle.write(serializeClaimFile({ pid: deps.pid, startedAt: deps.now(), path: normalized }));
        } finally {
          // eslint-disable-next-line no-await-in-loop
          await handle.close();
        }
        // One file per kind: the previous claim goes away with the new one.
        // eslint-disable-next-line no-await-in-loop
        await releaseHeld({ keep: normalized });
        heldClaims.set(normalized, claimPath);
        return { ok: true };
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') return { ok: false, reason: 'error', message: errorMessage(error) };

        // eslint-disable-next-line no-await-in-loop
        const existing = await readClaim(claimPath, deps);

        if (existing != null && isFileClaimConflict({
          claim: existing,
          path,
          caseInsensitive,
          ownPid: deps.pid,
          alive: deps.isPidAlive(existing.pid),
          now: deps.now(),
          staleMs: claimStaleAfterMs,
        })) {
          return { ok: false, reason: 'busy', holder: { path: existing.path, pid: existing.pid } };
        }

        // Stale, unreadable, ours, or a claim for another file (a hash collision): take it over.
        // eslint-disable-next-line no-await-in-loop
        await deps.unlink(claimPath).catch(() => undefined);
      }
    }

    return { ok: false, reason: 'busy', holder: { path: normalized, pid: 0 } };
  };

  const claim: PatchClaimStore['claim'] = (params) => {
    const run = claimQueue.then(() => claimNow(params));
    // A failed claim must not block the ones queued behind it.
    claimQueue = run.catch(() => undefined);
    return run;
  };

  // Releasing takes the same queue: a release that overtook a claim in flight would leave the claim
  // of a file this window no longer plays behind (see the queue above).
  const release: PatchClaimStore['release'] = () => {
    const run = claimQueue.then(() => releaseHeld());
    claimQueue = run.catch(() => undefined);
    return run;
  };

  const sweep: PatchClaimStore['sweep'] = async ({ claimsDir }) => {
    let names: string[];
    try {
      names = await deps.readdir(claimsDir);
    } catch {
      return 0;
    }

    let removed = 0;
    for (const name of names) {
      if (!name.endsWith('.json')) {
        continue;
      }

      const claimPath = join(claimsDir, name);
      // eslint-disable-next-line no-await-in-loop
      const claimFile = await readClaim(claimPath, deps);
      if (claimFile != null && isClaimStale({ claim: claimFile, alive: deps.isPidAlive(claimFile.pid), now: deps.now() })) {
        // eslint-disable-next-line no-await-in-loop
        await deps.unlink(claimPath).catch(() => undefined);
        removed += 1;
      }
    }
    return removed;
  };

  const findClaimedElsewhere: PatchClaimStore['findClaimedElsewhere'] = async ({ claimsDir, paths, caseInsensitive }) => {
    const now = deps.now();
    const claims = await Promise.all(paths.map(async (path) => {
      const claimPath = join(claimsDir, fileClaimFileName({ path, caseInsensitive, prefix }));
      const claimFile = await readClaim(claimPath, deps);
      // A claim file for a path nobody asked about is impossible here (the name is derived from the
      // path), so a `null` claim only means "the file is gone or damaged" - not in use.
      return claimFile == null ? undefined : { claim: claimFile, alive: deps.isPidAlive(claimFile.pid) };
    }));

    return findPathsClaimedElsewhere({
      claims: claims.filter((entry) => entry != null),
      paths,
      ownPid: deps.pid,
      caseInsensitive,
      now,
    });
  };

  return {
    claim,
    release,
    sweep,
    findClaimedElsewhere,
    heldPaths: () => [...heldClaims.keys()],
  };
}
