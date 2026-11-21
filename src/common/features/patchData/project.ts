/**
Patch mode data model.

This is the single working format for patch mode. Legacy `src_*.txt` files must be
converted into this model (and back) using `srcTxtConvert`.

Pure logic only (no DOM / Electron / Node APIs) so it can run in any process and be tested.
*/

export const patchProjectVersion = 1;

/** A single cut segment, pulling `[start, end)` (in seconds) out of `file`. */
export interface PatchSegment {
  /** File name (relative to the project's working directory). */
  file: string;
  /** Start time in seconds. */
  start: number;
  /** End time in seconds. */
  end: number;
  /** Optional user label. */
  label?: string | undefined;
}

/**
A group of ordered segments.
`merge: true` mirrors a legacy `< ... >` block and produces one merged output.
`merge: false` means the segments are only cut, not merged.
*/
export interface PatchGroup {
  /** Optional directory marker (legacy `"dirname"` line). */
  dirName?: string | undefined;
  /** Whether this group produces a merged output. */
  merge: boolean;
  /** Ordered segments. */
  segments: PatchSegment[];
}

/** Root project object, serialized as JSON. */
export interface PatchProject {
  version: number;
  /** Project name (e.g. derived from the original `src_<name>.txt`). */
  name?: string | undefined;
  /** Original source txt file name, if this project was imported from one. */
  sourceTxt?: string | undefined;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
  groups: PatchGroup[];
}

export function createEmptyProject(params?: { name?: string | undefined }): PatchProject {
  const now = new Date().toISOString();
  return {
    version: patchProjectVersion,
    name: params?.name,
    createdAt: now,
    updatedAt: now,
    groups: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

function normalizeSegment(value: unknown): PatchSegment | undefined {
  if (!isRecord(value)) return undefined;
  const { file, start, end, label } = value;
  if (typeof file !== 'string' || file.trim() === '' || typeof start !== 'number' || typeof end !== 'number') return undefined;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  return {
    file,
    start,
    end,
    ...((typeof label === 'string') && { label }),
  };
}

function normalizeGroup(value: unknown): PatchGroup | undefined {
  if (!isRecord(value)) return undefined;
  const segmentsRaw = Array.isArray(value['segments']) ? value['segments'] : [];
  const segments = segmentsRaw.map((s) => normalizeSegment(s)).filter((s): s is PatchSegment => s != null);
  const dirName = typeof value['dirName'] === 'string' ? value['dirName'] : undefined;
  const merge = value['merge'] === true;
  return {
    merge,
    segments,
    ...((dirName != null) && { dirName }),
  };
}

/** Validate and normalize an arbitrary value into a `PatchProject`. Throws on structurally invalid input. */
export function normalizePatchProject(value: unknown): PatchProject {
  if (!isRecord(value)) throw new Error('Invalid patch project: expected an object');
  const groupsRaw = value['groups'];
  if (groupsRaw != null && !Array.isArray(groupsRaw)) throw new Error('Invalid patch project: groups must be an array');

  const groups = (Array.isArray(groupsRaw) ? groupsRaw : [])
    .map((g) => normalizeGroup(g))
    .filter((g): g is PatchGroup => g != null);

  const project: PatchProject = {
    version: typeof value['version'] === 'number' ? value['version'] : patchProjectVersion,
    groups,
  };
  if (typeof value['name'] === 'string') project.name = value['name'];
  if (typeof value['sourceTxt'] === 'string') project.sourceTxt = value['sourceTxt'];
  if (typeof value['createdAt'] === 'string') project.createdAt = value['createdAt'];
  if (typeof value['updatedAt'] === 'string') project.updatedAt = value['updatedAt'];
  return project;
}

export function parsePatchProject(text: string): PatchProject {
  return normalizePatchProject(JSON.parse(text) as unknown);
}

export function serializePatchProject(project: PatchProject): string {
  return `${JSON.stringify(project, null, 2)}\n`;
}

/** Total number of segments across all groups. */
export function countSegments(project: PatchProject): number {
  return project.groups.reduce((sum, group) => sum + group.segments.length, 0);
}
