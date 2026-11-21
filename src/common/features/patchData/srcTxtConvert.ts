/**
Conversion between the legacy `src_*.txt` format and the patch JSON project.

Legacy format recap:
```
<                          # start of a merge group
"dirname"                  # optional directory marker
:video1.mp4                # current file
010203 010210              # a cut segment (start end)
010300 010305
:video2.mp4
>
```
Lines beginning with `<` / `>` are group markers, `"` is a directory marker, and lines
beginning with `/` `\` `|` are ignored. Blank lines are ignored.
*/

import type { PatchGroup, PatchProject, PatchSegment } from './project.js';
import { patchProjectVersion } from './project.js';
import { formatLegacyTime, parseLegacyTime } from './timeParse.js';

function emptyGroup(merge: boolean): PatchGroup {
  return { merge, segments: [] };
}

function flushGroup(groups: PatchGroup[], current: PatchGroup | undefined) {
  if (current == null) return;
  if (current.segments.length > 0 || current.dirName != null) groups.push(current);
}

/** Parse legacy `src_*.txt` content into a patch project. */
export function srcTxtToProject(text: string, params?: { name?: string | undefined, sourceTxt?: string | undefined }): PatchProject {
  const groups: PatchGroup[] = [];
  let current: PatchGroup | undefined;
  let currentFile: string | undefined;

  const ensureCurrent = () => {
    current ??= emptyGroup(false);
    return current;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (line.startsWith('<')) {
      flushGroup(groups, current);
      current = emptyGroup(true);
    } else if (line.startsWith('>')) {
      flushGroup(groups, current);
      current = undefined;
    } else if (line.startsWith('"')) {
      const dirName = /^"(.*)"$/.exec(line)?.[1];
      if (dirName != null) ensureCurrent().dirName = dirName;
    } else if (line.startsWith(':')) {
      const file = line.slice(1).trim();
      if (file !== '') {
        ensureCurrent();
        currentFile = file;
      }
    } else if (line.startsWith('/') || line.startsWith('\\') || line.startsWith('|')) {
      // ignored comment line
    } else {
      const [startRaw, endRaw, ...rest] = line.split(/\s+/);
      if (rest.length === 0 && startRaw != null && endRaw != null) {
        const start = parseLegacyTime(startRaw);
        const end = parseLegacyTime(endRaw);
        if (start != null && end != null && currentFile != null) {
          ensureCurrent().segments.push({ file: currentFile, start, end });
        }
      }
    }
    // Any other (unrecognized) line is ignored, matching legacy behavior.
  }

  flushGroup(groups, current);

  const now = new Date().toISOString();
  return {
    version: patchProjectVersion,
    groups,
    createdAt: now,
    updatedAt: now,
    ...((params?.name != null) && { name: params.name }),
    ...((params?.sourceTxt != null) && { sourceTxt: params.sourceTxt }),
  };
}

function appendSegments(lines: string[], segments: PatchSegment[]) {
  let previousFile: string | undefined;
  for (const segment of segments) {
    if (segment.file !== previousFile) {
      lines.push(`:${segment.file}`);
      previousFile = segment.file;
    }
    lines.push(`${formatLegacyTime(segment.start)} ${formatLegacyTime(segment.end)}`);
  }
}

/** Serialize a patch project into legacy `src_*.txt` content. */
export function projectToSrcTxt(project: PatchProject): string {
  const lines: string[] = [];
  for (const group of project.groups) {
    if (group.merge) {
      lines.push('<', '');
      if (group.dirName != null) lines.push(`"${group.dirName}"`);
      appendSegments(lines, group.segments);
      lines.push('', '>', '');
    } else {
      if (group.dirName != null) lines.push(`"${group.dirName}"`);
      appendSegments(lines, group.segments);
      lines.push('');
    }
  }
  return lines.join('\n');
}

/** Extract the `<name>` part out of a `src_<name>.txt` file name. */
export function deriveNameFromSrcTxtFileName(fileName: string): string | undefined {
  const match = /^src_(.+)\.[a-zA-Z0-9]+$/.exec(fileName);
  return match?.[1];
}
