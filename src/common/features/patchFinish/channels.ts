import type { PatchFinishFlow } from './flow.js';
import type { PatchFinishModeRequest } from './options.js';

/**
IPC channel: a results window asks the cutting window to open the finish dialog.

The finish job takes the source video away and loads the next file, so it is always run by the
cutting window (the batch list and the player live there). `Shift+E` in a results window is
forwarded through the main process (`patchRequestFinishDialog`).
*/
export const patchFinishDialogRequestChannel = 'patchFinishDialogRequest';

export interface PatchFinishDialogRequest {
  /**
  The dialog the pressed key asks for.

  A results window resolves `auto` itself, from the kind of window the key was pressed in
  (`resolveFinishWindowMode`), so the cutting window opens the job the sender is showing. `auto` only
  arrives from an older window or the HTTP API, and the cutting window then resolves it like its own
  key does.
  */
  mode: PatchFinishModeRequest;
  /**
  The workflow the pressed key asks for. `Shift+F` forwards `keepSource`, or the cutting window
  would open the `Shift+E` dialog (with its own remembered choices) instead.
  */
  flow?: PatchFinishFlow | undefined;
  /** The source the request belongs to, so the cutting window can refuse another file. */
  sourcePath?: string | undefined;
}
