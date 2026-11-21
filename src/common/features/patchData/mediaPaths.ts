/**
Which paths patch mode accepts as playable media (pure, so it can be tested).

Patch mode walks the source list one media file at a time, so a file the player cannot open has
no place in that list: opening it would only fail and interrupt the flow. Only paths with a
supported media extension are kept - projects (`.llc`), subtitles, EDL exports, notes, images and
the like are left out.
*/

import { getPathBaseName, hasPatchMediaExtension } from './videoExtensions.js';

export interface PatchMediaPathFilter {
  /** Playable paths, in their original order. */
  media: string[];
  /** Paths left out because they are not playable media, in their original order. */
  skipped: string[];
}

/** Is this path a media file patch mode can play? (Checks the extension only - not the content.) */
export function isPatchMediaPath(path: string): boolean {
  return hasPatchMediaExtension(getPathBaseName(path));
}

/** Split paths into the ones patch mode can play and the ones it leaves out. */
export function filterPatchMediaPaths(paths: readonly string[]): PatchMediaPathFilter {
  const media: string[] = [];
  const skipped: string[] = [];

  for (const path of paths) {
    if (isPatchMediaPath(path)) media.push(path);
    else skipped.push(path);
  }

  return { media, skipped };
}
