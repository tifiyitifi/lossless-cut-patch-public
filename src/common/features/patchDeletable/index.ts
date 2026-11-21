export * from './analysisScope.js';
export * from './checkProgress.js';
export * from './deleteDialogView.js';
export * from './deleteOutcome.js';
export * from './deletable.js';
export * from './grid.js';
export * from './health.js';
export * from './playlist.js';
export * from './rows.js';
export * from './selection.js';

/** Query parameter that marks the detached-source check window (fork-owned). */
export const patchDetachableWindowQueryParam = 'patchDetachableCheck';

/** Query parameter that carries the work root the panel opens for. */
export const patchDetachableRootQueryParam = 'patchDetachableRoot';

/** IPC channel: main -> check panel, "show this work root" (the user opened another folder's check). */
export const patchDetachableRootChannel = 'patch-detachable-root';

/** IPC channel: check panel -> main, "my window is mounted, send me the work root". */
export const patchDetachableReadyChannel = 'patch-detachable-ready';

/** IPC channel: main -> check panel, the progress of a deep decode check. */
export const patchDetachableDeepCheckChannel = 'patch-detachable-deep-check';
