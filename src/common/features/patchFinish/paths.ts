import type { PatchFinishDateGrouping, PatchFinishMergedChoice, PatchFinishProjectChoice } from './options.js';
import { getRecognizedFinishedDirNames, getRecognizedWorkDirNames } from '../patchWork/dirNames.js';
import { defaultPatchDirNames, resolvePatchWorkRoot } from '../patchWork/workDirs.js';
import type { PatchDirNames } from '../patchWork/workDirs.js';

/**
Path helpers for the finish flow (pure, no node:path).

The paths come from three processes (the manifest, the main process and the renderer), so they are
compared on one normalized spelling: `/` separators, no trailing separator, resolved `.` / `..`
segments. Node accepts `/` on Windows, so a normalized path can still be handed to `node:path`.

Everything here is *string* work: the file system is asked only by the caller (see
`main/features/patchFinish`).
*/

/** Resolve `.` and `..` segments; `floor` is how many leading segments may never be removed. */
function resolveDotSegments(segments: readonly string[], isAbsolute: boolean, floor = 0) {
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') {
      // Nothing to do.
    } else if (segment === '..') {
      const last = resolved.at(-1);
      if (last != null && last !== '..' && resolved.length > floor) resolved.pop();
      else if (!isAbsolute) resolved.push('..');
    } else {
      resolved.push(segment);
    }
  }
  return resolved;
}

/** One spelling every comparison uses: `/` separators, no trailing separator, no dot segments. */
export function normalizePath(path: string) {
  const unified = path.replaceAll('\\', '/');

  // A drive is an anchor: `..` at the root stays at the root, and a bare drive is a root too (the
  // app's folders are absolute, and it is how older versions of the finish flow wrote it).
  if (/^[A-Za-z]:(\/|$)/.test(unified)) {
    const rest = resolveDotSegments(unified.slice(2).split('/'), true).join('/');
    return `${unified.slice(0, 2)}/${rest}`;
  }

  // A UNC path starts with two slashes and both the server and the share are anchors: resolving
  // them as an ordinary absolute path would turn `//server/share` into `/server/share` (a path on
  // the current drive), and `..` must not eat the server (`//server/../x` is `//server/x`).
  if (unified.startsWith('//')) {
    const segments = unified.slice(2).split('/');
    const share = segments[1];
    const floor = share != null && share !== '' && share !== '.' && share !== '..' ? 2 : 1;
    return `//${resolveDotSegments(segments, true, floor).join('/')}`;
  }

  const isAbsolute = unified.startsWith('/');
  const joined = resolveDotSegments(unified.split('/'), isAbsolute).join('/');
  if (isAbsolute) return `/${joined}`;
  return joined.length === 0 ? '.' : joined;
}

/** The parent directory of a normalized (or raw) path, without `node:path`. */
export function getParentPath(path: string) {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf('/');
  if (index === -1) return '.';
  if (index === 0) return '/';
  const parent = normalized.slice(0, index);
  // `C:/a.mp4` -> `C:/`, not `C:` (drive-relative).
  return /^[A-Za-z]:$/.test(parent) ? `${parent}/` : parent;
}

/** `a/b/c.mp4` -> `c.mp4`. */
export function getPathFileName(path: string) {
  const normalized = normalizePath(path);
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

/** `a/b/c.mp4` -> `c` (a dot file keeps its name). */
export function getPathStem(path: string) {
  const name = getPathFileName(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
Join path parts with `/` separators, without touching the drive or a UNC prefix.

Shared code must not use `node:path`, so this is string work. It is only used to build the
project-store folders; every part is either a configured absolute folder or a date segment.
Dot segments are left alone (the file system resolves them), and a leading `//server/share` stays
a UNC path instead of being collapsed.
*/
export function joinPaths(...parts: (string | undefined)[]) {
  const cleaned = parts
    .filter((part): part is string => part != null && part.trim() !== '')
    .map((part) => {
      const unified = part.replaceAll('\\', '/');
      if (/^\/+$/.test(unified)) return '/';
      return unified.replace(/\/+$/, '');
    });
  const [first] = cleaned;
  if (first == null) return '';

  // `C:` alone is drive-relative in node:path. The parts here are configured absolute folders, so
  // a drive root must keep its slash (`C:/`), including when it is the only part.
  let joined = /^[A-Za-z]:$/.test(first) ? `${first}/` : first;
  for (const part of cleaned.slice(1)) {
    const next = part.replace(/^\/+/, '');
    if (next !== '') joined = `${joined.replace(/\/+$/, '')}/${next}`;
  }
  return joined;
}

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

/**
The date folder of a project store, in local time.

`ym` is one level (`2026-10`); `ymd` is two levels (`2026-10/23`), so a busy month stays
browseable without inventing a third level. `none` has no folder of its own (the store is flat),
so it is not a valid grouping here - `resolveProjectTargetDir` skips the folder instead.
*/
export function getProjectDateSubdir(date: Date, grouping: Exclude<PatchFinishDateGrouping, 'none'>) {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const yearMonth = `${year}-${month}`;
  if (grouping === 'ym') return yearMonth;
  return `${yearMonth}/${pad2(date.getDate())}`;
}

/** The base folders a project store can point at. */
export interface PatchFinishProjectStoreDirs {
  /** `<finished area>/finish_llc` (flat). */
  finishLlcDir: string;
  /** `<userData>/llc`. */
  userDataLlcDir: string;
  /** `<installation folder>/llc`. */
  installLlcDir: string;
}

/**
Where the project file goes, before the file name is picked.

`dir: undefined` means "the chosen destination is missing" (the `custom` choice without a folder);
the callers turn that into a problem instead of silently leaving the file behind.
*/
export type PatchFinishProjectTarget = | { kind: 'keep' }
  | { kind: 'follow' }
  | { kind: 'dir'; dir: string | undefined };

/** Resolve the project-file choice into a destination folder (pure, local time). */
export function resolveProjectTargetDir({ choice, projectDir, dateGrouping, stores, now = new Date() }: {
  choice: PatchFinishProjectChoice;
  projectDir: string | undefined;
  /** `none` puts the file directly into the store folder (no date subfolders). */
  dateGrouping: PatchFinishDateGrouping;
  stores: PatchFinishProjectStoreDirs;
  now?: Date;
}): PatchFinishProjectTarget {
  if (choice === 'keep') return { kind: 'keep' };
  if (choice === 'follow') return { kind: 'follow' };
  if (choice === 'finish-llc') return { kind: 'dir', dir: stores.finishLlcDir };

  const base = choice === 'userdata-llc'
    ? stores.userDataLlcDir
    : (choice === 'install-llc' ? stores.installLlcDir : projectDir);
  const trimmedBase = base?.trim();
  if (trimmedBase == null || trimmedBase === '') return { kind: 'dir', dir: undefined };

  const dateSubdir = dateGrouping === 'none' ? undefined : getProjectDateSubdir(now, dateGrouping);
  return { kind: 'dir', dir: joinPaths(trimmedBase, dateSubdir) };
}

/** `a/b/c.mp4` -> `.mp4` (`''` when there is no extension). */
export function getPathExtension(path: string) {
  const name = getPathFileName(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '';
}

/** The suffix a project file next to a video carries. */
const projectFileSuffix = '-proj.llc';

/** The project file name next to a video (`a.mp4` -> `a-proj.llc`). */
export function getProjectFileName(videoPath: string) {
  return `${getPathStem(videoPath)}${projectFileSuffix}`;
}

/** One directory entry, as the project-sidecar sweep sees it. */
export interface ProjectFileEntry {
  name: string;
  kind: 'file' | 'directory' | 'other';
}

/**
The project files (`a-proj.llc`) whose video (`a.*`) is not in the same directory.

The result windows used to write a project file next to the merged video; those files are derived
from the manifest chapters, so one that lost its video is leftovers the app may remove. A
directory or any other entry never counts as the video: only a plain file does.
*/
export function findOrphanProjectFileNames(entries: readonly ProjectFileEntry[], { caseInsensitive }: { caseInsensitive: boolean }): string[] {
  const key = (name: string) => (caseInsensitive ? name.toLowerCase() : name);
  const fileNames = entries.filter((entry) => entry.kind === 'file').map((entry) => key(entry.name));

  return entries
    .filter((entry) => entry.kind === 'file' && key(entry.name).endsWith(projectFileSuffix))
    .filter((entry) => {
      const stem = key(entry.name).slice(0, -projectFileSuffix.length);
      // `a-proj.llc` never matches `a` itself: the sidecar has a hyphen, the video has a dot (or
      // no extension at all).
      return fileNames.every((name) => !(name === stem || name.startsWith(`${stem}.`)));
    })
    .map((entry) => entry.name);
}

function comparable(path: string, caseInsensitive: boolean) {
  const normalized = normalizePath(path);
  return caseInsensitive ? normalized.toLowerCase() : normalized;
}

/** Do two paths name the same file? (the caller says whether the file system ignores case) */
export function isSamePath(a: string, b: string, { caseInsensitive }: { caseInsensitive: boolean }) {
  return comparable(a, caseInsensitive) === comparable(b, caseInsensitive);
}

function pathPrefix(dir: string) {
  return dir.endsWith('/') ? dir : `${dir}/`;
}

/** Is `path` inside `dir` (and not `dir` itself)? */
export function isPathInside(path: string, dir: string, { caseInsensitive }: { caseInsensitive: boolean }) {
  const target = comparable(path, caseInsensitive);
  const parent = comparable(dir, caseInsensitive);
  return target !== parent && target.startsWith(pathPrefix(parent));
}

function findNamedAreaRoot(path: string, dirNames: readonly string[]): string | undefined {
  const normalized = normalizePath(path);
  const segments = normalized.split('/');
  const wanted = new Set(dirNames.map((name) => name.toLowerCase()));
  // The innermost match wins: a work area inside a work area belongs to the inner one.
  let index = -1;
  for (const [current, segment] of segments.entries()) {
    if (wanted.has(segment.toLowerCase())) index = current;
  }
  if (index === -1) return undefined;

  const rootSegments = segments.slice(0, index);
  if (rootSegments.length === 0) return undefined;
  const [first] = rootSegments;
  if (rootSegments.length === 1 && first != null && /^[A-Za-z]:$/.test(first)) return `${first}/`;
  return rootSegments.join('/');
}

/**
The directory that contains the work area the path is in, or `undefined`.

Used to refuse cutting a video that was moved into a work area (a nested work area would be
created under it otherwise). The names are compared case-insensitively: this is a workflow guard,
not a delete gate, and a folder spelled `LOSSLESSCUT_WORK` is the same folder on Windows. Both the
configured name and the default count, so renaming the folder does not expose an old work area.
*/
export function findWorkAreaRoot(path: string, dirNames: PatchDirNames = defaultPatchDirNames): string | undefined {
  return findNamedAreaRoot(path, getRecognizedWorkDirNames(dirNames));
}

/**
The directory that contains the finished area the path is in, or `undefined`.

A kept result lives outside the work area on purpose, so it is *not* "inside a work area" (cutting
it again is fine). It still belongs to the working directory that holds its finished sibling, or
reopening it without a configured working directory would nest a new work area inside the finished
folder. See `resolveWorkRootForPath`.
*/
export function findFinishedAreaRoot(path: string, dirNames: PatchDirNames = defaultPatchDirNames): string | undefined {
  return findNamedAreaRoot(path, getRecognizedFinishedDirNames(dirNames));
}

/** Is the path inside a work area? */
export function isInsideWorkArea(path: string, dirNames: PatchDirNames = defaultPatchDirNames) {
  return findWorkAreaRoot(path, dirNames) != null;
}

/** The areas whose videos the cutting window refuses to cut (fork-owned read-only rule). */
export type PatchReadOnlySourceArea = 'work' | 'finished';

/**
Which read-only area a video is in, if any (fork-owned).

The work area and the finished folder both hold videos the app already produced or collected, so
cutting one there is refused: the work folder would nest, and a finished result would be cut before
the user decided whether to keep it. The work area is checked first, so a work area nested inside a
finished folder still reports the more specific area. The names are the configured ones and the
defaults keep counting, exactly like `findWorkAreaRoot` / `findFinishedAreaRoot`.
*/
export function resolveReadOnlySourceArea(path: string, dirNames: PatchDirNames = defaultPatchDirNames): PatchReadOnlySourceArea | undefined {
  if (findWorkAreaRoot(path, dirNames) != null) return 'work';
  if (findFinishedAreaRoot(path, dirNames) != null) return 'finished';
  return undefined;
}

/**
The work root a video belongs to.

A video inside a work area belongs to the root that contains that work area (reopening a finished
source must not invent a nested one). A kept result inside the finished folder belongs to the
same root for the same reason. Everything else uses the configured working directory, or its own
folder when none is set - exactly how the export resolves it.
*/
export function resolveWorkRootForPath({ path, workRoot, dirNames = defaultPatchDirNames }: { path: string, workRoot: string | undefined, dirNames?: PatchDirNames | undefined }) {
  return findWorkAreaRoot(path, dirNames)
    ?? findFinishedAreaRoot(path, dirNames)
    ?? resolvePatchWorkRoot({ workRoot, sourceDir: getParentPath(path) });
}

/**
The folder the finish summary's "Open the folder" button opens.

The touched folders are in the order the job moved the files, and the job moves the source first -
so on the default choices the list starts with `detached_src_media`, the folder of what the user
just marked for deletion. The button must lead to what was *kept* instead: a folder inside
`losslesscut_finished` wins, then any folder outside the work area (the source folder, a merged
result next to the source), and only when the whole job stayed inside the work area does the first
moved folder stand.
*/
export function pickSummaryFolder({ touchedDirs, dirNames = defaultPatchDirNames }: { touchedDirs: readonly string[], dirNames?: PatchDirNames | undefined }): string | undefined {
  const [first] = touchedDirs;
  if (first == null) return undefined;
  return touchedDirs.find((dir) => findFinishedAreaRoot(dir, dirNames) != null)
    ?? touchedDirs.find((dir) => findWorkAreaRoot(dir, dirNames) == null)
    ?? first;
}

/**
The folders the "open the merged result folder" button may open, in order.

The export manifest knows the merged result of a source exactly, and the finish job keeps that
record current when it moves the file - so its folder wins. When there is no record (a source cut
before the manifest existed, or a hand-cleaned work area), the two folders a merged result is
normally written to follow. The caller opens the first one that exists; a missing folder is not an
error on its own.
*/
export function getMergedResultFolderCandidates({ mergedPath, finishedMergedDir, mergedDir }: {
  /** `merged.path` of the source's export record, when there is one. */
  mergedPath: string | undefined;
  /** `<working directory>/losslesscut_finished/finished_merged`. */
  finishedMergedDir: string | undefined;
  /** `<working directory>/.losslesscut_work/merged`. */
  mergedDir: string | undefined;
}): string[] {
  return [
    mergedPath != null ? getParentPath(mergedPath) : undefined,
    finishedMergedDir,
    mergedDir,
  ].filter((dir): dir is string => dir != null);
}

/**
`a.mp4`, `a (1).mp4`, `a (2).mp4`, ... - the candidate names for a free target.

The caller checks them against the file system. A name that is already in `reserved` is skipped
too, so a move never collides with a file another step of the same job is about to write.
*/
export function* freeNameCandidates(fileName: string) {
  yield fileName;
  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const extension = dot > 0 ? fileName.slice(dot) : '';
  for (let index = 1; index < 10_000; index += 1) {
    yield `${stem} (${index})${extension}`;
  }
}

/** The `.llc` next to a video whose name had to be suffixed: `a (1).mp4` -> `a (1)-proj.llc`. */
export function getMovedProjectName({ fromVideoPath, toVideoPath }: { fromVideoPath: string; toVideoPath: string }) {
  const fromName = getProjectFileName(fromVideoPath);
  const toStem = getPathStem(toVideoPath);
  const fromStem = getPathStem(fromVideoPath);
  const extension = getPathExtension(fromName);
  const suffix = fromName.slice(fromStem.length, fromName.length - extension.length);
  return `${toStem}${suffix}${extension}`;
}

/**
Where a merged result is going, before the free-name suffix is applied.

The dialog shows this so the user can check the name *before* the job runs: `source-rename` gives
the merged result the source video's name, which is the same name the source keeps in
`finished_src_media` - the one thing that made an earlier finish look like a wrong rename.
A name that is already taken gets a ` (n)` suffix at execution time (see `freeNameCandidates`).
*/
export function getMergedTargetPath({ mergedPath, sourcePath, sourceDir, finishedMergedDir, choice }: {
  mergedPath: string;
  sourcePath: string;
  /** The source's folder (where `source` and `source-rename` put the file). */
  sourceDir: string;
  finishedMergedDir: string;
  choice: PatchFinishMergedChoice;
}) {
  const fileName = choice === 'source-rename'
    ? `${getPathStem(sourcePath)}${getPathExtension(mergedPath)}`
    : getPathFileName(mergedPath);
  return joinPaths(choice === 'finished' ? finishedMergedDir : sourceDir, fileName);
}
