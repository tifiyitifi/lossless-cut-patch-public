// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { PatchFinishClipRef } from './preview.js';
import { splitClipsByExportSelection } from './unselected.js';

const clip = (segId: string | undefined): PatchFinishClipRef => ({
  path: `/clips/${segId ?? 'unknown'}.mp4`,
  size: 10,
  mtimeMs: 100,
  ...((segId != null) && { segId }),
});

describe('splitClipsByExportSelection', () => {
  it('splits the tracked results by the recorded export order', () => {
    const split = splitClipsByExportSelection([clip('a'), clip('b'), clip('c')], ['a', 'c']);
    expect(split.selected.map((entry) => entry.segId)).toStrictEqual(['a', 'c']);
    expect(split.stale.map((entry) => entry.segId)).toStrictEqual(['b']);
  });

  it('treats every result as selected when no order was recorded (an older manifest)', () => {
    const clips = [clip('a'), clip('b')];
    expect(splitClipsByExportSelection(clips, undefined)).toStrictEqual({ selected: clips, stale: [] });
    expect(splitClipsByExportSelection(clips, [])).toStrictEqual({ selected: clips, stale: [] });
  });

  it('never marks a result without an identity as stale', () => {
    // An old manifest has no `segId`; deleting such a file would be deleting something we cannot prove is old.
    const split = splitClipsByExportSelection([clip(undefined), clip('b')], ['b']);
    expect(split.selected.map((entry) => entry.segId)).toStrictEqual([undefined, 'b']);
    expect(split.stale).toStrictEqual([]);
  });

  it('reports every result as stale when the order names none of them', () => {
    const split = splitClipsByExportSelection([clip('a'), clip('b')], ['c']);
    expect(split.selected).toStrictEqual([]);
    expect(split.stale.map((entry) => entry.segId)).toStrictEqual(['a', 'b']);
  });
});
