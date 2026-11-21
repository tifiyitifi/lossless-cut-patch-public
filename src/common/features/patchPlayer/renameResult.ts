import type { FileNameTemplateContext } from '../../userTypes.js';
import { formatEpochMsForFileName } from '../patchData/naming.js';
import type { PatchTemplateNameContext } from './playerMode.js';

/**
The only characters the export keeps in a label.

Kept in sync with `filenamify` in `renderer/src/util.ts` (which cannot be imported here because
it pulls in the Electron bridge).
*/
export function filenamifyResultLabel(label: string) {
  // \p{L}\p{N} are unicode letters and numbers. Keep the hyphen last so it is literal.
  return label.replaceAll(/[^\p{L}\p{N} ._-]/gu, '_');
}

/** Sanitize a label the same way the export does. */
export function sanitizeResultLabel({ label, safeOutputFileName, maxLabelLength }: {
  label: string,
  safeOutputFileName: boolean,
  maxLabelLength: number,
}) {
  const sanitized = safeOutputFileName ? filenamifyResultLabel(label) : label;
  return sanitized.slice(0, Math.max(0, maxLabelLength));
}

/**
The template variables for a result whose label became `label`.

Only the `${}` template context has variables to swap: a result named by the patch `{token}` rule
is re-rendered by `renderRuleCutName` instead (see `cutName.ts`), so this takes the template
variant of the record.

Everything else (times, segment number, epoch, tags, files) stays as it was at export time, so
re-rendering the template only moves the label. `SEG_SUFFIX` falls back to the suffix an empty
label gets, exactly like the export did.
*/
export function applyLabelToNameContext(nameContext: PatchTemplateNameContext, label: string): FileNameTemplateContext {
  const sanitizedLabel = sanitizeResultLabel({
    label,
    safeOutputFileName: nameContext.safeOutputFileName,
    maxLabelLength: nameContext.maxLabelLength,
  });

  return {
    ...nameContext.context,
    // A project written before the readable stamp existed has no value for it; derive it from the
    // epoch the same way the export would, so a template using it keeps working.
    EPOCH_STR: nameContext.context.EPOCH_STR ?? formatEpochMsForFileName(nameContext.context.EPOCH_MS),
    SEG_LABEL: sanitizedLabel,
    SEG_SUFFIX: sanitizedLabel.length > 0 ? `-${sanitizedLabel}` : nameContext.emptyLabelSuffix,
  };
}

/** What is wrong with a hand-typed result file name (fork-owned). */
export type ResultFileNameProblem = | { code: 'empty' }
  | { code: 'invalidChars', invalidChars: string }
  | { code: 'trailing' }
  | { code: 'reserved' }
  | { code: 'tooLong' }
  | { code: 'surroundingWhitespace' };

/** Keep in sync with `maxFileNameLength` in `renderer/src/util/outputNameTemplate`. */
const maxResultFileNameLength = 250;

const windowsReservedName = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;

/**
Validate the file name a user typed for a cut result (`Shift+N`, full rename).

The export template is checked by `getTemplateProblems`; a hand-typed name bypasses that check.
Without this, invalid characters and trailing dots reach the file system and come back as
`EPERM`, which the rename reports as "the file is still in use". A separator is rejected as well:
the name must stay inside the result directory.
*/
export function getResultFileNameProblem(name: string, { isWindows, isMac }: { isWindows: boolean, isMac: boolean }): ResultFileNameProblem | undefined {
  if (name.length === 0) return { code: 'empty' };

  const invalidChars = new Set<string>(['/', '\\']);
  if (isWindows) {
    for (const char of ['<', '>', ':', '"', '|', '?', '*']) invalidChars.add(char);
  } else if (isMac) {
    invalidChars.add(':');
  }

  const found = [...new Set([...name].filter((char) => invalidChars.has(char)))];
  if (found.length > 0) return { code: 'invalidChars', invalidChars: found.join('", "') };

  if (isWindows && /[\s.]$/.test(name)) return { code: 'trailing' };
  if (isWindows && windowsReservedName.test(name)) return { code: 'reserved' };
  if (name.length > maxResultFileNameLength) return { code: 'tooLong' };

  return undefined;
}

/**
What a hand-typed result file name means (fork-owned).

`unchanged` is "nothing to do", `rename` is the new name (without the extension) and `invalid`
is a name the file system would not accept.
*/
export type TypedResultRename = | { kind: 'unchanged' }
  | { kind: 'rename', baseName: string }
  | { kind: 'invalid', problem: ResultFileNameProblem };

/**
The name a hand-typed rename produces (fork-owned).

The rename dialog asks for the name *without* the extension, but users type it anyway: a name
that ends with the extension of the file is stripped, so `clip.mp4` does not become
`clip.mp4.mp4`. Only the extension of the file itself is stripped - a name that ends with
another extension (`clip.v2`) keeps it.

The name is checked as it was typed (a whitespace around it, or a trailing space or dot, is a
mistake the user should see, not something that is trimmed away silently: the file would get
another name than the one the user asked for), and the name that ends up on the disk (the base
name plus the extension) is checked as well.
*/
export function resolveTypedResultRename({ value, currentName, extension, isWindows, isMac }: {
  /** The name the user typed. */
  value: string;
  /** The name of the file without its extension (`clip` for `clip.mp4`). */
  currentName: string;
  /** The extension of the file, including the dot (`.mp4`). */
  extension: string;
  isWindows: boolean;
  isMac: boolean;
}): TypedResultRename {
  const trimmed = value.trim();
  // Nothing to rename: the file keeps its name.
  if (trimmed === '') return { kind: 'unchanged' };

  // The whitespace around the name is a mistake the user should see: trimming it away would rename
  // the file to another name than the one the user asked for.
  if (value !== trimmed) return { kind: 'invalid', problem: { code: 'surroundingWhitespace' } };

  const lowerExtension = extension.toLowerCase();
  const lowerValue = value.toLowerCase();
  // The extension of the file is not part of the name the user types.
  const hasExtension = lowerExtension !== '' && lowerValue.endsWith(lowerExtension);
  const baseName = hasExtension ? value.slice(0, value.length - extension.length) : value;
  // The file keeps its name (an empty base name is the extension alone).
  if (baseName === '' || baseName === currentName) return { kind: 'unchanged' };

  const problem = getResultFileNameProblem(value, { isWindows, isMac });
  if (problem != null) return { kind: 'invalid', problem };

  // The name that ends up on the disk is the base name plus the extension.
  const finalProblem = getResultFileNameProblem(`${baseName}${extension}`, { isWindows, isMac });
  if (finalProblem != null) return { kind: 'invalid', problem: finalProblem };

  return { kind: 'rename', baseName };
}

/**
Windows keeps the playing file locked, so a rename fails until the video has been unloaded.
These are the error codes to retry on (EACCES covers read-only / permission races).
*/
export function isFileLockError(err: unknown) {
  if (typeof err !== 'object' || err == null) return false;
  const { code } = err as { code?: unknown };
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
}
