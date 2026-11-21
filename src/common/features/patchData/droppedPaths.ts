/**
What to do with files / folders dropped onto the video list (pure, so it can be tested).

Dropping a folder means "work on this folder" (patch uses it as the work/output directory, which
also makes the list rescan); dropping media files means "open this file". Markers and unsupported
files are ignored.
*/

import { getPathBaseName, hasPatchMediaExtension } from './videoExtensions.js';

export interface PatchDroppedEntry {
  path: string;
  isDirectory: boolean;
}

export type PatchDropAction = | { kind: 'open-directory', path: string }
  | { kind: 'open-file', path: string }
  | { kind: 'none' };

/** Pick the dropped entry patch should act on: the first folder, else the first media file. */
export function resolvePatchDrop(entries: readonly PatchDroppedEntry[]): PatchDropAction {
  const directory = entries.find((entry) => entry.isDirectory);
  if (directory != null) return { kind: 'open-directory', path: directory.path };

  const mediaFile = entries.find((entry) => hasPatchMediaExtension(getPathBaseName(entry.path)));
  if (mediaFile != null) return { kind: 'open-file', path: mediaFile.path };

  return { kind: 'none' };
}
