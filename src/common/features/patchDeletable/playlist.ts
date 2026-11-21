import type { PatchCutResultEntry } from '../patchPlayer/playerMode.js';
import { getPathFileName } from '../patchFinish/paths.js';

import type { PatchDetachableReport } from './rows.js';

/**
The check player's whole playlist (fork-owned, pure).

Double-clicking one file in the check window must not open a one-file player: the question the user
is answering ("is this the source I can delete?") needs the next source and the results between. The
list is therefore the whole check set, in grid order - each source, then its clips, merged and parked
results - grouped by the source so the sidebar can start a header per source.

A result the ledger records but the disk does not have is not a file: it is skipped here as it is
skipped by the grid (see `grid.ts`). Each entry carries the folder it sits in, which the player shows
as a yellow badge; the source entry points at itself.
*/
export function buildPatchDetachPlaylist(report: PatchDetachableReport | undefined): PatchCutResultEntry[] {
  const entries: PatchCutResultEntry[] = [];
  for (const row of report?.rows ?? []) {
    const group = getPathFileName(row.path);
    entries.push({ path: row.path, sourcePath: row.path, group, origin: 'detachedSrc' });
    for (const result of [...row.clips, ...row.merged, ...row.parked]) {
      entries.push({ path: result.path, sourcePath: row.path, group, origin: result.folder });
    }
  }
  return entries;
}
