/**
Preview-source / virtual-playlist logic (pure).

The player can show three "views" of the current work:
- `source`: the original file (absolute times, segment marking enabled);
- `cut`:    the cut clips played in sequence;
- `merge`:  the predicted merged video, which until a merge is executed is the same clip
            sequence presented as a single output.

Nothing here touches files: the merge view is virtual (a playlist), as per the design.
*/

export type PatchPlayerView = 'source' | 'cut' | 'merge';

/** Candidate order used by the `V` view switch. */
export const patchPlayerViews: readonly PatchPlayerView[] = ['source', 'cut', 'merge'];

export interface PatchPlaylistEntry {
  /** Absolute path of the media file to play. */
  path: string;
  /** 1-based position in the playlist (for display). */
  index: number;
}

export interface PatchViewState {
  filePath: string | undefined;
  /** Paths produced by the last cut. */
  exportedPaths: readonly string[];
}

/** Views that can actually be shown for the given session state. */
export function availablePatchPlayerViews(state: PatchViewState): PatchPlayerView[] {
  const views: PatchPlayerView[] = [];
  if (state.filePath != null) views.push('source');
  if (state.exportedPaths.length > 0) views.push('cut', 'merge');
  return views;
}

/** Build the sequential playlist for the clip-based views (cut / merge). */
export function buildClipPlaylist(paths: readonly string[]): PatchPlaylistEntry[] {
  return paths.map((path, index) => ({ path, index: index + 1 }));
}

/** Step `direction` through the available views, wrapping around. Returns `current` when none. */
export function stepPatchPlayerView(
  views: readonly PatchPlayerView[],
  current: PatchPlayerView,
  direction: number,
): PatchPlayerView {
  if (views.length === 0) return current;
  const index = views.indexOf(current);
  const from = index === -1 ? 0 : index;
  const next = (from + direction + views.length) % views.length;
  return views[next] ?? current;
}
