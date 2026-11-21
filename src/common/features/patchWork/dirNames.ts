import { isWindowsReservedName } from '../patchData/mergedName.js';
import { defaultPatchDirNames, defaultPatchFinishedDirName, defaultPatchWorkDirName } from './workDirs.js';
import type { PatchDirNames } from './workDirs.js';

/**
The two configurable folder names (pure).

`.losslesscut_work` and `losslesscut_finished` are only the defaults. The user can rename them in
the working-directory settings (`PatchSettings.workDirName` / `finishedDirName`), because the
folders are visible in the video directory and a naming preference is the user's call.

Two rules keep a rename from breaking an existing work area:
- the **default names keep being recognized** as a work / finished area, so a source that is
  already inside `.losslesscut_work` stays read-only after a rename (and no nested work area is
  created inside it);
- only the **configured names are created**, so the setting really is what new jobs use.

A setting is only ever a *folder name*, not a path: separators and the characters Windows refuses
are rejected instead of being rewritten (a silently changed name would be worse than an error).
*/

/** Why a name cannot be used as a folder. The UI translates the reason. */
export type PatchDirNameProblem = | 'empty'
  | 'path-separator'
  | 'invalid-character'
  | 'trailing-dot-or-space'
  | 'reserved-name'
  | 'too-long';

/** Windows refuses a path component longer than this (UTF-16 code units). */
const maxPatchDirNameLength = 255;

/**
Why this name cannot be a folder name, or `undefined` when it can.

The input is trimmed first, so a name the user padded with spaces is accepted as the trimmed
value (`resolvePatchDirNames` stores the trimmed one).
*/
export function validatePatchDirName(name: string): PatchDirNameProblem | undefined {
  const trimmed = name.trim();
  if (trimmed === '') return 'empty';
  if (trimmed.length > maxPatchDirNameLength) return 'too-long';
  // A folder *name* is one path component. Accepting `a/b` would let the setting point outside the
  // working directory, which the rest of the app does not expect.
  if (/[\\/]/.test(trimmed)) return 'path-separator';
  // Windows refuses these in a file/folder name; the fork only ships Windows builds.
  // eslint-disable-next-line no-control-regex
  if (/[<>:"|?*\u0000-\u001F]/.test(trimmed)) return 'invalid-character';
  // `.` and `..` are directory references, not names.
  if (/^\.+$/.test(trimmed)) return 'invalid-character';
  // Windows strips a trailing dot or space, so `work.` and `work` would be the same folder.
  if (/[. ]$/.test(trimmed)) return 'trailing-dot-or-space';
  if (isWindowsReservedName(trimmed)) return 'reserved-name';
  return undefined;
}

/** Do two names point at the same folder? (Windows/macOS compare case-insensitively.) */
export function samePatchDirName(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function validStoredName(value: string | undefined) {
  if (value == null) return undefined;
  const trimmed = value.trim();
  return trimmed === '' || validatePatchDirName(trimmed) != null ? undefined : trimmed;
}

/**
The names the app should use, from the two stored settings.

A hand-edited setting (or a value saved by an older build) must never break the app: an invalid
name falls back to its default. A name may not be the *other* folder's default either: the
defaults keep being recognized after a rename (see `getRecognizedWorkDirNames`), so using one for
the other role would make one folder a work area and a finished area at once. Such a value falls
back to the default of the role it was meant for, and a remaining collision moves the finished
folder aside (a work area and its finished sibling cannot be the same folder).
*/
export function resolvePatchDirNames({ workDir, finishedDir }: { workDir: string | undefined; finishedDir: string | undefined }): PatchDirNames {
  let work = validStoredName(workDir) ?? defaultPatchWorkDirName;
  let finished = validStoredName(finishedDir) ?? defaultPatchFinishedDirName;
  if (samePatchDirName(work, defaultPatchFinishedDirName)) work = defaultPatchWorkDirName;
  if (samePatchDirName(finished, defaultPatchWorkDirName)) finished = defaultPatchFinishedDirName;
  if (samePatchDirName(work, finished)) finished = defaultPatchFinishedDirName;
  // The configured work name may itself be the default finished name; then the default is still a
  // collision, so take a name that cannot be the work folder.
  if (samePatchDirName(work, finished)) finished = `${defaultPatchFinishedDirName}_2`;
  return { workDir: work, finishedDir: finished };
}

function uniqueNameList(names: readonly string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of names) {
    const trimmed = name.trim();
    const key = trimmed.toLowerCase();
    if (!(key !== '' && !seen.has(key))) {
      continue;
    }

    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

/**
The names a path may use to be recognized as a work area, most specific first.

The configured name always counts; the default keeps counting too, so renaming never turns an
existing work area into "just a folder" (see the module comment).
*/
export function getRecognizedWorkDirNames(dirNames: PatchDirNames = defaultPatchDirNames) {
  return uniqueNameList([dirNames.workDir, defaultPatchWorkDirName]);
}

/** The names a path may use to be recognized as a finished area (configured + default). */
export function getRecognizedFinishedDirNames(dirNames: PatchDirNames = defaultPatchDirNames) {
  return uniqueNameList([dirNames.finishedDir, defaultPatchFinishedDirName]);
}
