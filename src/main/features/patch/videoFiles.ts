import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { hasPatchMediaExtension } from '../../../common/features/patchData/videoExtensions.js';
import type { PatchVideoFile } from '../../../common/features/patchData/videoFile.js';

/**
List media files in a directory (optionally recursing), sorted naturally by name.
Non-media files are skipped. Entries that cannot be stat'ed get size 0.
*/
// eslint-disable-next-line import/prefer-default-export
export async function listVideoFiles(params: { dir: string, recursive?: boolean }): Promise<PatchVideoFile[]> {
  const { dir, recursive = false } = params;
  const entries = await readdir(dir, { withFileTypes: true });
  const files: PatchVideoFile[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      // eslint-disable-next-line no-await-in-loop
      if (recursive) files.push(...await listVideoFiles({ dir: fullPath, recursive }));
    } else if (entry.isFile() && hasPatchMediaExtension(entry.name)) {
      let size = 0;
      try {
        // eslint-disable-next-line no-await-in-loop
        size = (await stat(fullPath)).size;
      } catch {
        // ignore files we cannot stat (size stays 0)
      }
      files.push({ name: entry.name, path: fullPath, size });
    }
  }

  files.sort((a, b) => a.name.localeCompare(b.name, 'en-US', { numeric: true }));
  return files;
}
