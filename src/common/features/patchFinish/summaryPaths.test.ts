// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { joinDisplayPath, listPreviewResultPaths, listSummaryPaths } from './summaryPaths.js';

const merged = { path: '/work/losslesscut_finished/finished_merged/m.mp4', kind: 'merged' as const };
const clip1 = { path: '/work/losslesscut_finished/finished_clips/a-1.mp4', kind: 'clip' as const };
const clip2 = { path: '/work/losslesscut_finished/finished_clips/a-2.mp4', kind: 'clip' as const };
const source = '/work/losslesscut_finished/finished_skip_src/a.mp4';

describe('listSummaryPaths', () => {
  it('lists the merged result, then the cut results, then the source', () => {
    const result = listSummaryPaths({
      results: [clip1, merged, clip2],
      newSourcePath: source,
      flow: 'finish',
      caseInsensitive: false,
    });
    expect(result.shown.map((entry) => entry.path)).toStrictEqual([merged.path, clip1.path, clip2.path, source]);
    expect(result.hidden).toBe(0);
    // The finish workflow selects the main artifact, not the source it is putting away.
    expect(result.revealTarget).toStrictEqual(merged);
  });

  it('puts the source first in the skip workflow and selects it', () => {
    const result = listSummaryPaths({
      results: [clip1, merged],
      newSourcePath: source,
      flow: 'keepSource',
      caseInsensitive: false,
    });
    expect(result.shown.map((entry) => entry.path)).toStrictEqual([source, merged.path, clip1.path]);
    expect(result.revealTarget).toStrictEqual({ path: source, kind: 'source' });
  });

  it('keeps the source visible when a skip job has many results', () => {
    const clips = Array.from({ length: 8 }, (_, index) => ({ path: `/work/clips/a-${index}.mp4`, kind: 'clip' as const }));
    const result = listSummaryPaths({ results: clips, newSourcePath: source, flow: 'keepSource', caseInsensitive: false });
    expect(result.shown).toHaveLength(5);
    expect(result.shown[0]?.kind).toBe('source');
    expect(result.hidden).toBe(4);
  });

  it('hides the tail behind a count, with the merged result always visible', () => {
    const clips = Array.from({ length: 8 }, (_, index) => ({ path: `/work/clips/a-${index}.mp4`, kind: 'clip' as const }));
    const result = listSummaryPaths({ results: [...clips, merged], newSourcePath: undefined, flow: 'finish', caseInsensitive: false });
    expect(result.shown).toHaveLength(5);
    expect(result.shown[0]).toStrictEqual(merged);
    expect(result.hidden).toBe(4);
  });

  it('drops a path reported twice and one that is the source', () => {
    const result = listSummaryPaths({
      results: [merged, { ...merged }],
      newSourcePath: merged.path,
      flow: 'finish',
      caseInsensitive: false,
    });
    expect(result.shown).toStrictEqual([merged]);
    expect(result.hidden).toBe(0);
  });

  it('compares the way the file system does', () => {
    const upper = { path: String.raw`C:\work\Clips\A-1.mp4`, kind: 'clip' as const };
    const lower = { path: 'C:/work/clips/a-1.mp4', kind: 'clip' as const };
    expect(listSummaryPaths({ results: [upper, lower], newSourcePath: undefined, flow: 'finish', caseInsensitive: true }).shown).toHaveLength(1);
    expect(listSummaryPaths({ results: [upper, lower], newSourcePath: undefined, flow: 'finish', caseInsensitive: false }).shown).toHaveLength(2);
  });

  it('selects the only clip when the job kept no merged result', () => {
    const result = listSummaryPaths({ results: [clip2], newSourcePath: undefined, flow: 'finish', caseInsensitive: false });
    expect(result.revealTarget).toStrictEqual(clip2);
  });

  it('has nothing to show when the job kept nothing', () => {
    const result = listSummaryPaths({ results: [], newSourcePath: undefined, flow: 'finish', caseInsensitive: false });
    expect(result).toStrictEqual({ shown: [], hidden: 0, revealTarget: undefined });
  });
});

describe('joinDisplayPath', () => {
  it('keeps the folder separator', () => {
    expect(joinDisplayPath(String.raw`C:\work\clips`, 'a-1.mp4')).toBe(String.raw`C:\work\clips\a-1.mp4`);
    expect(joinDisplayPath('/work/clips', 'a-1.mp4')).toBe('/work/clips/a-1.mp4');
  });

  it('does not double a trailing separator, and accepts a bare file name', () => {
    const trailing = `${String.raw`C:\work\clips`}\\`;
    expect(joinDisplayPath(trailing, 'a-1.mp4')).toBe(String.raw`C:\work\clips\a-1.mp4`);
    expect(joinDisplayPath('/work/clips/', 'a-1.mp4')).toBe('/work/clips/a-1.mp4');
    expect(joinDisplayPath('', 'a-1.mp4')).toBe('a-1.mp4');
  });
});

describe('listPreviewResultPaths', () => {
  const first = { path: '/work/.losslesscut_work/clips/a-1.mp4' };
  const second = { path: '/work/.losslesscut_work/clips/a-2.mp4' };

  it('uses the planned name, and the current one when the job renames nothing', () => {
    expect(listPreviewResultPaths({
      clips: [first, second],
      dir: '/work/losslesscut_finished/finished_clips',
      plan: [{ from: first.path, fileName: 'a-clip-1.mp4' }],
      caseInsensitive: false,
    })).toStrictEqual([
      '/work/losslesscut_finished/finished_clips/a-clip-1.mp4',
      '/work/losslesscut_finished/finished_clips/a-2.mp4',
    ]);
  });

  it('has no paths when the results are deleted instead of moved', () => {
    expect(listPreviewResultPaths({ clips: [first], dir: undefined, plan: [], caseInsensitive: false })).toStrictEqual([]);
  });

  it('matches a planned entry the way the file system does', () => {
    expect(listPreviewResultPaths({
      clips: [{ path: 'C:/work/clips/a-1.mp4' }],
      dir: String.raw`C:\work\finished_clips`,
      plan: [{ from: String.raw`C:\work\clips\a-1.mp4`, fileName: 'a-clip-1.mp4' }],
      caseInsensitive: true,
    })).toStrictEqual([String.raw`C:\work\finished_clips\a-clip-1.mp4`]);
  });
});
