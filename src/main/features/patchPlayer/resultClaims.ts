import { createPatchClaimStore } from '../patchFileClaim/claimStore.js';
import type { PatchClaimResult } from '../patchFileClaim/claimStore.js';

/**
"This cut result is playing in this window" (fork-owned).

A results window is read-only: it does not write the project file, so two windows may read the
same clip at the same time. What must not happen is another window moving, deleting or
overwriting the file while it plays - a finish job or an incremental export does exactly that, and
on Windows the move fails anyway once the file is open.

So the claim is checked only by the destructive paths (rename, finish, export), never by opening:
refusing to open a file a second window already plays would be needless. The claim lives in
`<config dir>/open-results`, next to the source claims.

There is one claim per results window kind, not one per process: the clips window and the merged
window are separate windows that may both be open, and each plays its own file. The file names
carry the kind (`result-<hash>` / `merged-<hash>`), so the two never overwrite each other, while a
check looks at both - the same clip must be protected whichever window plays it.
*/
export const patchResultClaimsDirName = 'open-results';

export type PatchResultClaimResult = PatchClaimResult;

/** Which results window claims the file. */
export type PatchResultKind = 'cut-results' | 'merged';

const stores = {
  'cut-results': createPatchClaimStore({ prefix: 'result' }),
  merged: createPatchClaimStore({ prefix: 'merged' }),
} as const;

/**
Claim a cut result for this window.

A `busy` answer is not an error here: it means another window already plays this file, which is
fine for reading. The claim is only what the destructive paths consult.
*/
export function claimPatchResultFile({ path, kind, claimsDir, caseInsensitive }: {
  path: string;
  kind: PatchResultKind;
  /** The directory the claim files live in (`<config dir>/open-results`). */
  claimsDir: string;
  caseInsensitive: boolean;
}): Promise<PatchResultClaimResult> {
  return stores[kind].claim({ path, claimsDir, caseInsensitive });
}

/** Release the claim of one results window (it closed). */
export function releasePatchResultClaims(kind: PatchResultKind): Promise<void> {
  return stores[kind].release();
}

/** Release every result claim of this process (the app quits). */
export async function releaseAllPatchResultClaims(): Promise<void> {
  await Promise.all([stores['cut-results'].release(), stores.merged.release()]);
}

/** The paths the given window plays right now, for tests and diagnostics. */
export function getHeldPatchResultClaims(kind: PatchResultKind): string[] {
  return stores[kind].heldPaths();
}

/** Remove the claims of windows that are gone (a crash leaves them behind). */
export async function sweepStalePatchResultClaims({ claimsDir }: { claimsDir: string }): Promise<number> {
  const counts = await Promise.all([stores['cut-results'].sweep({ claimsDir }), stores.merged.sweep({ claimsDir })]);
  return counts[0] + counts[1];
}

/**
Which of these files are being played in another live window?

The caller reads only the claims of the paths it asks about, so an export that overwrites five
results costs a handful of small reads, not a directory listing. The caller's own window is not a
conflict: it may always touch what it plays.
*/
export async function findResultFilesClaimedElsewhere({ claimsDir, paths, caseInsensitive }: {
  claimsDir: string;
  paths: readonly string[];
  caseInsensitive: boolean;
}): Promise<string[]> {
  const found = await Promise.all(Object.values(stores).map((store) => store.findClaimedElsewhere({ claimsDir, paths, caseInsensitive })));
  return [...new Set(found.flat())];
}
