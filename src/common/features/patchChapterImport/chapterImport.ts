/**
What the file-open flow does with a file's embedded chapters (fork-owned).

Upstream asks "This file has embedded chapters. Do you want to import the chapters as
cut-segments?" whenever a file without a project file carries chapters. That question makes sense
for a source about to be cut, but not for the patch result windows:

- The cut results carry the chapter table of the source (`preserveChapters` keeps it), with the
  source's own timestamps - most of them lie outside the clip. Importing them would put spans on
  the result's timeline that mean nothing there.
- The results window has no editable cut list at all (see `patchPlayerDisabledActions`), and the
  merged window already shows its own read-only chapters (`patchMerged/mergedChapters`), which an
  upstream import would fight with.

The same holds for a result opened *read-only in the cutting window* (`resolveReadOnlySourceArea`):
its cutting is disabled, so its source chapters are just as pointless. Base mode is untouched.
*/
import type { EnableImportChapters } from '../../types.js';

/**
Which window a media file is being opened in.

`cutting` is the patch cutting window (the only one that can take chapters as its cut list),
`cut-results` is the results window, `merged` is the merged-result window and `base` is the
upstream app.
*/
export type PatchChapterImportWindow = 'base' | 'cutting' | 'cut-results' | 'merged';

/** What to do with the chapters of the opened file. */
export type PatchChapterImportPlan =
  /** Take the chapters as the cut list without asking. */
  | 'import'
  /** Ask the user first (the upstream dialog). */
  | 'ask'
  /** Leave the file's chapters alone; the cut list stays as it is. */
  | 'skip';

/** The window kind, from the mode props `App` is mounted with. */
export function resolveChapterImportWindow({ patchMode, playerMode, mergedMode }: {
  patchMode: boolean;
  playerMode: boolean;
  mergedMode: boolean;
}): PatchChapterImportWindow {
  if (!patchMode) return 'base';
  if (mergedMode) return 'merged';
  if (playerMode) return 'cut-results';
  return 'cutting';
}

/**
The chapter import to run for a file that was just opened.

`readOnlySource` means the opened file is a patch result (a cut result, the merged result, or a
finished video) opened in the cutting window: that window only offers chapters as a cut list, and
it cannot cut such a file.
*/
export function planEmbeddedChapterImport({
  chapterCount, enableImportChapters, readOnlySource, windowKind,
}: {
  /** The usable chapters the opened file has (`tryMapChaptersToEdl(...).length`). */
  chapterCount: number;
  enableImportChapters: EnableImportChapters;
  readOnlySource: boolean;
  windowKind: PatchChapterImportWindow;
}): PatchChapterImportPlan {
  // No chapters (or none with usable times): nothing to ask about, and the loader refuses an empty list.
  if (chapterCount === 0) return 'skip';
  // The result windows never take the source's chapters: they have no cut list to put them in.
  if (windowKind === 'cut-results' || windowKind === 'merged') return 'skip';
  // A result opened read-only in the cutting window cannot be cut either (base mode has no such state).
  if (windowKind === 'cutting' && readOnlySource) return 'skip';

  if (enableImportChapters === 'always') return 'import';
  if (enableImportChapters === 'ask') return 'ask';
  return 'skip';
}
