import { join } from 'node:path';

// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { buildPatchResultsOverview } from './scan.js';

import type { PatchResultsOverviewDeps } from './scan.js';

const root = join('/w');
const workDir = join(root, '.losslesscut_work');
const finishedDir = join(root, 'losslesscut_finished');
const detachedSrc = join(workDir, 'detached_src_media');
const finishedSrc = join(finishedDir, 'finished_src_media');
const finishedSkipSrc = join(finishedDir, 'finished_skip_src');
const finishedClips = join(finishedDir, 'finished_clips');
const finishedMerged = join(finishedDir, 'finished_merged');

interface FakeFs {
  folders: Record<string, string[]>;
  texts: Record<string, string>;
  existing: Set<string>;
  unreadable?: string[];
}

function deps(fs: FakeFs, overrides: Partial<PatchResultsOverviewDeps> = {}): PatchResultsOverviewDeps {
  return {
    ledger: { version: 1, entries: [] },
    caseInsensitive: true,
    listMediaFiles: async (dir) => {
      if (fs.unreadable?.includes(dir)) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      const files = fs.folders[dir];
      if (files == null) throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      return files;
    },
    readText: async (path) => fs.texts[path] ?? '',
    exists: async (path) => fs.existing.has(path),
    ...overrides,
  };
}

describe('buildPatchResultsOverview', () => {
  it('reports a missing working directory instead of failing', async () => {
    const overview = await buildPatchResultsOverview(undefined, deps({ folders: {}, texts: {}, existing: new Set() }));

    expect(overview.stats).toMatchObject({ sources: 0, clips: 0, merged: 0 });
    expect(overview.warnings).toContain('no-work-root');
    expect(overview.openTargets).toStrictEqual({ detachedSources: false, finishedSources: false, finishedSkipSources: false, finishedClips: false, finishedMerged: false });
  });

  it('reads the folders, the ledger and the project file', async () => {
    const projectPath = join(detachedSrc, 'a-proj.llc');
    const fs: FakeFs = {
      folders: {
        [detachedSrc]: [join(detachedSrc, 'a.mp4')],
        [finishedClips]: [join(finishedClips, 'a-1.mp4')],
        [finishedMerged]: [join(finishedMerged, 'a-merge.mp4')],
      },
      texts: {
        [projectPath]: `{
  version: 3,
  mediaFileName: 'a.mp4',
  patchExport: { mode: 'merge', merged: [{ path: 'a-merge.mp4', segIds: [] }], clips: [{ path: 'a-1.mp4' }] },
  cutSegments: [],
}`,
      },
      existing: new Set([projectPath, detachedSrc, finishedClips, finishedMerged]),
    };

    const overview = await buildPatchResultsOverview(root, deps(fs));

    expect(overview.stats).toMatchObject({ sources: 1, clips: 1, merged: 1, complete: 1 });
    expect(overview.sources[0]?.pairing).toBe('project');
    expect(overview.openTargets).toStrictEqual({ detachedSources: true, finishedSources: false, finishedSkipSources: false, finishedClips: true, finishedMerged: true });
    expect(overview.warnings).toStrictEqual([]);
  });

  it('reads the skipped sources separately from the finished ones', async () => {
    const fs: FakeFs = {
      folders: {
        [finishedSrc]: [join(finishedSrc, 'kept.mp4')],
        [finishedSkipSrc]: [join(finishedSkipSrc, 'skipped.mp4')],
      },
      texts: {},
      existing: new Set([finishedSrc, finishedSkipSrc]),
    };

    const overview = await buildPatchResultsOverview(root, deps(fs));

    expect(overview.sources.filter((source) => source.folder === 'finishedSrc').map((source) => source.path))
      .toStrictEqual([join(finishedSrc, 'kept.mp4')]);
    expect(overview.sources.filter((source) => source.folder === 'finishedSkip').map((source) => source.path))
      .toStrictEqual([join(finishedSkipSrc, 'skipped.mp4')]);
    expect(overview.openTargets).toMatchObject({ finishedSources: true, finishedSkipSources: true });
    expect(overview.stats.sources).toBe(2);
  });

  it('keeps going when a folder cannot be read', async () => {
    const fs: FakeFs = {
      folders: { [detachedSrc]: [join(detachedSrc, 'a.mp4')] },
      texts: {},
      existing: new Set(),
      unreadable: [finishedClips],
    };

    const overview = await buildPatchResultsOverview(root, deps(fs));

    expect(overview.sources).toHaveLength(1);
    expect(overview.warnings).toContain('dir-unreadable');
  });

  it('treats a missing project file as "no project file" without logging it', async () => {
    const logged: string[] = [];
    const fs: FakeFs = { folders: { [detachedSrc]: [join(detachedSrc, 'a.mp4')] }, texts: {}, existing: new Set() };

    await buildPatchResultsOverview(root, deps(fs, {
      readText: async () => { throw Object.assign(new Error('not found'), { code: 'ENOENT' }); },
      log: (message) => { logged.push(message); },
    }));

    expect(logged).toStrictEqual([]);
  });

  it('prefers the ledger over the project file', async () => {
    const fs: FakeFs = {
      folders: {
        [detachedSrc]: [join(detachedSrc, 'a.mp4')],
        [finishedClips]: [join(finishedClips, 'a-1.mp4')],
      },
      texts: {},
      existing: new Set(),
    };

    const overview = await buildPatchResultsOverview(root, deps(fs, {
      ledger: { version: 1, entries: [{ source: join(detachedSrc, 'a.mp4'), clips: [join(finishedClips, 'a-1.mp4')], merged: [], parkedClips: [], parkedMerged: [], at: 1 }] },
    }));

    expect(overview.sources[0]?.pairing).toBe('ledger');
  });

  it('reads a fingerprint only for the source a moved ledger entry could describe', async () => {
    const movedSource = join(detachedSrc, 'a.mp4');
    const otherSource = join(detachedSrc, 'b.mp4');
    const clipPath = join(finishedClips, 'a-1.mp4');
    const fs: FakeFs = {
      folders: {
        [detachedSrc]: [movedSource, otherSource],
        [finishedClips]: [clipPath],
      },
      texts: {},
      existing: new Set([detachedSrc, finishedClips]),
    };
    const fingerprinted: string[] = [];

    const overview = await buildPatchResultsOverview(root, deps(fs, {
      ledger: {
        version: 1,
        entries: [{
          source: join(root, 'a.mp4'),
          sourceIdentity: { size: 10, hash: 'h' },
          clips: [clipPath],
          merged: [],
          parkedClips: [],
          parkedMerged: [],
          at: 1,
        }],
      },
      fingerprintSource: async (path) => {
        fingerprinted.push(path);
        return path === movedSource ? { size: 10, hash: 'h' } : undefined;
      },
    }));

    // Only the same-name candidate is read, not every source of the work area.
    expect(fingerprinted).toStrictEqual([movedSource]);
    expect(overview.sources.find((source) => source.path === movedSource)?.clips.map((clip) => clip.path)).toStrictEqual([clipPath]);
    expect(overview.stats.sourceGone).toBe(0);
  });
});
