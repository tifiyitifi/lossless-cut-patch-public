// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { buildPatchExportRecord } from './exportRecord.js';

const merged = { path: '/work/clips/../merged/m.mp4', size: 10, mtimeMs: 1 };
const clip1 = { path: '/work/clips/a-1.mp4', size: 10, mtimeMs: 1, segId: 's1' };
const clip2 = { path: '/work/clips/a-2.mp4', size: 10, mtimeMs: 1, segId: 's2' };

describe('buildPatchExportRecord', () => {
  it('records a merged job with the kept cut results', () => {
    const record = buildPatchExportRecord({
      mode: 'merge',
      preview: { merged, clips: [clip1, clip2], mergedSegIds: ['s2', 's1'] },
      moved: [
        { from: '/work/clips/a-1.mp4', to: '/out/detached_clips/a-1.mp4' },
        { from: '/work/clips/a-2.mp4', to: '/out/detached_clips/a-2.mp4' },
        { from: '/work/clips/../merged/m.mp4', to: '/out/finished_merged/m.mp4' },
      ],
    });
    expect(record).toStrictEqual({
      mode: 'merge',
      merged: [{ path: 'm.mp4', segIds: ['s2', 's1'] }],
      clips: [{ path: 'a-1.mp4', segId: 's1' }, { path: 'a-2.mp4', segId: 's2' }],
    });
  });

  it('records a merge that deleted the cut results as merged only', () => {
    const record = buildPatchExportRecord({
      mode: 'merge',
      preview: { merged, clips: [clip1, clip2], mergedSegIds: ['s1'] },
      moved: [{ from: merged.path, to: '/out/finished_merged/m.mp4' }],
    });
    expect(record).toStrictEqual({ mode: 'merge', merged: [{ path: 'm.mp4', segIds: ['s1'] }], clips: [] });
  });

  it('records a cut-only job with the cut results', () => {
    const record = buildPatchExportRecord({
      mode: 'cut',
      preview: { merged: undefined, clips: [clip1], mergedSegIds: undefined },
      moved: [{ from: clip1.path, to: '/out/finished_clips/a-1.mp4' }],
    });
    expect(record).toStrictEqual({ mode: 'cut', merged: [], clips: [{ path: 'a-1.mp4', segId: 's1' }] });
  });

  it('leaves out a result the job did not move (deleted, or still in the work area)', () => {
    const record = buildPatchExportRecord({
      mode: 'cut',
      preview: { merged, clips: [clip1, clip2], mergedSegIds: ['s1', 's2'] },
      moved: [{ from: clip2.path, to: '/out/finished_clips/a-2.mp4' }],
    });
    expect(record).toStrictEqual({ mode: 'cut', merged: [], clips: [{ path: 'a-2.mp4', segId: 's2' }] });
  });

  it('writes a result without a segment id when the manifest has none', () => {
    const record = buildPatchExportRecord({
      mode: 'cut',
      preview: { merged: undefined, clips: [{ path: '/work/clips/old.mp4', size: 1, mtimeMs: 1 }], mergedSegIds: undefined },
      moved: [{ from: '/work/clips/old.mp4', to: '/out/old.mp4' }],
    });
    expect(record).toStrictEqual({ mode: 'cut', merged: [], clips: [{ path: 'old.mp4' }] });
  });

  it('records nothing when the job moved nothing', () => {
    const record = buildPatchExportRecord({
      mode: 'cut',
      preview: { merged: undefined, clips: [clip1], mergedSegIds: undefined },
      moved: [],
    });
    expect(record).toBeUndefined();
  });

  it('takes the file name of a Windows path', () => {
    const record = buildPatchExportRecord({
      mode: 'merge',
      preview: { merged: { path: String.raw`C:\work\merged\m.mp4`, size: 1, mtimeMs: 1 }, clips: [], mergedSegIds: [] },
      moved: [{ from: String.raw`C:\work\merged\m.mp4`, to: String.raw`D:\finished_merged\m (1).mp4` }],
    });
    expect(record).toStrictEqual({ mode: 'merge', merged: [{ path: 'm (1).mp4', segIds: [] }], clips: [] });
  });
});
