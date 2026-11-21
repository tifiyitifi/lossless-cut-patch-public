// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { planJoinRepairTail } from './tailRepair.js';

const frameDuration = 1 / 60;

describe('planJoinRepairTail', () => {
  it('copies the middle and encodes the tail GOP when it starts after the head keyframe', () => {
    // Head keyframe 4 s, tail keyframe 8 s: the middle (4 s .. 8 s - 1 frame) is copied.
    const plan = planJoinRepairTail({ tailKeyframe: 8, headKeyframe: 4, frameDuration });
    expect(plan).toStrictEqual({ kind: 'copy-middle', copyTo: 8 - frameDuration });
  });

  it('encodes the whole segment when the cut end is still in the head GOP', () => {
    // The cut starts at 3.9 s (head keyframe 4 s) and ends at 5 s: the only keyframe before the cut
    // end is the head one, so a copy would end on a packet boundary and keep the trailing hole.
    const plan = planJoinRepairTail({ tailKeyframe: 4, headKeyframe: 4, frameDuration });
    expect(plan).toStrictEqual({ kind: 'encode-whole' });
  });

  it('encodes the whole segment when the tail keyframe is only a frame past the head one', () => {
    const plan = planJoinRepairTail({ tailKeyframe: 4 + frameDuration, headKeyframe: 4, frameDuration });
    expect(plan).toStrictEqual({ kind: 'encode-whole' });
  });

  it('keeps the copy when the tail keyframe is two frames past the head one', () => {
    const plan = planJoinRepairTail({ tailKeyframe: 4 + (2 * frameDuration), headKeyframe: 4, frameDuration });
    expect(plan).toStrictEqual({ kind: 'copy-middle', copyTo: 4 + frameDuration });
  });

  it('falls back to the plain copy when no keyframe could be located', () => {
    const plan = planJoinRepairTail({ tailKeyframe: undefined, headKeyframe: 4, frameDuration });
    expect(plan).toStrictEqual({ kind: 'copy-only' });
  });
});
