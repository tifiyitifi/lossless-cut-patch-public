/**
What to do when a results window does not finish loading (fork-owned).

The results windows load the same renderer bundle as the cutting window. If that load fails, the
window stays blank and the user cannot tell an empty result list from a broken window - the app
never even mounts, so no React error boundary can help. A load can fail for reasons outside the
app (a corrupt HTTP cache entry in dev, an unreadable install, a renderer crash), so the window
gets one automatic retry and then says so instead of staying blank.
*/
export interface ResultsWindowLoadState {
  /** Did the renderer report that the app is mounted? */
  ready: boolean;
  /** Has the window already been reloaded once? */
  reloaded: boolean;
  /** The user's setting: may a window that did not load be reloaded? */
  reloadEnabled: boolean;
}

/** `none` = it loaded or is still being reported on, `reload` = retry once, `report` = show why. */
export type ResultsWindowLoadAction = 'none' | 'reload' | 'report';

export function decideResultsWindowLoadAction({ ready, reloaded, reloadEnabled }: ResultsWindowLoadState): ResultsWindowLoadAction {
  if (ready) return 'none';
  if (!reloadEnabled || reloaded) return 'report';
  return 'reload';
}
