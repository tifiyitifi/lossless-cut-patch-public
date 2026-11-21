/**
Permanent switch for the two dialogs the combined work-folders dialog replaced.

`PatchWorkPathListDialog` (the work folder history), `ResultsOverviewDialog` (the standalone
results overview) and `PatchResultsOverviewProvider` are kept verbatim and frozen here: they are
never enabled, and the live UI opens `PatchWorkFoldersDialog` (work folders *and* their results in
one list) instead.

Enabling them again means wiring the branches below back:
- `PatchWorkProvider` renders `PatchWorkPathListDialog` when this flag is true;
- `PatchResultsOverviewProvider` only listens to `openPatchResultsOverview` when it is true.

Do not delete the old files: they are the reference for the two lists and may be brought back.
*/
// eslint-disable-next-line import/prefer-default-export -- a named flag documents the intent better
export const patchLegacyDialogsEnabled = false;
