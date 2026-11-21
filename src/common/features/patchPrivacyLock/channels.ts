/**
IPC channel: the work-history privacy lock changed in the main process (fork-owned).

The idle watcher and the missing-file watcher live in the main process; every open window refreshes
its status when this fires, so the work-folders dialog can collapse or restore the list without a
poll of its own.
*/
// eslint-disable-next-line import/prefer-default-export -- one constant, imported by name on both sides
export const patchPrivacyLockChangedChannel = 'patch-privacy-lock-changed';
