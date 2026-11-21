import type { PatchFinishMode } from './options.js';
import type { PatchFinishPreview } from './preview.js';
import { getPathFileName } from './paths.js';

/**
What a finished job left next to the video (pure).

A project file holds the segments, not what was made of them: the same file can be exported as
one clip per segment, or as those clips merged into one. The end of the job (the finish flow) is
the only moment the outputs have their final names, so the job records them in the project file
(`patchExport`) and a human - or a later build - can tell the two apart:

- `clips` non-empty, `merged` empty: one file per segment;
- both non-empty: the cut results were kept next to the merged file;
- `clips` empty, `merged` non-empty: the merged file is all that is left;
- both empty: the job moved nothing (a job that keeps its results in the work area records nothing:
  they are not outputs of a finished project yet).

The names are relative to the project file's folder (the outputs are written next to the video,
and the file itself is normally there too: an archived project keeps readable names, not paths of
a machine that may not exist anymore).
*/
export interface PatchExportClipOutput {
  /** The file name of a kept cut result. */
  path: string;
  /** The segment it was cut from (see the segment's `segId`); missing for an old manifest. */
  segId?: string | undefined;
}

export interface PatchExportMergedOutput {
  /** The file name of a merged result. */
  path: string;
  /** The segments it is made of, in merge order (empty when the merge recorded no chapters). */
  segIds: string[];
}

export interface PatchExportRecord {
  /** How the job treated the segments: cut only, or cut and merged. */
  mode: PatchFinishMode;
  /** The merged results, in the order the job wrote them (one file per merged group). */
  merged: PatchExportMergedOutput[];
  /** The cut results that were kept. */
  clips: PatchExportClipOutput[];
}

/**
The record of one finished job.

Only what the job **moved** is an output: a result it deleted is gone, and one it left in the work
area is not part of the finished project (a stale merged file the user chose to keep, or a clip a
failing step never reached). `undefined` when nothing moved - then there is nothing to record and
no reason to write a project file that does not exist yet.
*/
export function buildPatchExportRecord({ mode, preview, moved }: {
  mode: PatchFinishMode;
  preview: Pick<PatchFinishPreview, 'merged' | 'clips' | 'mergedSegIds'>;
  /** The moves the job performed (`from → to`), so a result is recorded where it ended up. */
  moved: readonly { from: string, to: string }[];
}): PatchExportRecord | undefined {
  // The job moves the paths of the preview itself, so the two spell the same file the same way.
  const movedTo = new Map(moved.map(({ from, to }) => [from, to] as const));

  const clips = preview.clips.flatMap((clip) => {
    const target = movedTo.get(clip.path);
    if (target == null) return [];
    return [{ path: getPathFileName(target), ...((clip.segId != null) && { segId: clip.segId }) }];
  });

  const mergedPath = preview.merged != null ? movedTo.get(preview.merged.path) : undefined;
  const merged = mergedPath != null
    ? [{ path: getPathFileName(mergedPath), segIds: [...(preview.mergedSegIds ?? [])] }]
    : [];

  if (clips.length === 0 && merged.length === 0) return undefined;
  return { mode, merged, clips };
}
