import { isSamePath } from '../patchFinish/paths.js';

/**
Auto-play after switching the source video (pure, fork-owned).

`Shift+PageUp` / `Shift+PageDown` open the previous / next source *and* start playing it, so a batch
can be walked without a second key. Playback can only start once the new file is loaded, so the
window remembers which file the key asked for and the load event decides.

Comparing the paths instead of carrying a boolean is what keeps a refused or failed open harmless:
that open leaves the old file loaded, its path never matches the request, and the request is
dropped there. A file the user opened another way in the meantime likewise does not match.
*/
export function shouldAutoPlayAfterOpen({ requestedPath, loadedPath, caseInsensitive }: {
  /** The file the key asked for, or `undefined` when no key asked for playback. */
  requestedPath: string | undefined,
  /** The file that finished loading. */
  loadedPath: string | undefined,
  /** Windows ignores case in paths; the caller passes the same flag the rest of the app uses. */
  caseInsensitive: boolean,
}) {
  if (requestedPath == null || loadedPath == null) return false;
  return isSamePath(requestedPath, loadedPath, { caseInsensitive });
}
