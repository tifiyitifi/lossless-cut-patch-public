/**
The outputs a finished job recorded in a project file (fork-owned, pure).

`patchExport` in a `.llc` file lists what the last finish job left next to the video
(`common/features/patchFinish/exportRecord.ts`). The names are relative to the project file's
folder, which makes them usable for pairing a source with its results without storing anything
else: the project file travels with the video.

Nothing else in the app reads this field back yet, so the parser is deliberately defensive: a
project file is a note, and a malformed block only costs the pairing precision of the results
overview.
*/

export interface PatchProjectOutputs {
  /** Kept cut results (file names). */
  clips: string[];
  /** Merged results (file names). */
  merged: string[];
}

/** One cut result of the record, with the segment it was cut from (when the record has it). */
export interface PatchProjectClipOutput {
  /** The file name, relative to the project file's folder. */
  path: string;
  segId?: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

function parseClipOutputs(value: unknown): PatchProjectClipOutput[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): PatchProjectClipOutput[] => {
    if (!isRecord(entry)) return [];
    const { path, segId } = entry;
    if (typeof path !== 'string' || path.trim() === '') return [];
    return [{ path, ...(typeof segId === 'string' && segId !== '' && { segId }) }];
  });
}

function parseNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): string[] => {
    if (!isRecord(entry)) return [];
    const { path } = entry;
    return typeof path === 'string' && path.trim() !== '' ? [path] : [];
  });
}

/**
The cut results of a `patchExport` block, with their segment (fork-owned).

The finish dialog uses the `segId` to tell a result that already left from one this export cuts
again: the old copy is still in `finished_clips`, but it is not a segment missing from the work
area.
*/
export function parsePatchProjectClipOutputs(value: unknown): PatchProjectClipOutput[] {
  return parseClipOutputs(isRecord(value) ? value['clips'] : undefined);
}

/** Read the `patchExport` block of a project file, or `undefined` when it has none. */
export function parsePatchProjectOutputs(value: unknown): PatchProjectOutputs | undefined {
  if (!isRecord(value)) return undefined;
  const clips = parseClipOutputs(value['clips']).map((clip) => clip.path);
  const merged = parseNames(value['merged']);
  // A finished job moved at least one file; an empty block proves nothing.
  if (clips.length === 0 && merged.length === 0) return undefined;
  return { clips, merged };
}
