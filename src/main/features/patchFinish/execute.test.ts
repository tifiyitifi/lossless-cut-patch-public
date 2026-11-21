// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';
import JSON5 from 'json5';
import { dirname, join } from 'node:path';

import type { PatchFinishPreview } from '../../../common/features/patchFinish/index.js';
import { defaultPatchFinishCutOptions, defaultPatchFinishDiscardOptions, defaultPatchFinishMergeOptions, normalizePath } from '../../../common/features/patchFinish/index.js';
import type { LlcTranslate } from '../../../common/features/patchData/llcProjectText.js';
import type { PatchFinishExecuteDeps } from './execute.js';
import { executePatchFinish } from './execute.js';

/** i18next is not initialized in tests; the English key text is the message. */
const translate: LlcTranslate = (key, options) => key.replaceAll(/\{\{(\w+)\}\}/g, (match, name: string) => {
  const value = options?.[name];
  return value == null ? match : String(value);
});

const dirs = {
  workDir: '/work/.losslesscut_work',
  clipsDir: '/work/.losslesscut_work/clips',
  mergedDir: '/work/.losslesscut_work/merged',
  finishedSrcMediaDir: '/work/losslesscut_finished/finished_src_media',
  finishedSkipSrcMediaDir: '/work/losslesscut_finished/finished_skip_src',
  detachedSrcMediaDir: '/work/.losslesscut_work/detached_src_media',
  finishedMergedDir: '/work/losslesscut_finished/finished_merged',
  finishedClipsDir: '/work/losslesscut_finished/finished_clips',
  detachedClipsDir: '/work/.losslesscut_work/detached_clips',
  detachedMergedDir: '/work/.losslesscut_work/detached_merged',
  finishLlcDir: '/work/losslesscut_finished/finish_llc',
};

const projectStores = {
  userDataLlcDir: '/userdata/llc',
  installLlcDir: '/install/llc',
  installLlcWritable: true,
};

const sourcePath = '/src/a.mp4';
const projectPath = '/src/a-proj.llc';
const mergedPath = '/work/.losslesscut_work/merged/m.mp4';
const clip1 = '/work/.losslesscut_work/clips/a-1.mp4';
const clip2 = '/work/.losslesscut_work/clips/a-2.mp4';

function makePreview({ files, source = sourcePath, clips = [clip1, clip2], merged = mergedPath, mergedCoversClips = true, mergedInsideWorkArea = true }: {
  files: readonly string[];
  /** The source the dialog was opened for (a kept source is inside `losslesscut_finished`). */
  source?: string;
  clips?: string[];
  merged?: string | undefined;
  mergedCoversClips?: boolean;
  mergedInsideWorkArea?: boolean;
}): PatchFinishPreview {
  const sizeOf = (path: string) => (files.includes(path) ? 10 : 0);
  const clipRefs = clips.filter((path) => files.includes(path)).map((path) => ({ path, size: 10, mtimeMs: 100 }));
  return {
    mode: 'merge',
    source: { path: source, size: sizeOf(source), exists: files.includes(source), unreadable: false, insideWorkArea: false, dir: dirname(source) },
    projectFile: files.includes(projectPath) ? { path: projectPath } : undefined,
    merged: merged != null && files.includes(merged)
      ? { path: merged, size: 10, mtimeMs: 300 }
      : undefined,
    mergedInsideWorkArea,
    clips: clipRefs,
    clipsTotalSize: clipRefs.reduce((total, clip) => total + clip.size, 0),
    outsideClipCount: 0,
    missingClipCount: 0,
    missingSelectedClipCount: 0,
    filesInUse: [],
    mergedCoversClips,
    hasRecord: true,
    dirs,
    workDirEntries: [],
    workDirScanFailed: false,
    projectStores,
    warnings: mergedCoversClips ? [] : ['merged-stale'],
  };
}

function makeDeps({ files, failRename, failUnlink, caseInsensitive = false, workDirEntries, failTrash }: {
  files: Record<string, string>;
  failRename?: (from: string, to: string) => string | undefined;
  failUnlink?: (path: string) => string | undefined;
  caseInsensitive?: boolean;
  /** Override the scan result (the default derives files from the in-memory store). */
  workDirEntries?: { path: string; kind: 'directory' | 'file' | 'other' }[];
  failTrash?: (path: string) => string | undefined;
}) {
  const keyOf = (path: string) => {
    const normalized = normalizePath(path);
    return caseInsensitive ? normalized.toLowerCase() : normalized;
  };
  const store = new Map(Object.entries(files).map(([path, content]) => [keyOf(path), content]));
  const removed: string[] = [];
  const trashed: string[] = [];
  const codeError = (code: string) => {
    const err = new Error(code) as Error & { code: string };
    err.code = code;
    return err;
  };

  const deps: PatchFinishExecuteDeps = {
    exists: async (path) => store.has(keyOf(path)),
    mkdir: async () => undefined,
    rename: async (from, to) => {
      const failure = failRename?.(from, to);
      if (failure != null) throw codeError(failure);
      const key = keyOf(from);
      const content = store.get(key);
      if (content == null) throw codeError('ENOENT');
      store.set(keyOf(to), content);
      store.delete(key);
    },
    copyFile: async (from, to) => {
      const content = store.get(keyOf(from));
      if (content == null) throw codeError('ENOENT');
      store.set(keyOf(to), content);
    },
    unlink: async (path) => {
      const failure = failUnlink?.(path);
      if (failure != null) throw codeError(failure);
      if (!store.has(keyOf(path))) throw codeError('ENOENT');
      store.delete(keyOf(path));
    },
    readText: async (path) => {
      const content = store.get(keyOf(path));
      if (content == null) throw codeError('ENOENT');
      return content;
    },
    writeText: async (path, text) => {
      store.set(keyOf(path), text);
    },
    removeManifestRecord: async (path) => {
      removed.push(path);
    },
    scanWorkDir: async (dir) => {
      if (workDirEntries != null) return workDirEntries;
      const prefix = `${normalizePath(dir)}/`;
      return [...store.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((key) => ({ path: key.slice(prefix.length), kind: 'file' as const }));
    },
    trashDir: async (dir) => {
      const failure = failTrash?.(dir);
      if (failure != null) throw codeError(failure);
      trashed.push(dir);
    },
    translate,
    caseInsensitive,
    sleep: async () => undefined,
  };

  return { deps, store, removed, trashed };
}

const allFiles = [sourcePath, projectPath, mergedPath, clip1, clip2];

describe('executePatchFinish', () => {
  it('moves the source and its project file, moves the merged result and deletes the cut results', async () => {
    const { deps, store, removed } = makeDeps({ files: Object.fromEntries(allFiles.map((path) => [path, path])) });
    const report = await executePatchFinish({
      params: { sourcePath, workRoot: '/work', projectFilePath: projectPath, mode: 'merge', options: { ...defaultPatchFinishMergeOptions, projectFile: 'follow' } },
      preview: makePreview({ files: allFiles }),
      deps,
    });

    expect(report.ok).toBe(true);
    expect(normalizePath(report.newSourcePath as string)).toBe(normalizePath(join(dirs.detachedSrcMediaDir, 'a.mp4')));
    expect(normalizePath(report.projectMovedTo as string)).toBe(normalizePath(join(dirs.detachedSrcMediaDir, 'a-proj.llc')));
    expect(store.has(normalizePath(join(dirs.finishedMergedDir, 'm.mp4')))).toBe(true);
    expect(store.has(normalizePath(clip1))).toBe(false);
    expect(store.has(normalizePath(clip2))).toBe(false);
    expect(removed).toStrictEqual([sourcePath]);
    expect(report.touchedDirs).toStrictEqual([normalizePath(dirs.detachedSrcMediaDir), normalizePath(dirs.finishedMergedDir)]);
  });

  it('leaves the cut results in the work area and keeps their manifest record', async () => {
    const { deps, store, removed } = makeDeps({ files: Object.fromEntries(allFiles.map((path) => [path, path])) });
    const report = await executePatchFinish({
      params: {
        sourcePath,
        workRoot: '/work',
        projectFilePath: projectPath,
        mode: 'merge',
        options: { ...defaultPatchFinishMergeOptions, source: 'keep', projectFile: 'keep', merged: 'finished', clips: 'keep' },
      },
      preview: makePreview({ files: allFiles }),
      deps,
    });

    expect(report.ok).toBe(true);
    // The merged result leaves; the source, its project file and every cut result stay usable.
    expect(store.has(normalizePath(join(dirs.finishedMergedDir, 'm.mp4')))).toBe(true);
    expect(store.has(normalizePath(sourcePath))).toBe(true);
    expect(store.has(normalizePath(clip1))).toBe(true);
    expect(store.has(normalizePath(clip2))).toBe(true);
    expect(report.deleted).toStrictEqual([]);
    // Losing the record would make the next export cut everything again and hide the kept results
    // from a later finish step.
    expect(removed).toStrictEqual([]);
    expect(report.results.map((result) => result.kind)).toStrictEqual(['merged']);
  });

  it('reports the results with their final paths, and only those', async () => {
    // Merge that keeps the merged result and deletes the cut results: one result, the merged file.
    const merging = makeDeps({ files: Object.fromEntries(allFiles.map((path) => [path, path])) });
    const mergeReport = await executePatchFinish({
      params: { sourcePath, workRoot: '/work', projectFilePath: projectPath, mode: 'merge', options: { ...defaultPatchFinishMergeOptions, source: 'keep', merged: 'finished', clips: 'delete' } },
      preview: makePreview({ files: allFiles }),
      deps: merging.deps,
    });
    expect(mergeReport.ok).toBe(true);
    expect(mergeReport.results.map((result) => ({ path: normalizePath(result.path), kind: result.kind })))
      .toStrictEqual([{ path: normalizePath(join(dirs.finishedMergedDir, 'm.mp4')), kind: 'merged' }]);

    // Cut job that keeps the results: every clip is reported with the name the job gave it.
    const cutting = makeDeps({ files: Object.fromEntries(allFiles.map((path) => [path, path])) });
    const cutReport = await executePatchFinish({
      params: {
        sourcePath,
        workRoot: '/work',
        projectFilePath: projectPath,
        mode: 'cut',
        options: { ...defaultPatchFinishCutOptions, source: 'keep', clips: 'finished', mergedResult: 'keep', projectFile: 'keep' },
        renamePlan: [{ from: clip1, fileName: 'a-clip-1.mp4' }, { from: clip2, fileName: 'a-clip-2.mp4' }],
      },
      preview: { ...makePreview({ files: allFiles }), mode: 'cut' },
      deps: cutting.deps,
    });
    expect(cutReport.ok).toBe(true);
    expect(cutReport.results.map((result) => ({ path: normalizePath(result.path), kind: result.kind }))).toStrictEqual([
      { path: normalizePath(join(dirs.finishedClipsDir, 'a-clip-1.mp4')), kind: 'clip' },
      { path: normalizePath(join(dirs.finishedClipsDir, 'a-clip-2.mp4')), kind: 'clip' },
    ]);
    // The source video and the project file are not results, even when they stay in place.
    const reportedPaths = cutReport.results.map((result) => normalizePath(result.path));
    expect(reportedPaths).not.toContain(normalizePath(sourcePath));
    expect(reportedPaths).not.toContain(normalizePath(projectPath));
  });

  it('moves the cut result project files with their videos and deletes them with them', async () => {
    const clip1Project = `${dirs.clipsDir}/a-1-proj.llc`;
    const clip2Project = `${dirs.clipsDir}/a-2-proj.llc`;
    const files = [...allFiles, clip1Project, clip2Project];

    // Merge that deletes the cut results: their project files go too, so the work area can be cleared.
    const deleting = makeDeps({ files: Object.fromEntries(files.map((path) => [path, path])) });
    const deleteReport = await executePatchFinish({
      params: { sourcePath, workRoot: '/work', projectFilePath: projectPath, mode: 'merge', options: { ...defaultPatchFinishMergeOptions, source: 'keep', merged: 'finished', clips: 'delete' } },
      preview: makePreview({ files }),
      deps: deleting.deps,
    });
    expect(deleteReport.ok).toBe(true);
    expect(deleting.store.has(normalizePath(clip1Project))).toBe(false);
    expect(deleting.store.has(normalizePath(clip2Project))).toBe(false);
    expect(deleteReport.deleted.map((path) => normalizePath(path))).toStrictEqual(expect.arrayContaining([normalizePath(clip1Project), normalizePath(clip2Project)]));

    // Merge that keeps the cut results: the project files follow them to detached_clips.
    const moving = makeDeps({ files: Object.fromEntries(files.map((path) => [path, path])) });
    const moveReport = await executePatchFinish({
      params: { sourcePath, workRoot: '/work', projectFilePath: projectPath, mode: 'merge', options: { ...defaultPatchFinishMergeOptions, source: 'keep', merged: 'finished', clips: 'detached' } },
      preview: makePreview({ files }),
      deps: moving.deps,
    });
    expect(moveReport.ok).toBe(true);
    expect(moving.store.has(normalizePath(`${dirs.detachedClipsDir}/a-1-proj.llc`))).toBe(true);
    expect(moving.store.has(normalizePath(clip1Project))).toBe(false);
  });

  it('sweeps a project file whose video is gone out of the result folders', async () => {
    const orphan = `${dirs.clipsDir}/gone-proj.llc`;
    const files = { [sourcePath]: 'video', [clip1]: 'video', [orphan]: 'project' };
    const { deps, store } = makeDeps({ files });
    const report = await executePatchFinish({
      params: {
        sourcePath,
        workRoot: '/work',
        mode: 'cut',
        options: { ...defaultPatchFinishCutOptions, source: 'keep', clips: 'finished', mergedResult: 'keep', projectFile: 'keep' },
      },
      preview: makePreview({ files: Object.keys(files), clips: [clip1], merged: undefined }),
      deps,
    });

    expect(report.ok).toBe(true);
    expect(store.has(normalizePath(orphan))).toBe(false);
    expect(report.orphanProjectsDeleted.map((path) => normalizePath(path))).toStrictEqual([normalizePath(orphan)]);
    // The result's own project file (when it has one) travels with it, so it is not an orphan.
    expect(report.orphanProjectsDeleted).toHaveLength(1);
  });

  it('renames the cut results while the cut job moves them', async () => {
    const files = {
      ...Object.fromEntries(allFiles.map((path) => [path, path])),
      [projectPath]: JSON5.stringify({ version: 3, mediaFileName: 'a.mp4', cutSegments: [] }),
    };
    const { deps, store } = makeDeps({ files });
    const report = await executePatchFinish({
      params: {
        sourcePath,
        workRoot: '/work',
        projectFilePath: projectPath,
        mode: 'cut',
        options: { ...defaultPatchFinishCutOptions, source: 'keep', clips: 'finished', mergedResult: 'keep', projectFile: 'keep' },
        renamePlan: [
          { from: clip1, fileName: 'a-clip-1.mp4' },
          { from: clip2, fileName: 'a-clip-2.mp4' },
        ],
      },
      preview: { ...makePreview({ files: Object.keys(files) }), mode: 'cut' },
      deps,
    });

    expect(report.ok).toBe(true);
    expect(store.has(normalizePath(join(dirs.finishedClipsDir, 'a-clip-1.mp4')))).toBe(true);
    expect(store.has(normalizePath(join(dirs.finishedClipsDir, 'a-clip-2.mp4')))).toBe(true);
    // The project file records where the results really are, not the names they were cut with.
    const project = JSON5.parse(String(store.get(normalizePath(projectPath)))) as { patchExport: { clips: { path: string }[] } };
    expect(project.patchExport.clips.map((clip) => clip.path)).toStrictEqual(['a-clip-1.mp4', 'a-clip-2.mp4']);
  });

  it('keeps the cut result names in a merge job, whatever the plan says', async () => {
    // A merge moves the cut results aside to delete them: their final names are not a result.
    const { deps, store } = makeDeps({ files: Object.fromEntries(allFiles.map((path) => [path, path])) });
    const report = await executePatchFinish({
      params: {
        sourcePath,
        workRoot: '/work',
        projectFilePath: projectPath,
        mode: 'merge',
        options: { ...defaultPatchFinishMergeOptions, source: 'keep', merged: 'finished', clips: 'detached' },
        renamePlan: [{ from: clip1, fileName: 'a-clip-1.mp4' }],
      },
      preview: makePreview({ files: allFiles }),
      deps,
    });

    expect(report.ok).toBe(true);
    expect(store.has(normalizePath(join(dirs.detachedClipsDir, 'a-1.mp4')))).toBe(true);
    expect(store.has(normalizePath(join(dirs.detachedClipsDir, 'a-clip-1.mp4')))).toBe(false);
  });

  it('ignores a planned name that would move a result out of its folder', async () => {
    const { deps, store } = makeDeps({ files: Object.fromEntries(allFiles.map((path) => [path, path])) });
    const report = await executePatchFinish({
      params: {
        sourcePath,
        workRoot: '/work',
        projectFilePath: projectPath,
        mode: 'cut',
        options: { ...defaultPatchFinishCutOptions, source: 'keep', clips: 'finished', mergedResult: 'keep', projectFile: 'keep' },
        renamePlan: [
          { from: clip1, fileName: '../../escape.mp4' },
          { from: clip2, fileName: 'a-clip-2.mp4' },
        ],
      },
      preview: { ...makePreview({ files: allFiles }), mode: 'cut' },
      deps,
    });

    expect(report.ok).toBe(true);
    expect(store.has(normalizePath(join(dirs.finishedClipsDir, 'a-1.mp4')))).toBe(true);
    expect(store.has(normalizePath(join(dirs.finishedClipsDir, 'a-clip-2.mp4')))).toBe(true);
  });

  it('moves the source first and lets the merged result take its name and folder', async () => {
    const { deps, store } = makeDeps({ files: Object.fromEntries(allFiles.map((path) => [path, path])) });
    const report = await executePatchFinish({
      params: {
        sourcePath,
        workRoot: '/work',
        projectFilePath: projectPath,
        mode: 'merge',
        options: { ...defaultPatchFinishMergeOptions, source: 'keep', merged: 'source-rename' },
      },
      preview: makePreview({ files: allFiles }),
      deps,
    });

    expect(report.ok).toBe(true);
    // The source is forced to finished_src_media, even though the options said keep.
    expect(store.has(normalizePath(`${dirs.finishedSrcMediaDir}/a.mp4`))).toBe(true);
    expect(store.get(normalizePath('/src/a.mp4'))).toBe(mergedPath);
    expect(store.has(normalizePath(mergedPath))).toBe(false);
  });

  it('does not rename a source that is already kept in finished_src_media', async () => {
    // Reopening a kept source and finishing it with the same choice: the target is the file itself.
    // Reserving a name there would "move" it onto `a (1).mp4` even though nothing has to move.
    const kept = `${dirs.finishedSrcMediaDir}/a.mp4`;
    const files = [kept];
    const { deps, store } = makeDeps({ files: Object.fromEntries(files.map((path) => [path, `content:${path}`])) });
    const report = await executePatchFinish({
      params: { sourcePath: kept, workRoot: '/work', mode: 'cut', options: { ...defaultPatchFinishCutOptions, source: 'finished' } },
      preview: { ...makePreview({ files, source: kept, clips: [], merged: undefined }), mode: 'cut' },
      deps,
    });

    expect(report.ok).toBe(true);
    expect(store.get(normalizePath(kept))).toBe(`content:${kept}`);
    expect(store.has(normalizePath(`${dirs.finishedSrcMediaDir}/a (1).mp4`))).toBe(false);
    // Nothing moved, so the summary must not claim a move (or offer a folder).
    expect(report.moved).toStrictEqual([]);
    expect(report.touchedDirs).toStrictEqual([]);
  });

  it('moves a skipped source to finished_skip_src with its project file', async () => {
    const files = [sourcePath, projectPath];
    const { deps, store } = makeDeps({ files: Object.fromEntries(files.map((path) => [path, `content:${path}`])) });
    const report = await executePatchFinish({
      params: { sourcePath, workRoot: '/work', projectFilePath: projectPath, mode: 'cut', options: { ...defaultPatchFinishCutOptions, source: 'skip', projectFile: 'follow' } },
      preview: { ...makePreview({ files, clips: [], merged: undefined }), mode: 'cut' },
      deps,
    });

    expect(report.ok).toBe(true);
    expect(store.get(normalizePath(`${dirs.finishedSkipSrcMediaDir}/a.mp4`))).toBe(`content:${sourcePath}`);
    expect(store.has(normalizePath(`${dirs.finishedSrcMediaDir}/a.mp4`))).toBe(false);
    expect(store.get(normalizePath(`${dirs.finishedSkipSrcMediaDir}/a-proj.llc`))).toBe(`content:${projectPath}`);
    expect(normalizePath(report.newSourcePath as string)).toBe(normalizePath(join(dirs.finishedSkipSrcMediaDir, 'a.mp4')));
    expect(report.touchedDirs).toStrictEqual([normalizePath(dirs.finishedSkipSrcMediaDir)]);
  });

  it('does not rename a merged result that is already kept in finished_merged', async () => {
    const keptMerged = `${dirs.finishedMergedDir}/m.mp4`;
    const files = [sourcePath, keptMerged];
    const { deps, store } = makeDeps({ files: Object.fromEntries(files.map((path) => [path, `content:${path}`])) });
    const report = await executePatchFinish({
      params: { sourcePath, workRoot: '/work', mode: 'merge', options: { ...defaultPatchFinishMergeOptions, source: 'keep', merged: 'finished' } },
      preview: makePreview({ files, merged: keptMerged }),
      deps,
    });

    expect(report.ok).toBe(true);
    expect(store.get(normalizePath(keptMerged))).toBe(`content:${keptMerged}`);
    expect(store.has(normalizePath(`${dirs.finishedMergedDir}/m (1).mp4`))).toBe(false);
    expect(report.moved).toStrictEqual([]);
  });

  it('never overwrites an existing target', async () => {
    const existing = `${dirs.finishedMergedDir}/m.mp4`;
    const files = [...allFiles, existing];
    const { deps, store } = makeDeps({ files: Object.fromEntries(files.map((path) => [path, `content:${path}`])) });
    await executePatchFinish({
      params: { sourcePath, workRoot: '/work', projectFilePath: projectPath, mode: 'merge', options: { ...defaultPatchFinishMergeOptions, projectFile: 'follow' } },
      preview: makePreview({ files }),
      deps,
    });

    expect(store.get(normalizePath(`${dirs.finishedMergedDir}/m (1).mp4`))).toBe(`content:${mergedPath}`);
    expect(store.get(normalizePath(existing))).toBe(`content:${existing}`);
  });

  it('renames the project file with the video and keeps mediaFileName in sync', async () => {
    const existing = `${dirs.detachedSrcMediaDir}/a.mp4`;
    const files = [...allFiles, existing];
    // A file as the save path writes it: a comment header above the project data.
    const project = `// LosslessCut project (JSON5). Comments are for humans; the app ignores them.\n${JSON5.stringify({ version: 2, mediaFileName: 'a.mp4', cutSegments: [] })}`;
    const { deps, store } = makeDeps({
      files: Object.fromEntries(files.map((path) => [path, path === projectPath ? project : path])),
    });
    await executePatchFinish({
      params: { sourcePath, workRoot: '/work', projectFilePath: projectPath, mode: 'merge', options: { ...defaultPatchFinishMergeOptions, projectFile: 'follow' } },
      preview: makePreview({ files }),
      deps,
    });

    const movedProject = store.get(normalizePath(join(dirs.detachedSrcMediaDir, 'a (1)-proj.llc')));
    expect(movedProject).toBeDefined();
    expect(movedProject).toMatch(/^\/\/ LosslessCut project/);
    expect(JSON5.parse(movedProject as string)).toMatchObject({ mediaFileName: 'a (1).mp4' });
  });

  it('records the merged result in the project file, with the segments it is made of', async () => {
    const projectText = JSON5.stringify({ version: 3, mediaFileName: 'a.mp4', cutSegments: [] });
    const fileContents = Object.fromEntries(allFiles.map((path) => [path, path === projectPath ? projectText : path]));
    const { deps, store } = makeDeps({ files: fileContents });
    const preview = makePreview({ files: allFiles });
    preview.mergedSegIds = ['s2', 's1'];
    const report = await executePatchFinish({
      params: { sourcePath, workRoot: '/work', projectFilePath: projectPath, mode: 'merge', options: { ...defaultPatchFinishMergeOptions, projectFile: 'follow' } },
      preview,
      deps,
    });

    expect(report.ok).toBe(true);
    const movedProject = JSON5.parse(store.get(normalizePath(join(dirs.detachedSrcMediaDir, 'a-proj.llc'))) as string);
    // The default merge job deletes the cut results, so the merged file is the only output.
    expect(movedProject.patchExport).toStrictEqual({ mode: 'merge', merged: [{ path: 'm.mp4', segIds: ['s2', 's1'] }], clips: [] });
    expect(JSON5.parse(store.get(normalizePath(join(dirs.detachedSrcMediaDir, 'a-proj.llc'))) as string).cutSegments).toStrictEqual([]);
  });

  it('records the kept cut results too when the merge keeps them', async () => {
    const projectText = JSON5.stringify({ version: 3, mediaFileName: 'a.mp4', cutSegments: [] });
    const fileContents = Object.fromEntries(allFiles.map((path) => [path, path === projectPath ? projectText : path]));
    const { deps, store } = makeDeps({ files: fileContents });
    const preview = makePreview({ files: allFiles });
    preview.clips = preview.clips.map((clip, index) => ({ ...clip, segId: `s${index + 1}` }));
    const report = await executePatchFinish({
      params: {
        sourcePath,
        workRoot: '/work',
        projectFilePath: projectPath,
        mode: 'merge',
        options: { ...defaultPatchFinishMergeOptions, clips: 'detached', projectFile: 'follow' },
      },
      preview,
      deps,
    });

    expect(report.ok).toBe(true);
    const movedProject = JSON5.parse(store.get(normalizePath(join(dirs.detachedSrcMediaDir, 'a-proj.llc'))) as string);
    expect(movedProject.patchExport).toStrictEqual({
      mode: 'merge',
      merged: [{ path: 'm.mp4', segIds: [] }],
      clips: [{ path: 'a-1.mp4', segId: 's1' }, { path: 'a-2.mp4', segId: 's2' }],
    });
    expect(movedProject.mediaFileName).toBe('a.mp4');
  });

  it('records a cut-only job that deleted its merged result without recording it', async () => {
    const projectText = JSON5.stringify({ version: 3, mediaFileName: 'a.mp4', cutSegments: [] });
    const fileContents = Object.fromEntries(allFiles.map((path) => [path, path === projectPath ? projectText : path]));
    const { deps, store } = makeDeps({ files: fileContents });
    const preview = makePreview({ files: allFiles });
    preview.mode = 'cut';
    preview.clips = preview.clips.map((clip, index) => ({ ...clip, segId: `s${index + 1}` }));
    const report = await executePatchFinish({
      params: { sourcePath, workRoot: '/work', projectFilePath: projectPath, mode: 'cut', options: { ...defaultPatchFinishCutOptions, mergedResult: 'delete', projectFile: 'follow' } },
      preview,
      deps,
    });

    expect(report.ok).toBe(true);
    const movedProject = JSON5.parse(store.get(normalizePath(join(dirs.detachedSrcMediaDir, 'a-proj.llc'))) as string);
    expect(movedProject.patchExport).toStrictEqual({
      mode: 'cut',
      merged: [],
      clips: [{ path: 'a-1.mp4', segId: 's1' }, { path: 'a-2.mp4', segId: 's2' }],
    });
    expect(store.has(normalizePath(join(dirs.finishedMergedDir, 'm.mp4')))).toBe(false);
  });

  it('records nothing when the job failed', async () => {
    const projectText = JSON5.stringify({ version: 3, mediaFileName: 'a.mp4', cutSegments: [] });
    const fileContents = Object.fromEntries(allFiles.map((path) => [path, path === projectPath ? projectText : path]));
    const { deps, store } = makeDeps({
      files: fileContents,
      failRename: (from) => (from === mergedPath ? 'EBUSY' : undefined),
    });
    const report = await executePatchFinish({
      params: { sourcePath, workRoot: '/work', projectFilePath: projectPath, mode: 'merge', options: { ...defaultPatchFinishMergeOptions, projectFile: 'follow' } },
      preview: makePreview({ files: allFiles }),
      deps,
    });

    expect(report.ok).toBe(false);
    const movedProject = store.get(normalizePath(join(dirs.detachedSrcMediaDir, 'a-proj.llc'))) as string;
    expect(JSON5.parse(movedProject)).not.toHaveProperty('patchExport');
    expect(JSON5.parse(movedProject).mediaFileName).toBe('a.mp4');
  });

  it('leaves the project file in place when asked, even while the source moves', async () => {
    const { deps, store } = makeDeps({ files: Object.fromEntries(allFiles.map((path) => [path, path])) });
    const report = await executePatchFinish({
      params: {
        sourcePath,
        workRoot: '/work',
        projectFilePath: projectPath,
        mode: 'merge',
        options: { ...defaultPatchFinishMergeOptions, source: 'detached', projectFile: 'keep', clips: 'detached' },
      },
      preview: makePreview({ files: allFiles }),
      deps,
    });

    expect(report.ok).toBe(true);
    expect(store.has(normalizePath(sourcePath))).toBe(false);
    expect(store.has(normalizePath(projectPath))).toBe(true);
    expect(store.has(normalizePath(`${dirs.detachedSrcMediaDir}/a-proj.llc`))).toBe(false);
    expect(report.projectMovedTo).toBeUndefined();
  });

  it('keeps the source in place and archives its project file into finish_llc', async () => {
    const { deps, store } = makeDeps({ files: Object.fromEntries(allFiles.map((path) => [path, path])) });
    const report = await executePatchFinish({
      params: {
        sourcePath,
        workRoot: '/work',
        projectFilePath: projectPath,
        mode: 'merge',
        options: { ...defaultPatchFinishMergeOptions, source: 'keep', projectFile: 'finish-llc', clips: 'detached' },
      },
      preview: makePreview({ files: allFiles }),
      deps,
    });

    const archived = `${dirs.finishLlcDir}/a-proj.llc`;
    expect(report.ok).toBe(true);
    expect(store.has(normalizePath(sourcePath))).toBe(true);
    expect(store.has(normalizePath(projectPath))).toBe(false);
    expect(store.has(normalizePath(archived))).toBe(true);
    expect(normalizePath(report.projectMovedTo as string)).toBe(normalizePath(archived));
    expect(report.newSourcePath).toBeUndefined();
    expect(report.touchedDirs).toContain(normalizePath(dirs.finishLlcDir));
  });

  it('archives the project file into a dated userData store', async () => {
    const { deps, store } = makeDeps({ files: { [sourcePath]: 'video', [projectPath]: 'project' } });
    const report = await executePatchFinish({
      params: {
        sourcePath,
        workRoot: '/work',
        projectFilePath: projectPath,
        mode: 'merge',
        options: {
          ...defaultPatchFinishMergeOptions,
          source: 'keep',
          projectFile: 'userdata-llc',
          projectDateGrouping: 'ymd',
          clips: 'detached',
        },
      },
      preview: makePreview({ files: [sourcePath, projectPath], clips: [], merged: undefined }),
      deps,
      now: new Date(2026, 9, 23),
    });

    expect(report.ok).toBe(true);
    expect(store.has(normalizePath(`${projectStores.userDataLlcDir}/2026-10/23/a-proj.llc`))).toBe(true);
  });

  it('moves the video first and names the archived project after its final name', async () => {
    const existing = `${dirs.detachedSrcMediaDir}/a.mp4`;
    const files = [...allFiles, existing];
    const project = JSON5.stringify({ version: 2, mediaFileName: 'a.mp4', cutSegments: [] });
    const { deps, store } = makeDeps({
      files: Object.fromEntries(files.map((path) => [path, path === projectPath ? project : path])),
    });
    const report = await executePatchFinish({
      params: {
        sourcePath,
        workRoot: '/work',
        projectFilePath: projectPath,
        mode: 'merge',
        options: { ...defaultPatchFinishMergeOptions, source: 'detached', projectFile: 'finish-llc', clips: 'detached' },
      },
      preview: makePreview({ files, clips: [], merged: undefined }),
      deps,
    });

    const archived = `${dirs.finishLlcDir}/a (1)-proj.llc`;
    expect(report.ok).toBe(true);
    expect(store.get(normalizePath(archived))).toBeDefined();
    expect(JSON5.parse(store.get(normalizePath(archived)) as string)).toMatchObject({ mediaFileName: 'a (1).mp4' });
    expect(normalizePath(report.projectMovedTo as string)).toBe(normalizePath(archived));
  });

  it('leaves the project file alone when it is already in the chosen folder', async () => {
    const { deps, store } = makeDeps({ files: { [sourcePath]: 'video', [projectPath]: 'project' } });
    const report = await executePatchFinish({
      params: {
        sourcePath,
        workRoot: '/work',
        projectFilePath: projectPath,
        mode: 'merge',
        options: {
          ...defaultPatchFinishMergeOptions,
          source: 'keep',
          projectFile: 'custom',
          projectDir: '/src',
          projectDateGrouping: 'none',
          clips: 'detached',
        },
      },
      preview: makePreview({ files: [sourcePath, projectPath], clips: [], merged: undefined }),
      deps,
    });

    expect(report.ok).toBe(true);
    expect(store.get(normalizePath(projectPath))).toBe('project');
    expect(report.moved).toStrictEqual([]);
    expect(report.projectMovedTo).toBeUndefined();
  });

  it('keeps the stored media name in sync even when the project file stays put', async () => {
    // The source is renamed by the move (a file with its name is already there) while the project
    // file already has the final name in the target folder: nothing moves, but the `.llc` still has
    // to learn the video's new name.
    const targetVideo = `${dirs.finishedSrcMediaDir}/a (1).mp4`;
    const targetProject = `${dirs.finishedSrcMediaDir}/a (1)-proj.llc`;
    const blocked = `${dirs.finishedSrcMediaDir}/a.mp4`;
    const files = [sourcePath, blocked, targetProject];
    const projectText = "{ version: '1.0', mediaFileName: 'a.mp4', cutSegments: [] }";
    const { deps, store } = makeDeps({ files: Object.fromEntries(files.map((path) => [path, path === targetProject ? projectText : 'video'])) });
    const report = await executePatchFinish({
      params: {
        sourcePath,
        workRoot: '/work',
        projectFilePath: targetProject,
        mode: 'merge',
        options: {
          ...defaultPatchFinishMergeOptions,
          source: 'finished',
          projectFile: 'custom',
          projectDir: dirs.finishedSrcMediaDir,
          projectDateGrouping: 'none',
          clips: 'detached',
        },
      },
      preview: { ...makePreview({ files, clips: [], merged: undefined }), projectFile: { path: targetProject } },
      deps,
    });

    expect(report.ok).toBe(true);
    expect(normalizePath(report.newSourcePath as string)).toBe(normalizePath(targetVideo));
    expect(store.has(normalizePath(targetProject))).toBe(true);
    expect(JSON5.parse(store.get(normalizePath(targetProject)) as string)).toMatchObject({ mediaFileName: 'a (1).mp4' });
  });

  it('stops after a failed project move instead of deleting the cut results', async () => {
    const { deps, store, removed } = makeDeps({
      files: Object.fromEntries(allFiles.map((path) => [path, path])),
      failRename: (from) => (from === projectPath ? 'EPERM' : undefined),
    });
    const report = await executePatchFinish({
      params: {
        sourcePath,
        workRoot: '/work',
        projectFilePath: projectPath,
        mode: 'merge',
        options: { ...defaultPatchFinishMergeOptions, source: 'detached', projectFile: 'finish-llc', clips: 'delete' },
      },
      preview: makePreview({ files: allFiles }),
      deps,
    });

    expect(report.ok).toBe(false);
    expect(report.failed).toStrictEqual([{ path: projectPath, reason: 'EPERM' }]);
    expect(store.has(normalizePath(mergedPath))).toBe(true);
    expect(store.has(normalizePath(clip1))).toBe(true);
    expect(store.has(normalizePath(clip2))).toBe(true);
    // The manifest record is the way back into a retry: a failed job keeps it.
    expect(removed).toStrictEqual([]);
  });

  it('keeps the source move when only the project file cannot follow it', async () => {
    const { deps, store, removed } = makeDeps({
      files: Object.fromEntries(allFiles.map((path) => [path, path])),
      failRename: (from) => (from === projectPath ? 'EPERM' : undefined),
    });
    const report = await executePatchFinish({
      params: { sourcePath, workRoot: '/work', projectFilePath: projectPath, mode: 'merge', options: { ...defaultPatchFinishMergeOptions, projectFile: 'follow' } },
      preview: makePreview({ files: allFiles }),
      deps,
    });

    const movedSource = join(dirs.detachedSrcMediaDir, 'a.mp4');
    expect(report.ok).toBe(false);
    // The video itself moved, so the report says so (and the batch can follow it).
    expect(report.moved.map((entry) => [normalizePath(entry.from), normalizePath(entry.to)])).toStrictEqual([[normalizePath(sourcePath), normalizePath(movedSource)]]);
    expect(normalizePath(report.newSourcePath as string)).toBe(normalizePath(movedSource));
    expect(report.touchedDirs).toStrictEqual([normalizePath(dirs.detachedSrcMediaDir)]);
    expect(report.projectMovedTo).toBeUndefined();
    expect(report.failed).toStrictEqual([{ path: projectPath, reason: 'EPERM' }]);
    // The job stopped before the merged result and the cut results (the source name may be needed).
    expect(store.has(normalizePath(mergedPath))).toBe(true);
    expect(store.has(normalizePath(clip1))).toBe(true);
    expect(removed).toStrictEqual([]);
  });

  it('reports the cut result that failed instead of the merged result', async () => {
    const { deps, store, removed } = makeDeps({
      files: Object.fromEntries(allFiles.map((path) => [path, path])),
      failRename: (from) => (from === clip2 ? 'EPERM' : undefined),
    });
    const report = await executePatchFinish({
      params: {
        sourcePath,
        workRoot: '/work',
        projectFilePath: projectPath,
        mode: 'merge',
        options: { ...defaultPatchFinishMergeOptions, source: 'keep', clips: 'detached' },
      },
      preview: makePreview({ files: allFiles, merged: undefined }),
      deps,
    });

    expect(report.ok).toBe(false);
    expect(report.failed).toStrictEqual([{ path: clip2, reason: 'EPERM' }]);
    // The first cut result moved before the failure, the second one stayed, and the job stopped.
    expect(store.has(normalizePath(`${dirs.detachedClipsDir}/a-1.mp4`))).toBe(true);
    expect(store.has(normalizePath(clip2))).toBe(true);
    expect(removed).toStrictEqual([]);
  });

  it('does not leave a copy behind when the delete half of a cross-volume move fails', async () => {
    const { deps, store } = makeDeps({
      files: Object.fromEntries(allFiles.map((path) => [path, path])),
      failRename: (from, to) => (from === mergedPath && to.includes('finished_merged') ? 'EXDEV' : undefined),
      failUnlink: (path) => (path === mergedPath ? 'EPERM' : undefined),
    });
    const report = await executePatchFinish({
      params: { sourcePath, workRoot: '/work', projectFilePath: projectPath, mode: 'merge', options: { ...defaultPatchFinishMergeOptions, projectFile: 'follow' } },
      preview: makePreview({ files: allFiles }),
      deps,
    });

    expect(report.ok).toBe(false);
    expect(report.failed).toStrictEqual([{ path: mergedPath, reason: 'EPERM' }]);
    // The source of the move is intact and the half-made copy is gone (no ` (n)` duplicate later).
    expect(store.has(normalizePath(mergedPath))).toBe(true);
    expect(store.has(normalizePath(`${dirs.finishedMergedDir}/m.mp4`))).toBe(false);
  });

  it('leaves the project file alone when its name differs only in case', async () => {
    const projectInStore = '/store/A-PROJ.llc';
    const { deps, store } = makeDeps({
      files: { [sourcePath]: 'video', [projectInStore]: 'project' },
      caseInsensitive: true,
    });
    const report = await executePatchFinish({
      params: {
        sourcePath,
        workRoot: '/work',
        projectFilePath: projectInStore,
        mode: 'merge',
        options: {
          ...defaultPatchFinishMergeOptions,
          source: 'keep',
          projectFile: 'custom',
          projectDir: '/store',
          projectDateGrouping: 'none',
          clips: 'detached',
        },
      },
      preview: { ...makePreview({ files: [sourcePath], merged: undefined, clips: [] }), projectFile: { path: projectInStore } },
      deps,
    });

    expect(report.ok).toBe(true);
    expect(report.moved).toStrictEqual([]);
    expect(report.projectMovedTo).toBeUndefined();
    // No `a-proj (1).llc` duplicate: the existing file already has the desired name.
    expect(store.has(normalizePath(projectInStore).toLowerCase())).toBe(true);
    expect(store.size).toBe(2);
  });

  it('moves the cut results to detached_clips when the merged result is stale', async () => {
    const { deps, store } = makeDeps({ files: Object.fromEntries(allFiles.map((path) => [path, path])) });
    const report = await executePatchFinish({
      params: { sourcePath, workRoot: '/work', projectFilePath: projectPath, mode: 'merge', options: { ...defaultPatchFinishMergeOptions, projectFile: 'follow' } },
      preview: makePreview({ files: allFiles, mergedCoversClips: false }),
      deps,
    });

    expect(report.warnings).toContain('merged-stale');
    expect(store.has(normalizePath(clip1))).toBe(false);
    expect(store.has(normalizePath(`${dirs.detachedClipsDir}/a-1.mp4`))).toBe(true);
    expect(report.deleted).toStrictEqual([]);
  });

  it('refuses to delete a cut result outside the work area', async () => {
    const outside = '/elsewhere/a-9.mp4';
    const preview = { ...makePreview({ files: [...allFiles, outside] }), clips: [...makePreview({ files: allFiles }).clips, { path: outside, size: 5, mtimeMs: 1 }] };
    const { deps, store } = makeDeps({ files: Object.fromEntries([...allFiles, outside].map((path) => [path, path])) });
    const report = await executePatchFinish({
      params: { sourcePath, workRoot: '/work', projectFilePath: projectPath, mode: 'merge', options: { ...defaultPatchFinishMergeOptions, projectFile: 'follow' } },
      preview,
      deps,
    });

    expect(store.has(normalizePath(outside))).toBe(true);
    expect(report.warnings).toContain('clips-outside-work-area');
  });

  it('stops the job when the source cannot be moved', async () => {
    const { deps, store } = makeDeps({
      files: Object.fromEntries(allFiles.map((path) => [path, path])),
      failRename: (from) => (from === sourcePath ? 'EPERM' : undefined),
    });
    const report = await executePatchFinish({
      params: { sourcePath, workRoot: '/work', projectFilePath: projectPath, mode: 'merge', options: { ...defaultPatchFinishMergeOptions, projectFile: 'follow' } },
      preview: makePreview({ files: allFiles }),
      deps,
    });

    expect(report.ok).toBe(false);
    expect(report.failed).toStrictEqual([{ path: sourcePath, reason: 'EPERM' }]);
    // The merged result was not moved (its step never ran), and the cut results are untouched.
    expect(store.has(normalizePath(mergedPath))).toBe(true);
    expect(store.has(normalizePath(clip1))).toBe(true);
  });

  it('falls back to copy + delete for a move to another volume', async () => {
    const { deps, store } = makeDeps({
      files: Object.fromEntries(allFiles.map((path) => [path, path])),
      failRename: (from, to) => (from === mergedPath && to.includes('finished_merged') ? 'EXDEV' : undefined),
    });
    const report = await executePatchFinish({
      params: { sourcePath, workRoot: '/work', projectFilePath: projectPath, mode: 'merge', options: { ...defaultPatchFinishMergeOptions, projectFile: 'follow' } },
      preview: makePreview({ files: allFiles }),
      deps,
    });

    expect(report.ok).toBe(true);
    expect(store.has(normalizePath(mergedPath))).toBe(false);
    expect(store.has(normalizePath(`${dirs.finishedMergedDir}/m.mp4`))).toBe(true);
  });

  it('runs the cut-only job: moves the merged result to finished_merged and the cut results on', async () => {
    const projectText = JSON5.stringify({ version: 3, mediaFileName: 'a.mp4', cutSegments: [] });
    const fileContents = Object.fromEntries(allFiles.map((path) => [path, path === projectPath ? projectText : path]));
    const { deps, store, removed } = makeDeps({ files: fileContents });
    const report = await executePatchFinish({
      params: { sourcePath, workRoot: '/work', projectFilePath: projectPath, mode: 'cut', options: { ...defaultPatchFinishCutOptions, projectFile: 'follow' } },
      preview: { ...makePreview({ files: allFiles }), mode: 'cut' },
      deps,
    });

    expect(report.ok).toBe(true);
    expect(store.has(normalizePath(mergedPath))).toBe(false);
    expect(store.has(normalizePath(`${dirs.finishedMergedDir}/m.mp4`))).toBe(true);
    expect(store.has(normalizePath(`${dirs.finishedClipsDir}/a-1.mp4`))).toBe(true);
    expect(store.has(normalizePath(`${dirs.detachedSrcMediaDir}/a.mp4`))).toBe(true);
    expect(report.deleted).toStrictEqual([]);
    expect(report.results.map((result) => ({ path: normalizePath(result.path), kind: result.kind })))
      .toContainEqual({ path: normalizePath(`${dirs.finishedMergedDir}/m.mp4`), kind: 'merged' });
    // The moved merged result is an output of this cut-only job, so the project records it.
    const movedProject = JSON5.parse(store.get(normalizePath(join(dirs.detachedSrcMediaDir, 'a-proj.llc'))) as string);
    expect(movedProject.patchExport).toStrictEqual({
      mode: 'cut',
      merged: [{ path: 'm.mp4', segIds: [] }],
      clips: [{ path: 'a-1.mp4' }, { path: 'a-2.mp4' }],
    });
    // The job finished, so the record left with the results.
    expect(removed).toStrictEqual([sourcePath]);
  });

  it('deletes the merged result when the cut-only job asks for it', async () => {
    const { deps, store } = makeDeps({ files: Object.fromEntries(allFiles.map((path) => [path, path])) });
    const report = await executePatchFinish({
      params: { sourcePath, workRoot: '/work', projectFilePath: projectPath, mode: 'cut', options: { ...defaultPatchFinishCutOptions, mergedResult: 'delete', projectFile: 'follow' } },
      preview: { ...makePreview({ files: allFiles }), mode: 'cut' },
      deps,
    });

    expect(report.ok).toBe(true);
    expect(store.has(normalizePath(mergedPath))).toBe(false);
    expect(store.has(normalizePath(`${dirs.finishedClipsDir}/a-1.mp4`))).toBe(true);
    expect(store.has(normalizePath(`${dirs.detachedSrcMediaDir}/a.mp4`))).toBe(true);
    expect(report.deleted).toStrictEqual([mergedPath]);
  });

  it('treats a merged result deleted after the preview as already gone', async () => {
    // The preview said the merged result exists, but it was removed before the job could delete it.
    const filesWithoutMerged = [sourcePath, projectPath, clip1, clip2];
    const { deps, store, removed } = makeDeps({ files: Object.fromEntries(filesWithoutMerged.map((path) => [path, path])) });
    const report = await executePatchFinish({
      params: { sourcePath, workRoot: '/work', projectFilePath: projectPath, mode: 'cut', options: { ...defaultPatchFinishCutOptions, mergedResult: 'delete', projectFile: 'follow' } },
      preview: { ...makePreview({ files: allFiles }), mode: 'cut' },
      deps,
    });

    expect(report.ok).toBe(true);
    expect(report.deleted).toStrictEqual([mergedPath]);
    expect(store.has(normalizePath(`${dirs.finishedClipsDir}/a-1.mp4`))).toBe(true);
    // The job finished, so the record left with the results.
    expect(removed).toStrictEqual([sourcePath]);
  });

  const cleanCutOptions = {
    ...defaultPatchFinishCutOptions,
    source: 'keep',
    clips: 'source',
    mergedResult: 'delete',
    projectFile: 'keep',
    workDir: 'clear',
  } as const;

  it('moves the empty work area to the recycle bin after a successful job', async () => {
    const { deps, store, trashed } = makeDeps({ files: Object.fromEntries(allFiles.map((path) => [path, path])) });
    const report = await executePatchFinish({
      params: { sourcePath, workRoot: '/work', projectFilePath: projectPath, mode: 'cut', options: cleanCutOptions },
      preview: { ...makePreview({ files: allFiles }), mode: 'cut' },
      deps,
    });

    expect(report.ok).toBe(true);
    expect(trashed).toStrictEqual([normalizePath(dirs.workDir)]);
    expect(report.workDirTrashed).toStrictEqual({ path: dirs.workDir });
    expect(report.workDirTrashFailed).toBeUndefined();
    expect(store.get(normalizePath('/src/a-1.mp4'))).toBe(clip1);
    expect(report.touchedDirs).toStrictEqual([normalizePath('/src')]);
  });

  it('clears the work area even though the job holds the lock it took itself', async () => {
    // `main/index` takes this lock before `executePatchFinish` runs, so the lock file is on disk for
    // the whole job - including the cleanup step that must not mistake it for another window.
    const lockPath = `${dirs.workDir}/.export.lock`;
    const { deps, trashed } = makeDeps({
      files: {
        ...Object.fromEntries(allFiles.map((path) => [path, path])),
        [lockPath]: '{"pid":1,"startedAt":1}',
      },
    });
    const report = await executePatchFinish({
      params: { sourcePath, workRoot: '/work', projectFilePath: projectPath, mode: 'cut', options: cleanCutOptions },
      preview: { ...makePreview({ files: allFiles }), mode: 'cut' },
      deps,
    });

    expect(report.ok).toBe(true);
    expect(trashed).toStrictEqual([normalizePath(dirs.workDir)]);
    expect(report.workDirTrashed).toStrictEqual({ path: dirs.workDir });
    expect(report.warnings).not.toContain('work-dir-not-clearable');
  });

  it('keeps the work area when a user file remains, even an empty one', async () => {
    const { deps, trashed } = makeDeps({
      files: Object.fromEntries(allFiles.map((path) => [path, path])),
      workDirEntries: [{ path: 'notes.txt', kind: 'file' }],
    });
    const report = await executePatchFinish({
      params: { sourcePath, workRoot: '/work', projectFilePath: projectPath, mode: 'cut', options: cleanCutOptions },
      preview: { ...makePreview({ files: allFiles }), mode: 'cut' },
      deps,
    });

    expect(report.ok).toBe(true);
    expect(trashed).toStrictEqual([]);
    expect(report.workDirTrashed).toBeUndefined();
    expect(report.warnings).toContain('work-dir-not-clearable');
  });

  it('keeps the work area when the job leaves any result inside it', async () => {
    const { deps, trashed } = makeDeps({ files: Object.fromEntries(allFiles.map((path) => [path, path])) });
    const report = await executePatchFinish({
      params: { sourcePath, workRoot: '/work', projectFilePath: projectPath, mode: 'merge', options: { ...defaultPatchFinishMergeOptions, workDir: 'clear', projectFile: 'follow' } },
      preview: makePreview({ files: allFiles }),
      deps,
    });

    expect(report.ok).toBe(true);
    expect(trashed).toStrictEqual([]);
    expect(report.workDirTrashed).toBeUndefined();
    expect(report.warnings).toContain('work-dir-not-clearable');
  });

  it('never trashes a directory that is not the work area itself', async () => {
    const { deps, trashed } = makeDeps({ files: Object.fromEntries(allFiles.map((path) => [path, path])) });
    const report = await executePatchFinish({
      params: { sourcePath, workRoot: '/work', projectFilePath: projectPath, mode: 'cut', options: cleanCutOptions },
      // A future source of `dirs` could point anywhere: the deep gate must refuse it even though
      // the whitelist scan of that folder would find nothing.
      preview: { ...makePreview({ files: allFiles }), mode: 'cut', dirs: { ...dirs, workDir: '/work' } },
      deps,
    });

    expect(report.ok).toBe(true);
    expect(trashed).toStrictEqual([]);
    expect(report.workDirTrashed).toBeUndefined();
    expect(report.warnings).toContain('work-dir-not-clearable');
  });

  it('reports a refused recycle bin and keeps the finished job successful', async () => {
    const { deps, trashed } = makeDeps({
      files: Object.fromEntries(allFiles.map((path) => [path, path])),
      failTrash: () => 'EBUSY',
    });
    const report = await executePatchFinish({
      params: { sourcePath, workRoot: '/work', projectFilePath: projectPath, mode: 'cut', options: cleanCutOptions },
      preview: { ...makePreview({ files: allFiles }), mode: 'cut' },
      deps,
    });

    expect(report.ok).toBe(true);
    expect(trashed).toStrictEqual([]);
    expect(report.workDirTrashed).toBeUndefined();
    expect(report.workDirTrashFailed).toStrictEqual({ path: dirs.workDir, reason: 'EBUSY' });
    expect(report.warnings).toContain('work-dir-trash-failed');
  });

  it('does not touch the work area when a step failed', async () => {
    const { deps, trashed } = makeDeps({
      files: Object.fromEntries(allFiles.map((path) => [path, path])),
      failRename: (from) => (from === clip1 ? 'EPERM' : undefined),
    });
    const report = await executePatchFinish({
      params: { sourcePath, workRoot: '/work', projectFilePath: projectPath, mode: 'cut', options: cleanCutOptions },
      preview: { ...makePreview({ files: allFiles }), mode: 'cut' },
      deps,
    });

    expect(report.ok).toBe(false);
    expect(trashed).toStrictEqual([]);
    expect(report.workDirTrashed).toBeUndefined();
  });

  it('drops touched directories that were inside the trashed work area', async () => {
    const { deps, trashed } = makeDeps({
      files: Object.fromEntries(allFiles.map((path) => [path, path])),
      // Simulate a disk scan that saw nothing: the moved-in files are then part of the trashed tree.
      workDirEntries: [],
    });
    const report = await executePatchFinish({
      params: { sourcePath, workRoot: '/work', projectFilePath: projectPath, mode: 'merge', options: { ...defaultPatchFinishMergeOptions, workDir: 'clear', projectFile: 'follow' } },
      preview: makePreview({ files: allFiles }),
      deps,
    });

    expect(trashed).toHaveLength(1);
    // The source went to `detached_src_media` (inside the trashed work area) and is not reported.
    // What the user keeps left the work area, so its folder is still worth offering.
    expect(report.touchedDirs).toStrictEqual([dirs.finishedMergedDir]);
  });
});

describe('executePatchFinish: discard', () => {
  const discardOptions = {
    ...defaultPatchFinishDiscardOptions,
    results: 'delete',
  } as const;

  it('deletes the results, then parks the source with its project file', async () => {
    const { deps, store, removed } = makeDeps({ files: Object.fromEntries(allFiles.map((path) => [path, path])) });
    const report = await executePatchFinish({
      params: { sourcePath, workRoot: '/work', projectFilePath: projectPath, mode: 'discard', options: discardOptions },
      preview: { ...makePreview({ files: allFiles }), mode: 'discard' },
      deps,
    });

    expect(report.ok).toBe(true);
    expect(report.deleted).toStrictEqual(expect.arrayContaining([clip1, clip2, mergedPath]));
    expect(store.has(normalizePath(`${dirs.detachedSrcMediaDir}/a.mp4`))).toBe(true);
    expect(store.has(normalizePath(`${dirs.detachedSrcMediaDir}/a-proj.llc`))).toBe(true);
    expect(report.newSourcePath).toBe(join(dirs.detachedSrcMediaDir, 'a.mp4'));
    expect(removed).toStrictEqual([sourcePath]);
  });

  it('moves the results to the waiting-for-deletion folders instead of deleting them', async () => {
    const { deps, store, removed } = makeDeps({ files: Object.fromEntries(allFiles.map((path) => [path, path])) });
    const report = await executePatchFinish({
      params: { sourcePath, workRoot: '/work', projectFilePath: projectPath, mode: 'discard', options: { ...defaultPatchFinishDiscardOptions, results: 'detached' } },
      preview: { ...makePreview({ files: allFiles }), mode: 'discard' },
      deps,
    });

    expect(report.ok).toBe(true);
    expect(report.deleted).toStrictEqual([]);
    expect(store.has(normalizePath(`${dirs.detachedClipsDir}/a-1.mp4`))).toBe(true);
    expect(store.has(normalizePath(`${dirs.detachedClipsDir}/a-2.mp4`))).toBe(true);
    expect(store.has(normalizePath(`${dirs.detachedMergedDir}/m.mp4`))).toBe(true);
    expect(store.has(normalizePath(`${dirs.detachedSrcMediaDir}/a.mp4`))).toBe(true);
    expect(removed).toStrictEqual([sourcePath]);
  });

  it('stops before moving the source when a result cannot be deleted', async () => {
    const { deps, store } = makeDeps({
      files: Object.fromEntries(allFiles.map((path) => [path, path])),
      failUnlink: (path) => (path === clip2 ? 'EPERM' : undefined),
    });
    const report = await executePatchFinish({
      params: { sourcePath, workRoot: '/work', projectFilePath: projectPath, mode: 'discard', options: discardOptions },
      preview: { ...makePreview({ files: allFiles }), mode: 'discard' },
      deps,
    });

    expect(report.ok).toBe(false);
    expect(report.failed.map((failure) => failure.path)).toStrictEqual([clip2]);
    // The source is still where it was: a retry can work from the same paths.
    expect(store.has(normalizePath(sourcePath))).toBe(true);
    expect(store.has(normalizePath(`${dirs.detachedSrcMediaDir}/a.mp4`))).toBe(false);
  });

  it('leaves a merged result outside the work area alone when deleting', async () => {
    const outsideMerged = '/src/merged-by-hand.mp4';
    const files = [sourcePath, clip1, outsideMerged];
    const { deps, store } = makeDeps({ files: Object.fromEntries(files.map((path) => [path, path])) });
    const report = await executePatchFinish({
      params: { sourcePath, workRoot: '/work', projectFilePath: projectPath, mode: 'discard', options: discardOptions },
      preview: { ...makePreview({ files, merged: outsideMerged, mergedInsideWorkArea: false }), mode: 'discard' },
      deps,
    });

    expect(report.ok).toBe(true);
    expect(report.deleted).toStrictEqual([clip1]);
    expect(report.warnings).toContain('merged-outside-work-area');
    expect(store.has(normalizePath(outsideMerged))).toBe(true);
    expect(store.has(normalizePath(sourcePath))).toBe(false);
  });

  describe('stale cut results of earlier passes', () => {
    const staleClip = `${dirs.clipsDir}/old-1.mp4`;
    const filesWithStale = [...allFiles, staleClip];
    const stalePreview = (): PatchFinishPreview => {
      const base = makePreview({ files: filesWithStale });
      return {
        ...base,
        mode: 'cut',
        clips: [
          { path: clip1, size: 10, mtimeMs: 100, segId: 'a' },
          { path: clip2, size: 10, mtimeMs: 110, segId: 'b' },
          { path: staleClip, size: 10, mtimeMs: 90, segId: 'old' },
        ],
        selectedSegIds: ['a', 'b'],
      };
    };
    const options = () => ({ ...defaultPatchFinishCutOptions, source: 'keep', projectFile: 'keep', mergedResult: 'keep', clips: 'finished' } as const);

    it('deletes the stale results and forgets the manifest record', async () => {
      const { deps, store, removed } = makeDeps({ files: Object.fromEntries(filesWithStale.map((path) => [path, path])) });
      const report = await executePatchFinish({
        params: { sourcePath, workRoot: '/work', projectFilePath: projectPath, mode: 'cut', options: options() },
        preview: stalePreview(),
        deps,
      });

      expect(report.ok).toBe(true);
      expect(store.has(normalizePath(staleClip))).toBe(false);
      // This export's results still move out.
      expect(store.has(normalizePath(join(dirs.finishedClipsDir, 'a-1.mp4')))).toBe(true);
      expect(store.has(normalizePath(join(dirs.finishedClipsDir, 'a-2.mp4')))).toBe(true);
      expect(removed).toStrictEqual([sourcePath]);
      expect(report.deleted.map((path) => normalizePath(path))).toContain(normalizePath(staleClip));
    });

    it('keeps the stale results and the manifest record when the choice is off', async () => {
      const { deps, store, removed } = makeDeps({ files: Object.fromEntries(filesWithStale.map((path) => [path, path])) });
      const report = await executePatchFinish({
        params: { sourcePath, workRoot: '/work', projectFilePath: projectPath, mode: 'cut', options: { ...options(), deleteStaleClips: false } },
        preview: stalePreview(),
        deps,
      });

      expect(report.ok).toBe(true);
      expect(store.has(normalizePath(staleClip))).toBe(true);
      expect(removed).toStrictEqual([]);
      expect(report.deleted).toStrictEqual([]);
    });
  });
});
