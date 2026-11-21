import { createPatchClaimStore } from '../patchFileClaim/claimStore.js';
import type { PatchClaimResult } from '../patchFileClaim/claimStore.js';

/**
The "this video is open in this window" claim (fork-owned).

A mark is saved in the project file next to the video. Two windows on the same video would
overwrite each other's file, so opening a video another live window has open is refused (the
caller shows a warning and does nothing).

The claim is a pid file in the user's config directory (`open-sources`), i.e. it is shared by
every window with the same config - which is exactly the set of windows that would write the same
project file. The file machinery lives in `features/patchFileClaim` (a cut result uses the same
one).
*/
export const patchSourceClaimsDirName = 'open-sources';

export type PatchSourceClaimResult = PatchClaimResult;

const store = createPatchClaimStore({ prefix: 'source' });

/**
Claim a source video for this window.

`busy` means another live window has the same video open: the caller must not open it. A dead
window, a claim file that cannot be read and a claim for another video (a hash collision) are
taken over instead of refusing the open.
*/
export function claimPatchSource({ path, claimsDir, caseInsensitive }: {
  path: string;
  /** The directory the claim files live in (`<config dir>/open-sources`). */
  claimsDir: string;
  caseInsensitive: boolean;
}): Promise<PatchSourceClaimResult> {
  return store.claim({ path, claimsDir, caseInsensitive });
}

/** Release every claim of this process (switching files, closing the app). */
export function releasePatchSourceClaims(): Promise<void> {
  return store.release();
}

/** The path this process claims right now, for tests and diagnostics. */
export function getHeldPatchSourceClaims(): string[] {
  return store.heldPaths();
}

/**
Remove the claims of windows that are gone.

A normal quit releases its claims; a crash leaves them behind, and they would accumulate one file
per video. A claim whose owner is dead (or older than the fallback age) is removed; a live one is
kept, so a running window is never locked out.
*/
export function sweepStalePatchSourceClaims({ claimsDir }: { claimsDir: string }): Promise<number> {
  return store.sweep({ claimsDir });
}
