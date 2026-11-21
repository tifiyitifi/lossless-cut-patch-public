/**
The "a finish job is already running" refusal (pure).

The job runs in the main process, the toast is shown by the renderer, and Electron's
`ipcRenderer.invoke` only carries an error's **message** across the boundary (a custom `code` or
`reason` property is lost). The refusal therefore travels as a technical marker in the message,
which the renderer recognizes without showing it to the user.
*/

/** Technical marker, not a user-visible string: the renderer translates the toast itself. */
export const patchFinishBusyMarker = 'patch-finish-busy';

/**
Technical marker for "a file this job would move is being played in another window".

Same channel as the busy marker (IPC keeps only the message), so the renderer can turn it into
the same sentence the dialog shows for the `files-in-use` problem.
*/
export const patchFinishFilesInUseMarker = 'patch-finish-files-in-use';

export function isPatchFinishBusyError(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : (typeof error === 'string' ? error : '');
  return message.includes(patchFinishBusyMarker);
}

export function isPatchFinishFilesInUseError(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : (typeof error === 'string' ? error : '');
  return message.includes(patchFinishFilesInUseMarker);
}
