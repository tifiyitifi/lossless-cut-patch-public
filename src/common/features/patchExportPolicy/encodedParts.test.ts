// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { getEncodedFragmentDuration, getSmartCutHeadEnd } from './encodedParts.js';

const frameDuration = 1 / 25;

describe('getSmartCutHeadEnd', () => {
  it('stops one frame before the keyframe the copy starts on', () => {
    expect(getSmartCutHeadEnd({ cutFrom: 10, nextKeyframe: 14, frameDuration })).toBeCloseTo(13.96);
  });

  it('keeps one frame when the cut starts inside the last frame before the keyframe', () => {
    // 551.009034 is 31 ms before the keyframe at 551.040 - less than one frame.
    expect(getSmartCutHeadEnd({ cutFrom: 551.009034, nextKeyframe: 551.04, frameDuration })).toBeCloseTo(551.049034);
  });
});

describe('getEncodedFragmentDuration', () => {
  it('keeps the frame that starts exactly at the end of a one-frame head', () => {
    // Regression for a real export: the head window was 551.009034..551.049034, its only frame was
    // timestamped exactly 0.040000, and `-t 0.04` (an open interval) dropped it. The encoded part
    // then contained audio only and the concat failed with `Stream map '' matches no streams`.
    const cutFrom = 551.009034;
    const cutTo = getSmartCutHeadEnd({ cutFrom, nextKeyframe: 551.04, frameDuration });
    const duration = getEncodedFragmentDuration({ cutFrom, cutTo, frameDuration });
    expect(duration).toBeGreaterThan(cutTo - cutFrom);
    expect(duration).toBeLessThan(cutTo - cutFrom + frameDuration);
  });

  it('never reaches the next frame', () => {
    const cutFrom = 10;
    const cutTo = 12;
    const duration = getEncodedFragmentDuration({ cutFrom, cutTo, frameDuration });
    expect(duration).toBeGreaterThan(2);
    expect(duration).toBeLessThan(2 + frameDuration);
  });

  it('leaves the length alone when the frame rate is unusable', () => {
    expect(getEncodedFragmentDuration({ cutFrom: 0, cutTo: 2, frameDuration: 0 })).toBe(2);
    expect(getEncodedFragmentDuration({ cutFrom: 0, cutTo: 2, frameDuration: NaN })).toBe(2);
    expect(getEncodedFragmentDuration({ cutFrom: 2, cutTo: 2, frameDuration })).toBe(0);
  });
});
