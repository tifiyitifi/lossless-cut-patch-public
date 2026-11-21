import type { PatchFinishSourceChoice } from './options.js';

/** The two jobs the finish dialog runs; `discard` has its own dialog (`features/patchDiscard`). */
export type PatchFinishDialogMode = 'merge' | 'cut';

/**
Which title the finish dialog shows (fork-owned, pure).

The title follows the source, not the mode: a job that skips the video does not cut it, so it must
not say `Finish: cut only` - that read as "this video will be cut". The mode still decides the
title when the video is not skipped.

The dialog maps the variant to its translated string itself, so `scan-i18n` still sees the three
keys as literals (a key returned from `common` would be pruned from `locales/en`).
*/
export type PatchFinishDialogTitleVariant = 'skip' | 'merge' | 'cut';

export function getFinishDialogTitleVariant(mode: PatchFinishDialogMode, source: PatchFinishSourceChoice): PatchFinishDialogTitleVariant {
  if (source === 'skip') return 'skip';
  return mode === 'merge' ? 'merge' : 'cut';
}
