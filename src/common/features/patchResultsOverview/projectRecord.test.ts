// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { parsePatchProjectClipOutputs, parsePatchProjectOutputs } from './projectRecord.js';

describe('parsePatchProjectOutputs', () => {
  it('reads the outputs of a finished job', () => {
    expect(parsePatchProjectOutputs({
      mode: 'merge',
      merged: [{ path: 'a-merge.mp4', segIds: ['s1'] }],
      clips: [{ path: 'a-1.mp4', segId: 's1' }, { path: 'a-2.mp4' }],
    })).toStrictEqual({ clips: ['a-1.mp4', 'a-2.mp4'], merged: ['a-merge.mp4'] });
  });

  it('ignores a block without outputs and a malformed one', () => {
    expect(parsePatchProjectOutputs(undefined)).toBeUndefined();
    expect(parsePatchProjectOutputs({ mode: 'merge', clips: [], merged: [] })).toBeUndefined();
    expect(parsePatchProjectOutputs({ clips: [{ path: '' }, 42], merged: [] })).toBeUndefined();
  });

  it('keeps the segment of each cut result', () => {
    expect(parsePatchProjectClipOutputs({
      clips: [{ path: 'a-1.mp4', segId: 's1' }, { path: 'a-2.mp4' }, { path: '', segId: 's3' }, 42],
    })).toStrictEqual([{ path: 'a-1.mp4', segId: 's1' }, { path: 'a-2.mp4' }]);
    expect(parsePatchProjectClipOutputs(undefined)).toStrictEqual([]);
  });
});
