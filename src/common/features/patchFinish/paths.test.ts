// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import {
  findFinishedAreaRoot, findOrphanProjectFileNames, findWorkAreaRoot, freeNameCandidates, getMergedResultFolderCandidates, getMergedTargetPath, getMovedProjectName, getParentPath, getPathExtension, getPathFileName, getPathStem, getProjectDateSubdir,
  getProjectFileName, isInsideWorkArea, isPathInside, isSamePath, joinPaths, normalizePath, pickSummaryFolder, resolveProjectTargetDir, resolveReadOnlySourceArea, resolveWorkRootForPath,
} from './paths.js';

describe('normalizePath', () => {
  it('unifies separators and resolves dot segments', () => {
    expect(normalizePath(String.raw`C:\work\.\a\..\b`)).toBe('C:/work/b');
    expect(normalizePath('/a/./b/../c/')).toBe('/a/c');
  });

  it('keeps a drive root and a UNC share intact', () => {
    expect(normalizePath('C:/')).toBe('C:/');
    expect(normalizePath('C:')).toBe('C:/');
    expect(normalizePath('C:\\')).toBe('C:/');
    expect(normalizePath('//server/share/videos')).toBe('//server/share/videos');
    expect(normalizePath(String.raw`\\server\share\videos`)).toBe('//server/share/videos');
    expect(normalizePath('//server/share/videos/')).toBe('//server/share/videos');
  });

  it('never resolves a dot segment above a drive root or a UNC share', () => {
    expect(normalizePath('C:/../x')).toBe('C:/x');
    expect(normalizePath('C:/work/../../x')).toBe('C:/x');
    expect(normalizePath('//server/../x')).toBe('//server/x');
    expect(normalizePath('//server/share/../x')).toBe('//server/share/x');
    expect(normalizePath('//server/share/../..')).toBe('//server/share');
    expect(normalizePath('/../x')).toBe('/x');
  });
});

describe('path parts', () => {
  it('reads the parent, the file name, the stem and the extension', () => {
    expect(getParentPath(String.raw`C:\work\finished_src_media\a.mp4`)).toBe('C:/work/finished_src_media');
    expect(getParentPath('C:/a.mp4')).toBe('C:/');
    expect(getParentPath('C:/')).toBe('C:/');
    expect(getPathFileName('C:/a/b.mkv')).toBe('b.mkv');
    expect(getPathStem('C:/a/b.mkv')).toBe('b');
    expect(getPathStem('C:/a/.hidden')).toBe('.hidden');
    expect(getPathExtension('C:/a/b.mkv')).toBe('.mkv');
    expect(getPathExtension('C:/a/b')).toBe('');
  });

  it('reads the parent of a file on a UNC share', () => {
    expect(getParentPath('//server/share/videos/a.mp4')).toBe('//server/share/videos');
    expect(getParentPath(String.raw`\\server\share\a.mp4`)).toBe('//server/share');
  });

  it('names the project file the way upstream does', () => {
    expect(getProjectFileName('C:/a/video.mp4')).toBe('video-proj.llc');
    expect(getMovedProjectName({ fromVideoPath: 'C:/a/video.mp4', toVideoPath: 'C:/b/video (1).mp4' })).toBe('video (1)-proj.llc');
  });
});

describe('findOrphanProjectFileNames', () => {
  const entry = (name: string, kind: 'file' | 'directory' = 'file') => ({ name, kind });

  it('keeps a project file whose video is next to it', () => {
    expect(findOrphanProjectFileNames([entry('a.mp4'), entry('a-proj.llc')], { caseInsensitive: false })).toStrictEqual([]);
    expect(findOrphanProjectFileNames([entry('a'), entry('a-proj.llc')], { caseInsensitive: false })).toStrictEqual([]);
  });

  it('finds a project file whose video is gone', () => {
    expect(findOrphanProjectFileNames([entry('a-proj.llc'), entry('b.mkv'), entry('b-proj.llc')], { caseInsensitive: false }))
      .toStrictEqual(['a-proj.llc']);
  });

  it('compares the names the way the file system does', () => {
    expect(findOrphanProjectFileNames([entry('A.MP4'), entry('a-proj.llc')], { caseInsensitive: true })).toStrictEqual([]);
    expect(findOrphanProjectFileNames([entry('A.MP4'), entry('a-proj.llc')], { caseInsensitive: false })).toStrictEqual(['a-proj.llc']);
  });

  it('ignores directories and unrelated files', () => {
    expect(findOrphanProjectFileNames([entry('a-proj', 'directory'), entry('a-proj.llc'), entry('notes.txt')], { caseInsensitive: false }))
      .toStrictEqual(['a-proj.llc']);
  });
});

describe('path comparison', () => {
  it('compares like the file system does when asked to', () => {
    expect(isSamePath(String.raw`C:\work\a.mp4`, 'c:/WORK/a.mp4', { caseInsensitive: true })).toBe(true);
    expect(isSamePath(String.raw`C:\work\a.mp4`, 'c:/WORK/a.mp4', { caseInsensitive: false })).toBe(false);
  });

  it('knows when a path is inside a directory (but not the directory itself)', () => {
    expect(isPathInside('C:/work/.losslesscut_work/clips/a.mp4', 'C:/work/.losslesscut_work/clips', { caseInsensitive: true })).toBe(true);
    expect(isPathInside(String.raw`C:\WORK\.losslesscut_work\clips\a.mp4`, String.raw`C:\work\.losslesscut_work\clips`, { caseInsensitive: true })).toBe(true);
    expect(isPathInside('C:/work/.losslesscut_work/clips', 'C:/work/.losslesscut_work/clips', { caseInsensitive: true })).toBe(false);
    expect(isPathInside('C:/work/.losslesscut_work/clips2/a.mp4', 'C:/work/.losslesscut_work/clips', { caseInsensitive: true })).toBe(false);
    expect(isPathInside('C:/work/a.mp4', 'C:/work', { caseInsensitive: true })).toBe(true);
    expect(isPathInside('//server/share/.losslesscut_work/clips/a.mp4', '//server/share/.losslesscut_work/clips', { caseInsensitive: true })).toBe(true);
  });
});

describe('work area detection', () => {
  it('finds the directory that contains the work area', () => {
    expect(findWorkAreaRoot(String.raw`C:\work\.losslesscut_work\finished_src_media\a.mp4`)).toBe('C:/work');
    expect(findWorkAreaRoot('C:/.losslesscut_work/clips/a.mp4')).toBe('C:/');
    expect(findWorkAreaRoot('/work/.losslesscut_work/clips/a.mp4')).toBe('/work');
    expect(findWorkAreaRoot(String.raw`C:\Work\.LosslessCut_Work\a.mp4`)).toBe('C:/Work');
    expect(findWorkAreaRoot(String.raw`C:\work\a.mp4`)).toBeUndefined();
    // Directories of older versions used the name without the dot; they are not work areas any more.
    expect(findWorkAreaRoot(String.raw`C:\work\losslesscut_work\clips\a.mp4`)).toBeUndefined();
    expect(isInsideWorkArea('C:/work/.losslesscut_work/clips/a.mp4')).toBe(true);
    expect(isInsideWorkArea('C:/work/clips/a.mp4')).toBe(false);
  });

  it('keeps a UNC share as the root of its work area', () => {
    expect(findWorkAreaRoot('//server/share/.losslesscut_work/clips/a.mp4')).toBe('//server/share');
    expect(findWorkAreaRoot(String.raw`\\server\share\.losslesscut_work\clips\a.mp4`)).toBe('//server/share');
    expect(isInsideWorkArea('//server/share/.losslesscut_work/clips/a.mp4')).toBe(true);
  });

  it('uses the configured folder names', () => {
    const dirNames = { workDir: 'work', finishedDir: 'done' };
    expect(findWorkAreaRoot('C:/videos/work/clips/a.mp4', dirNames)).toBe('C:/videos');
    expect(findWorkAreaRoot('C:/videos/done/finished_merged/m.mp4', dirNames)).toBeUndefined();
    expect(findFinishedAreaRoot('C:/videos/done/finished_merged/m.mp4', dirNames)).toBe('C:/videos');
    expect(isInsideWorkArea('C:/videos/work/clips/a.mp4', dirNames)).toBe(true);
    expect(resolveWorkRootForPath({ path: 'C:/videos/work/clips/a.mp4', workRoot: undefined, dirNames })).toBe('C:/videos');
  });

  it('keeps recognizing the default names after a rename', () => {
    const dirNames = { workDir: 'work', finishedDir: 'done' };
    expect(findWorkAreaRoot('C:/videos/.losslesscut_work/clips/a.mp4', dirNames)).toBe('C:/videos');
    expect(findFinishedAreaRoot('C:/videos/losslesscut_finished/finished_src_media/a.mp4', dirNames)).toBe('C:/videos');
    expect(resolveWorkRootForPath({ path: 'C:/videos/.losslesscut_work/clips/a.mp4', workRoot: 'C:/elsewhere', dirNames })).toBe('C:/videos');
  });

  it('takes the innermost work area when they are nested', () => {
    const dirNames = { workDir: 'work', finishedDir: 'done' };
    expect(findWorkAreaRoot('C:/videos/.losslesscut_work/work/clips/a.mp4', dirNames)).toBe('C:/videos/.losslesscut_work');
  });

  it('resolves the work root of a video: the enclosing work area, else the setting or its folder', () => {
    expect(resolveWorkRootForPath({ path: 'C:/work/.losslesscut_work/clips/a.mp4', workRoot: undefined })).toBe('C:/work');
    expect(resolveWorkRootForPath({ path: 'C:/src/a.mp4', workRoot: 'C:/global' })).toBe('C:/global');
    expect(resolveWorkRootForPath({ path: 'C:/src/a.mp4', workRoot: undefined })).toBe('C:/src');
    expect(resolveWorkRootForPath({ path: 'C:/src/a.mp4', workRoot: '  ' })).toBe('C:/src');
    // A source in the root of a drive must not resolve to the drive-relative `C:`.
    expect(resolveWorkRootForPath({ path: 'C:/a.mp4', workRoot: undefined })).toBe('C:/');
    expect(resolveWorkRootForPath({ path: '//server/share/a.mp4', workRoot: undefined })).toBe('//server/share');
  });

  it('does not nest a work area when a finished source is reopened', () => {
    // The real case: a source moved into `finished_src_media` by a finish job. Its root is the one
    // that contains the whole work area, not the folder it was moved into.
    const finishedSource = String.raw`C:\work\inbox\.losslesscut_work\finished_src_media\a.mp4`;
    expect(resolveWorkRootForPath({ path: finishedSource, workRoot: undefined })).toBe('C:/work/inbox');
    // The configured working directory does not win over the enclosing work area either.
    expect(resolveWorkRootForPath({ path: finishedSource, workRoot: 'C:/elsewhere' })).toBe('C:/work/inbox');
  });

  it('treats a kept result in losslesscut_finished as outside the work area, but still owned by that root', () => {
    const kept = String.raw`C:\work\losslesscut_finished\finished_src_media\a.mp4`;
    // It is not inside a work area any more, but the finished folder is read-only on its own.
    expect(isInsideWorkArea(kept)).toBe(false);
    expect(findWorkAreaRoot(kept)).toBeUndefined();
    expect(findFinishedAreaRoot(kept)).toBe('C:/work');
    expect(resolveReadOnlySourceArea(kept)).toBe('finished');
    // Reopening it must not invent a work area inside the finished folder.
    expect(resolveWorkRootForPath({ path: kept, workRoot: undefined })).toBe('C:/work');
    expect(resolveWorkRootForPath({ path: kept, workRoot: 'C:/elsewhere' })).toBe('C:/work');
  });

  it('reports which area makes a video read-only', () => {
    expect(resolveReadOnlySourceArea('C:/videos/.losslesscut_work/clips/a.mp4')).toBe('work');
    expect(resolveReadOnlySourceArea('C:/videos/other/.losslesscut_work/detached_src_media/a.mp4')).toBe('work');
    expect(resolveReadOnlySourceArea('C:/videos/losslesscut_finished/finished_src_media/a.mp4')).toBe('finished');
    expect(resolveReadOnlySourceArea('C:/videos/losslesscut_finished/finished_skip_src/a.mp4')).toBe('finished');
    expect(resolveReadOnlySourceArea('C:/videos/losslesscut_finished/finished_merged/m.mp4')).toBe('finished');
    expect(resolveReadOnlySourceArea('C:/videos/losslesscut_finished/finished_clips/c.mp4')).toBe('finished');
    // The folder names compare case-insensitively (Windows semantics).
    expect(resolveReadOnlySourceArea('C:/videos/LosslessCut_Finished/Finished_Src_Media/a.mp4')).toBe('finished');
    // A plain folder, or a folder that merely starts with the name, is not read-only.
    expect(resolveReadOnlySourceArea('C:/videos/a.mp4')).toBeUndefined();
    expect(resolveReadOnlySourceArea('C:/videos/losslesscut_finished_old/a.mp4')).toBeUndefined();
  });

  it('reports read-only areas with the configured folder names', () => {
    const dirNames = { workDir: 'work', finishedDir: 'done' };
    expect(resolveReadOnlySourceArea('C:/videos/work/clips/a.mp4', dirNames)).toBe('work');
    expect(resolveReadOnlySourceArea('C:/videos/done/finished_clips/c.mp4', dirNames)).toBe('finished');
    // The default names keep counting after a rename.
    expect(resolveReadOnlySourceArea('C:/videos/.losslesscut_work/clips/a.mp4', dirNames)).toBe('work');
    expect(resolveReadOnlySourceArea('C:/videos/losslesscut_finished/finished_merged/m.mp4', dirNames)).toBe('finished');
  });

  it('reports the work area when it is nested inside the finished folder', () => {
    expect(resolveReadOnlySourceArea('C:/videos/losslesscut_finished/.losslesscut_work/clips/a.mp4')).toBe('work');
  });

  it('keeps the finished folder of a UNC share on the share', () => {
    expect(findFinishedAreaRoot('//server/share/losslesscut_finished/finished_merged/m.mp4')).toBe('//server/share');
  });

  it('does not mistake a folder that merely resembles the finished name', () => {
    expect(findFinishedAreaRoot('C:/work/losslesscut_finished_old/a.mp4')).toBeUndefined();
  });
});

describe('pickSummaryFolder', () => {
  const detachedSrc = 'C:/work/.losslesscut_work/detached_src_media';
  const finishedMerged = 'C:/work/losslesscut_finished/finished_merged';
  const finishedSrc = 'C:/work/losslesscut_finished/finished_src_media';

  it('prefers the folder of what the user keeps over the pending deletions', () => {
    // The default merge choices: the source goes to `detached_src_media`, the merged result is kept.
    expect(pickSummaryFolder({ touchedDirs: [detachedSrc, finishedMerged] })).toBe(finishedMerged);
    expect(pickSummaryFolder({ touchedDirs: [detachedSrc, finishedSrc, finishedMerged] })).toBe(finishedSrc);
  });

  it('takes a result next to the source when nothing was kept in losslesscut_finished', () => {
    // Merge into the source folder, the source itself marked for deletion.
    expect(pickSummaryFolder({ touchedDirs: [detachedSrc, 'C:/src'] })).toBe('C:/src');
  });

  it('falls back to the first folder when the whole job stayed inside the work area', () => {
    expect(pickSummaryFolder({ touchedDirs: ['C:/work/.losslesscut_work/detached_clips'] })).toBe('C:/work/.losslesscut_work/detached_clips');
  });

  it('has no folder when nothing was touched', () => {
    expect(pickSummaryFolder({ touchedDirs: [] })).toBeUndefined();
  });
});

describe('freeNameCandidates', () => {
  it('suffixes before the extension', () => {
    const candidates = [...freeNameCandidates('a.tar.gz')].slice(0, 3);
    expect(candidates).toStrictEqual(['a.tar.gz', 'a.tar (1).gz', 'a.tar (2).gz']);
  });
});

describe('getMergedTargetPath', () => {
  const base = {
    mergedPath: 'C:/work/.losslesscut_work/merged/m.mp4',
    sourcePath: 'C:/src/a.mp4',
    sourceDir: 'C:/src',
    finishedMergedDir: 'C:/work/losslesscut_finished/finished_merged',
  };

  it('says where each choice puts the merged result', () => {
    expect(getMergedTargetPath({ ...base, choice: 'finished' })).toBe('C:/work/losslesscut_finished/finished_merged/m.mp4');
    expect(getMergedTargetPath({ ...base, choice: 'source' })).toBe('C:/src/m.mp4');
    expect(getMergedTargetPath({ ...base, choice: 'source-rename' })).toBe('C:/src/a.mp4');
  });

  it('keeps the merged extension when it takes the source name', () => {
    expect(getMergedTargetPath({ ...base, mergedPath: 'C:/merged/m.mkv', choice: 'source-rename' })).toBe('C:/src/a.mkv');
  });
});

describe('getMergedResultFolderCandidates', () => {
  const finishedMergedDir = 'C:/work/losslesscut_finished/finished_merged';
  const mergedDir = 'C:/work/.losslesscut_work/merged';

  it('opens the recorded merged result folder first', () => {
    expect(getMergedResultFolderCandidates({
      mergedPath: 'C:/elsewhere/m.mp4',
      finishedMergedDir,
      mergedDir,
    })).toStrictEqual(['C:/elsewhere', finishedMergedDir, mergedDir]);
  });

  it('falls back to the two standard folders without a record', () => {
    expect(getMergedResultFolderCandidates({ mergedPath: undefined, finishedMergedDir, mergedDir }))
      .toStrictEqual([finishedMergedDir, mergedDir]);
  });

  it('keeps only the folder it knows', () => {
    expect(getMergedResultFolderCandidates({ mergedPath: undefined, finishedMergedDir: undefined, mergedDir }))
      .toStrictEqual([mergedDir]);
    expect(getMergedResultFolderCandidates({ mergedPath: undefined, finishedMergedDir: undefined, mergedDir: undefined }))
      .toStrictEqual([]);
  });
});

describe('project store paths', () => {
  const stores = {
    finishLlcDir: 'C:/work/losslesscut_finished/finish_llc',
    userDataLlcDir: 'C:/Users/u/AppData/Roaming/LosslessCut/llc',
    installLlcDir: 'C:/Apps/LosslessCut/llc',
  };

  it('joins normalized parts without touching the drive or the root', () => {
    expect(joinPaths('C:/a', '2026-10/23')).toBe('C:/a/2026-10/23');
    // eslint-disable-next-line unicorn/prefer-string-raw -- a raw template cannot end in a backslash
    expect(joinPaths('C:\\a\\', '2026-10')).toBe('C:/a/2026-10');
    expect(joinPaths('/', '2026-10')).toBe('/2026-10');
    expect(joinPaths(String.raw`\\server\share`, '2026-10')).toBe('//server/share/2026-10');
    expect(joinPaths('C:/a', undefined, '')).toBe('C:/a');
    // A drive root must stay absolute: `C:` is drive-relative in node:path.
    expect(joinPaths('C:/')).toBe('C:/');
    expect(joinPaths('C:/', '2026-10')).toBe('C:/2026-10');
    expect(joinPaths('C:', '2026-10')).toBe('C:/2026-10');
  });

  it('names the date folders one or two levels deep', () => {
    const date = new Date(2026, 9, 23);
    expect(getProjectDateSubdir(date, 'ym')).toBe('2026-10');
    expect(getProjectDateSubdir(date, 'ymd')).toBe('2026-10/23');
  });

  it('resolves every project choice', () => {
    const now = new Date(2026, 9, 23);
    const resolve = (choice: Parameters<typeof resolveProjectTargetDir>[0]['choice'], overrides: Partial<Parameters<typeof resolveProjectTargetDir>[0]> = {}) => resolveProjectTargetDir({
      choice,
      projectDir: undefined,
      dateGrouping: 'ym',
      stores,
      now,
      ...overrides,
    });

    expect(resolve('keep')).toStrictEqual({ kind: 'keep' });
    expect(resolve('follow')).toStrictEqual({ kind: 'follow' });
    expect(resolve('finish-llc')).toStrictEqual({ kind: 'dir', dir: stores.finishLlcDir });
    expect(resolve('userdata-llc')).toStrictEqual({ kind: 'dir', dir: `${stores.userDataLlcDir}/2026-10` });
    expect(resolve('install-llc', { dateGrouping: 'ymd' })).toStrictEqual({ kind: 'dir', dir: `${stores.installLlcDir}/2026-10/23` });
    expect(resolve('install-llc', { dateGrouping: 'none' })).toStrictEqual({ kind: 'dir', dir: stores.installLlcDir });
    expect(resolve('custom')).toStrictEqual({ kind: 'dir', dir: undefined });
    expect(resolve('custom', { projectDir: String.raw`D:\llc` })).toStrictEqual({ kind: 'dir', dir: 'D:/llc/2026-10' });
  });
});
