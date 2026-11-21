// Fork-only: the two IPC channels of the updater's "save before the app closes" handshake.
//
// They live in `common` so the renderer and the main process agree on the names without either one
// owning the other. The updater closes the app, which would throw away an unsaved cut list, so the
// main process asks the renderer for a last save and waits for the answer before quitting.

/** main -> renderer: save what you are working on now. */
export const patchFlushBeforeUpdateChannel = 'patchFlushBeforeUpdate';

/** renderer -> main: the save is done (successfully or not; the reply carries no error). */
export const patchFlushBeforeUpdateDoneChannel = 'patchFlushBeforeUpdateDone';
