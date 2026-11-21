/**
Where the project file (.llc) lives (pure).

The project file follows upstream: the upstream custom output directory when the user set one,
otherwise next to the source video. The patch work area holds the patch results (the cut results
and the merged file) and never the project file, because the project belongs to the media: it
stores the media file name (`mediaFileName`), so it has to travel with the media to be reusable.

Older patch versions wrote the project file into the work area, so the work area is still
searched when looking for an existing project file. Nothing is moved, and nothing new is written
there.
*/
import { getParentPath, getPathFileName, getPathStem, joinPaths, normalizePath } from '../patchFinish/paths.js';

/** Where to look for the project file. */
export interface ProjectFileLookup {
  /**
  The directory to look in before the source video's own folder.

  `undefined` means "the source video's own folder" (the source dir needs its own permission
  handling, so the caller looks there on its own).
  */
  dir: string | undefined;
  /**
  The directory to look in last: the work area of older patch versions.

  It comes last, so that the project file of the current location always wins over a project
  file that an older patch version left behind.
  */
  legacyDir: string | undefined;
}

/**
Where to look for the project file (.llc).

Base mode keeps the upstream behaviour: the working directory (the upstream custom output
directory) first, then the source video's own folder.

Patch mode looks where upstream puts the project file (the upstream custom output directory,
otherwise next to the source video), and the work area only last, for the project files that
older patch versions wrote there.
*/
export function getProjectFileLookup({ patchMode, outDir, upstreamOutDir, workAreaDir }: {
  /** Is patch mode on? */
  patchMode: boolean;
  /** The directory the app writes its output to (the upstream working directory in base mode). */
  outDir: string | undefined;
  /** The upstream custom output directory (the user setting). */
  upstreamOutDir: string | undefined;
  /** The patch work area (the directory the cut results go to). */
  workAreaDir: string | undefined;
}): ProjectFileLookup {
  if (!patchMode) return { dir: outDir, legacyDir: undefined };
  return { dir: upstreamOutDir, legacyDir: workAreaDir };
}

/**
The project file name a video's own name gives (`a.mp4` -> `a.llc`).

Upstream writes `<video>-proj.llc` and only looks for that name when a video is opened. A hand-made
or shared cut list is often named after the video itself, so that shape is read too - but it is
never written (see `shouldSuppressProjectSave`).
*/
export function getVideoNamedProjectFileName(videoPath: string) {
  return `${getPathStem(videoPath)}.llc`;
}

/** One place a video-named project file may be read from. */
export interface VideoNamedProjectFileCandidate {
  path: string;
  /** The file sits in the video's own folder, which needs the user's folder access on macOS. */
  inSourceDir: boolean;
}

/**
Where to look for a `<video>.llc`, in the order it is tried.

The ordinary project location comes first (the working directory, else nothing), then the video's
own folder. A folder that is both is reported once, with the source-dir flag, so the caller never
asks for the same folder access twice.
*/
export function getVideoNamedProjectCandidates({ videoPath, preferredDir, caseInsensitive = false }: {
  videoPath: string;
  /** The working directory (the upstream custom output directory), if one is set. */
  preferredDir: string | undefined;
  caseInsensitive?: boolean | undefined;
}): VideoNamedProjectFileCandidate[] {
  const fileName = getVideoNamedProjectFileName(videoPath);
  // A dot file (`.mp4`) has no stem worth deriving a name from: the project would be `.mp4.llc`,
  // a hidden file nobody wrote on purpose.
  const stem = getPathStem(videoPath);
  if (stem === '' || stem.startsWith('.')) return [];

  const sourcePath = joinPaths(getParentPath(videoPath), fileName);
  const key = (value: string) => {
    const normalized = normalizePath(value);
    return caseInsensitive ? normalized.toLowerCase() : normalized;
  };

  const preferred = preferredDir?.trim();
  if (preferred == null || preferred === '') return [{ path: sourcePath, inSourceDir: true }];
  const preferredPath = joinPaths(preferred, fileName);
  if (key(preferredPath) === key(sourcePath)) return [{ path: sourcePath, inSourceDir: true }];
  return [
    { path: preferredPath, inSourceDir: false },
    { path: sourcePath, inSourceDir: true },
  ];
}

/**
A project file that was read but must not be written back yet (patch-owned).

It is only created when a video is opened and its cut list came from the video-named shape
(`a.llc`), which is the one file the app cannot own: writing `<video>-proj.llc` would create a
second file next to it just because the video was opened.
*/
export interface ProjectSaveSuppression {
  /** The video the held save belongs to. A hold never survives a file switch. */
  filePath: string;
  /** The `.llc` that was loaded instead of `<video>-proj.llc`. */
  projectPath: string;
}

/**
May the first auto-save be held back?

Every condition has to hold, so the hold can only ever skip the save of the content that was just
read from a video-named file:

- a hold exists and belongs to the video being saved (`filePath`);
- that video's file name gives exactly the loaded `.llc` (`a.mp4` -> `a.llc`), so a `-proj.llc` or
  an arbitrary `.llc` opened by hand is never affected;
- the save would go to a *different* file than the one that was read (the whole point is not to
  create that copy);
- the cut list still has the content that was read (the user changed nothing).
*/
export function shouldSuppressProjectSave({ suppression, filePath, projectFileSavePath, segmentsEqual }: {
  suppression: ProjectSaveSuppression | undefined;
  filePath: string | undefined;
  projectFileSavePath: string | undefined;
  /** Are the current cut segments still exactly the loaded ones? */
  segmentsEqual: boolean;
}): boolean {
  if (suppression == null || filePath == null || projectFileSavePath == null) return false;
  if (filePath !== suppression.filePath) return false;
  if (!segmentsEqual) return false;
  if (normalizePath(projectFileSavePath) === normalizePath(suppression.projectPath)) return false;
  return getPathFileName(suppression.projectPath) === getVideoNamedProjectFileName(suppression.filePath);
}
