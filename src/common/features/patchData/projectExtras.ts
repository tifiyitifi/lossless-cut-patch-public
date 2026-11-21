/**
The top-level fields of a `.llc` project file that this build does not know (pure).

The file is rebuilt from the loaded segments on every save, and the autosave writes once right
after a load, so anything else that was in the file would be lost by the mere act of opening it.
The fork itself writes one such field (`patchExport`, the outputs of the last finished export),
and a newer build may add others, so the writer carries them along:

- `readProjectExtras` takes them from the file that is about to be replaced;
- `buildProjectData` puts them back, in one canonical order, and never lets them override the
  fields that are regenerated from the current state (`version`, `mediaFileName`, `cutSegments`).

Upstream (`JSON5.parse`) ignores unknown top-level fields, so a file carrying them stays readable
by every build - only its own saves drop them, like the comments.
*/
import JSON5 from 'json5';

/** The fields that are always regenerated from the current project state. */
const knownKeys = new Set(['version', 'mediaFileName', 'cutSegments']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

/** The fields of an already parsed project object that are not part of the project itself. */
export function projectExtrasOf(project: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(project)) {
    if (!knownKeys.has(key)) extras[key] = value;
  }
  return extras;
}

/**
The fields of a project file's text that are not part of the project itself.

A file that cannot be parsed carries nothing: it is about to be replaced anyway, and failing the
save over a corrupt leftover would only lose the user's work.
*/
export function readProjectExtras(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON5.parse(text);
  } catch {
    return {};
  }
  return isRecord(parsed) ? projectExtrasOf(parsed) : {};
}

/**
The project object a `.llc` file is rendered from.

The order is fixed - `version`, `mediaFileName`, the carried fields, then `cutSegments` - so the
same project always renders the same text, whichever writer saved it (the renderer's autosave and
the main process's finish flow share this function).
*/
export function buildProjectData({ version, mediaFileName, cutSegments, extras = {} }: {
  version: unknown;
  mediaFileName: unknown;
  cutSegments: unknown;
  /** Fields to carry along; the known ones are ignored (they are regenerated). */
  extras?: Readonly<Record<string, unknown>> | undefined;
}): Record<string, unknown> {
  const project: Record<string, unknown> = {};
  if (version !== undefined) project['version'] = version;
  if (mediaFileName !== undefined) project['mediaFileName'] = mediaFileName;
  // A field that is not serializable would be dropped by the renderer anyway; skipping it here
  // keeps the object equal to what the file carries.
  const carried = Object.entries(extras).filter(([key, value]) => !knownKeys.has(key) && value !== undefined && typeof value !== 'function');
  for (const [key, value] of carried) project[key] = value;
  project['cutSegments'] = cutSegments;
  return project;
}
