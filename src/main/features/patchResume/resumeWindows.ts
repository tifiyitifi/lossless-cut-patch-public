import { buildOtherVideoPaths } from '../../../common/features/patchResume/resumeScan.js';
import type { PatchVideoFile } from '../../../common/features/patchData/videoFile.js';
import logger from '../../logger.js';

export type PatchResultsKind = 'clips' | 'merged';

export interface PatchWorkFolderDeps {
  clipsDir: string | undefined;
  mergedDir: string | undefined;
  listFiles: (dir: string) => Promise<Pick<PatchVideoFile, 'path'>[]>;
  caseInsensitive: boolean;
}

/**
Other videos of a work folder, excluding the current playlist (fork-owned).

The main process lists the folder (numeric sort, shared with the playlist) and drops the paths
the playlist already shows. Missing folders mean "no others", never an error.
*/
export async function listPatchWorkFolderOthers({ kind, excludePaths }: {
  kind: PatchResultsKind,
  excludePaths: readonly string[],
}, { clipsDir, mergedDir, listFiles, caseInsensitive }: PatchWorkFolderDeps): Promise<string[]> {
  const dir = kind === 'clips' ? clipsDir : mergedDir;
  if (dir == null) return [];
  let files: Pick<PatchVideoFile, 'path'>[];
  try {
    files = await listFiles(dir);
  } catch (error) {
    // "No others" is the right answer for the list, but a broken folder is worth a log line.
    logger.warn('Failed to list the work folder', error);
    return [];
  }
  return buildOtherVideoPaths({
    allPaths: files.map((file) => file.path),
    excludePaths,
    caseInsensitive,
  });
}
