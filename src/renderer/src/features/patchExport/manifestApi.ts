import { emptyPatchExportManifest, parsePatchExportManifest } from '../../../../common/features/patchExport';
import type { PatchExportManifest, PatchExportRecordPatch } from '../../../../common/features/patchExport';

/** Read the incremental-export manifest of the patch work area. A failure means "regenerate all". */
export async function readExportManifest(workRoot: string | undefined): Promise<PatchExportManifest> {
  try {
    return parsePatchExportManifest(await window.electron.patchReadExportManifest(workRoot));
  } catch (err) {
    console.error('Failed to read the export manifest', err);
    return emptyPatchExportManifest();
  }
}

/**
Merge one export's record into the manifest. The main process reads the manifest again inside the
write queue, so a rename made in another window meanwhile is not overwritten by this export's
older snapshot.
*/
export function updateExportManifest(workRoot: string | undefined, sourcePath: string, patch: PatchExportRecordPatch) {
  return window.electron.patchUpdateExportManifest(workRoot, sourcePath, patch);
}
