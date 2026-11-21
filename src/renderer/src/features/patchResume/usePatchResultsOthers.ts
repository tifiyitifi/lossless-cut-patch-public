/* eslint-disable import/prefer-default-export -- the slice index re-exports the named hook */
import { useEffect, useState } from 'react';

import type { PatchCutResultEntry } from '../../../../common/features/patchPlayer';
import { usePatchWork } from '../patchWork/PatchWorkProvider';

/**
Other videos of the work folder for a results window (fork-owned).

The current playlist stays untouched on top; this is the collapsible "others" section below it:
every video file in `clips/` (cut window) or `merged/` (merged window) that the playlist does not
already show. Independent numbering from 1, same numeric sort as the listing.
*/
export function usePatchResultsOthers({ playerMode, mergedMode, entries }: {
  playerMode: boolean,
  mergedMode: boolean,
  entries: readonly PatchCutResultEntry[],
}) {
  const patchWork = usePatchWork();
  const [others, setOthers] = useState<string[]>([]);

  useEffect(() => {
    if (!playerMode) return undefined;
    let cancelled = false;
    (async () => {
      const sourcePath = entries.find((entry) => entry.sourcePath != null)?.sourcePath ?? entries[0]?.path;
      if (sourcePath == null) {
        if (!cancelled) setOthers([]);
        return;
      }
      try {
        const paths = await window.electron.patchListWorkFolderOthers({
          kind: mergedMode ? 'merged' : 'clips',
          workRoot: patchWork?.workRoot,
          sourcePath,
          excludePaths: entries.map((entry) => entry.path),
        });
        if (!cancelled) setOthers(paths);
      } catch (err) {
        console.error('Failed to list other result videos', err);
        if (!cancelled) setOthers([]);
      }
    })();
    return () => { cancelled = true; };
  }, [entries, mergedMode, patchWork?.workRoot, playerMode]);

  return { others };
}
