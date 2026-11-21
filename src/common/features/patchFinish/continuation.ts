import type { PatchFinishNextChoice } from './options.js';

/**
What the cutting window does after a finish job (fork-owned, pure).

The old behaviour loaded the next source when the list had one, and otherwise cleared the cutting
window (`resetState`). Patch mode keeps the last source open instead: the user finished watching
it and may still want to change a cut. The window then reloads the moved source without clearing
its segments; replaying after the end starts at the beginning (the player loop).

The decision is a pure function so the "last source" rule is testable: it depends only on the
chosen next option, the next path the batch list resolved, and the paths the job reported.
*/
export type PatchFinishContinuation = | { kind: 'open-next'; path: string }
  | { kind: 'stay'; sourcePath: string; reload: boolean };

export function planFinishContinuation({ next, nextPath, previousSourcePath, newSourcePath, playerReleased }: {
  /** The finish dialog's `next` choice. */
  next: PatchFinishNextChoice;
  /** The next existing batch path, when `next` is `next` and one was found. */
  nextPath: string | undefined;
  /** The source the cutting window had open. */
  previousSourcePath: string;
  /** Where the job moved the source, or `undefined` when it stayed where it was. */
  newSourcePath: string | undefined;
  /** The job released the player to move its file: the window has to attach the video again. */
  playerReleased: boolean;
}): PatchFinishContinuation {
  if (next === 'next' && nextPath != null && nextPath !== previousSourcePath) {
    return { kind: 'open-next', path: nextPath };
  }

  return {
    kind: 'stay',
    sourcePath: newSourcePath ?? previousSourcePath,
    // A moved source needs a new `<video>` URL; a released player needs the same URL attached again.
    reload: newSourcePath != null || playerReleased,
  };
}

/**
What the cutting window does when the job *stopped* (fork-owned, pure).

A stopped job keeps the dialog open so the user can fix the cause and run it again: it never loads
the next source and never clears the editor. The attempt may still have moved the source before it
failed (the video moves first), so the window has to follow it - the batch entry and the player -
or the retry would point at a file that is no longer there.
*/
export interface PatchFinishFailureOutcome {
  /** Where the source video is now: the cutting window has to work on this path from now on. */
  sourcePath: string;
  /** The batch entry to repoint, when the video moved on disk. */
  batch: { from: string; to: string } | undefined;
  /** The video moved: the window must load it from its new path. */
  moved: boolean;
  /** The player has to attach the video again (it moved, or it was released for the attempt). */
  reload: boolean;
}

export function planFinishFailureOutcome({ previousSourcePath, newSourcePath, playerReleased }: {
  /** The source the cutting window had open. */
  previousSourcePath: string;
  /** Where the stopped job moved the source, or `undefined` when it stayed where it was. */
  newSourcePath: string | undefined;
  /** The player was released so the source could move: it is blank now. */
  playerReleased: boolean;
}): PatchFinishFailureOutcome {
  const moved = newSourcePath != null && newSourcePath !== previousSourcePath;
  if (!moved) {
    return {
      sourcePath: previousSourcePath,
      batch: undefined,
      moved: false,
      reload: playerReleased,
    };
  }
  return {
    sourcePath: newSourcePath,
    batch: { from: previousSourcePath, to: newSourcePath },
    moved: true,
    reload: true,
  };
}
