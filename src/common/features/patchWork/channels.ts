/**
IPC channel: a window reports the video it is showing (fork-owned).

The main process builds the native context menu, so it needs the path of the window's current
video to offer "Open the work folder". Every window (cutting, cut results, merged result) sends
it whenever its file changes.
*/
// eslint-disable-next-line import/prefer-default-export -- one constant, imported by name on both sides
export const patchWindowPathChannel = 'patch-set-window-path';
