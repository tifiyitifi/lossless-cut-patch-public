/**
Which windows pause when one of them starts playing (fork-owned).

Patch mode has four windows that can play video: the cutting window (`source`), the two results
windows (`cut-results`, `merged`) and the check player (`inspect`, the window the detached-source
check opens when a file is double-clicked). Four windows playing at once means four audio tracks at
once, so starting playback pauses the others. Pausing never starts playback anywhere.

The source and the results windows always pause each other. The two results windows are the only
pair the user can let play together (`singleWindowPlayback`), because reviewing a clip and the
merged result side by side is sometimes useful.

The check player is the exception the other way: it is opened to *judge one file*, so it always
pauses everything else and everything else always pauses it - the setting never relaxes it.
*/

/** The four patch windows that can play a video. */
export type PatchPlaybackWindowKind = 'source' | 'cut-results' | 'merged' | 'inspect';

export type PatchResultsWindowKind = Exclude<PatchPlaybackWindowKind, 'source'>;

export interface PatchPlaybackPausePlan {
  /** Pause the source in the cutting window. */
  pauseSource: boolean;
  /** Pause these results windows (never the one that started playing). */
  pauseResults: PatchResultsWindowKind[];
}

/**
What starting playback in `source` pauses.

`singleWindowPlayback` is the setting of the same name (default on). Turning it off only relaxes
the pair of results windows: the cutting window and the results windows still pause each other,
exactly as they did before the setting existed, and the check player is never relaxed.
*/
export function planPlaybackPause({ source, singleWindowPlayback }: {
  source: PatchPlaybackWindowKind;
  singleWindowPlayback: boolean;
}): PatchPlaybackPausePlan {
  if (source === 'source') {
    // The cutting window always silences every other window that can play.
    return { pauseSource: false, pauseResults: ['cut-results', 'merged', 'inspect'] };
  }

  if (source === 'inspect') {
    // The check player plays the file the user is judging: nothing else may speak over it.
    return { pauseSource: true, pauseResults: ['cut-results', 'merged'] };
  }

  if (!singleWindowPlayback) {
    return { pauseSource: true, pauseResults: ['inspect'] };
  }

  return {
    pauseSource: true,
    pauseResults: [source === 'cut-results' ? 'merged' : 'cut-results', 'inspect'],
  };
}
