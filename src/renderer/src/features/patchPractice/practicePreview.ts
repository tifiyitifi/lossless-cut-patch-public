/**
Patch-mode preview control used by the practice notes (fork-owned).

The notes pause the preview while they are open, so the user can read them without the video
running away. Before the pending action runs — or when the notes are dismissed — the preview is
put back to the state it had *before* the notes opened, so the action behaves as if the notes had
never paused it (a play/pause action therefore toggles relative to the original state).

`App` builds this from the upstream `useVideo` handles and passes it to the practice layer.
*/
export interface PracticePreviewControl {
  /** Is the preview playing right now? */
  isPlaying: () => boolean;
  /** Pause the preview. No-op when it is already paused or no file is loaded. */
  pause: () => void;
  /** Put the preview back to the state it had before the notes opened. */
  restore: (wasPlaying: boolean) => void;
}
