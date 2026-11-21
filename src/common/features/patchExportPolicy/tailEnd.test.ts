// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { getPatchTailTargets, planPatchTailEnd } from './tailEnd.js';

const frame = 1 / 60;

describe('planPatchTailEnd', () => {
  it('reaches the source end when the last result is the last of the timeline', () => {
    const plan = planPatchTailEnd({
      requestedEnd: 1544,
      fileDuration: 1544,
      frameDuration: frame,
      sourceEnd: 1546.1,
      isTimelineLast: true,
    });
    expect(plan.mode).toBe('end');
    // Past the source end: the copy writes the last frame and the whole tail.
    expect(plan.cutTo).toBeCloseTo(1546.1 + frame, 10);
  });

  it('uses the file duration when the source end could not be read', () => {
    const plan = planPatchTailEnd({
      requestedEnd: 100,
      fileDuration: 100,
      frameDuration: frame,
      sourceEnd: undefined,
      isTimelineLast: true,
    });
    expect(plan.mode).toBe('end');
    expect(plan.cutTo).toBeCloseTo(100 + frame, 10);
  });

  it('keeps a timeline-last cut that stops before the file end', () => {
    // The reported bug: 1:36:41.882 is the end of the content the user wants, while the source has
    // another 22 minutes after it. Being the last segment of the timeline must not keep that tail.
    const plan = planPatchTailEnd({
      requestedEnd: 5801.882,
      fileDuration: 7128.0855,
      frameDuration: frame,
      sourceEnd: 7128.0855,
      isTimelineLast: true,
    });
    expect(plan.mode).toBe('frame');
    expect(plan.cutTo).toBeCloseTo(5801.882 + frame, 10);
  });

  it('reaches the end when the cut is one frame before the file end', () => {
    const plan = planPatchTailEnd({
      requestedEnd: 100 - frame,
      fileDuration: 100,
      frameDuration: frame,
      sourceEnd: 100,
      isTimelineLast: true,
    });
    expect(plan.mode).toBe('end');
  });

  it('does not reach the end when the cut stops clearly before it', () => {
    const plan = planPatchTailEnd({
      requestedEnd: 99,
      fileDuration: 100,
      frameDuration: frame,
      sourceEnd: 100,
      isTimelineLast: true,
    });
    expect(plan.mode).toBe('frame');
    expect(plan.cutTo).toBeCloseTo(99 + frame, 10);
  });

  it('keeps a cut at the requested end when neither duration is known', () => {
    const plan = planPatchTailEnd({
      requestedEnd: 42,
      fileDuration: undefined,
      frameDuration: frame,
      sourceEnd: undefined,
      isTimelineLast: true,
    });
    expect(plan.mode).toBe('frame');
    expect(plan.cutTo).toBeCloseTo(42 + frame, 10);
  });

  it('falls back to the source end when the player duration is unknown', () => {
    const plan = planPatchTailEnd({
      requestedEnd: 100,
      fileDuration: undefined,
      frameDuration: frame,
      sourceEnd: 100,
      isTimelineLast: true,
    });
    expect(plan.mode).toBe('end');
    expect(plan.cutTo).toBeCloseTo(100 + frame, 10);
  });

  it('does not extend a timeline-last cut when the player duration is unknown and the cut stops early', () => {
    const plan = planPatchTailEnd({
      requestedEnd: 90,
      fileDuration: undefined,
      frameDuration: frame,
      sourceEnd: 100,
      isTimelineLast: true,
    });
    expect(plan.mode).toBe('frame');
    expect(plan.cutTo).toBeCloseTo(90 + frame, 10);
  });

  it('only includes the frame at the end for a mid-source cut', () => {
    const plan = planPatchTailEnd({
      requestedEnd: 100,
      fileDuration: 200,
      frameDuration: frame,
      sourceEnd: 200,
      isTimelineLast: false,
    });
    expect(plan.mode).toBe('frame');
    expect(plan.cutTo).toBeCloseTo(100 + frame, 10);
  });

  it('does not go past the source end for a mid-source cut', () => {
    const plan = planPatchTailEnd({
      requestedEnd: 100,
      fileDuration: 200,
      frameDuration: frame,
      sourceEnd: 100,
      isTimelineLast: false,
    });
    expect(plan.cutTo).toBeCloseTo(100 + frame, 10);
  });

  it('uses the fallback frame duration when the frame rate is unknown', () => {
    const plan = planPatchTailEnd({
      requestedEnd: 100,
      fileDuration: 200,
      frameDuration: NaN,
      sourceEnd: 200,
      isTimelineLast: false,
    });
    expect(plan.cutTo).toBeCloseTo(100 + 1 / 30, 10);
  });
});

describe('getPatchTailTargets', () => {
  const segments = [
    { segId: 'a', end: 10 },
    { segId: 'b', end: 20 },
  ];

  it('gives end to the time-last segment and frame to the queue-last when they differ', () => {
    // b is the time-last (end 20, reaches 20); a is last in the export order.
    const targets = getPatchTailTargets({
      segments: [segments[1]!, segments[0]!],
      allSegments: segments,
      fileDuration: 20,
      frameDuration: frame,
      sourceEnd: 25,
    });
    expect(targets).toHaveLength(2);
    const end = targets.find((target) => target.mode === 'end');
    const fr = targets.find((target) => target.mode === 'frame');
    expect(end?.segId).toBe('b');
    expect(end?.cutTo).toBeCloseTo(25 + frame, 10);
    expect(fr?.segId).toBe('a');
    expect(fr?.cutTo).toBeCloseTo(10 + frame, 10);
  });

  it('lets end win when the time-last segment is also last in the export order', () => {
    const targets = getPatchTailTargets({
      segments,
      allSegments: segments,
      fileDuration: 20,
      frameDuration: frame,
      sourceEnd: 25,
    });
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ segId: 'b', mode: 'end' });
  });

  it('gives frame only to the queue-last when the time-last does not reach the source end', () => {
    const targets = getPatchTailTargets({
      segments: [segments[1]!, segments[0]!],
      allSegments: segments,
      fileDuration: 100,
      frameDuration: frame,
      sourceEnd: 100,
    });
    // b is time-last but stops at 20, far before the source end: it needs no extension, and as a
    // middle clip its end frame is supplied by the next one. Only the queue-last (a) gets frame.
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ segId: 'a', mode: 'frame' });
    expect(targets[0]?.cutTo).toBeCloseTo(10 + frame, 10);
  });

  it('gives frame to the time-last segment when it is queue-last but stops before the source end', () => {
    const targets = getPatchTailTargets({
      segments,
      allSegments: segments,
      fileDuration: 100,
      frameDuration: frame,
      sourceEnd: 100,
    });
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ segId: 'b', mode: 'frame' });
    expect(targets[0]?.cutTo).toBeCloseTo(20 + frame, 10);
  });

  it('keeps the end target unchanged when the time-last segment is moved to the front', () => {
    const forward = getPatchTailTargets({
      segments,
      allSegments: segments,
      fileDuration: 20,
      frameDuration: frame,
      sourceEnd: 25,
    });
    const reordered = getPatchTailTargets({
      segments: [segments[1]!, segments[0]!],
      allSegments: segments,
      fileDuration: 20,
      frameDuration: frame,
      sourceEnd: 25,
    });
    const endOf = (targets: typeof forward) => targets.find((target) => target.mode === 'end');
    expect(endOf(reordered)).toStrictEqual(endOf(forward));
  });

  it('picks the end target deterministically when segments share the same end', () => {
    const tied = [{ segId: 'a', end: 20 }, { segId: 'b', end: 20 }];
    const forward = getPatchTailTargets({
      segments: tied,
      allSegments: tied,
      fileDuration: 20,
      frameDuration: frame,
      sourceEnd: 25,
    });
    const reordered = getPatchTailTargets({
      segments: [tied[1]!, tied[0]!],
      allSegments: tied,
      fileDuration: 20,
      frameDuration: frame,
      sourceEnd: 25,
    });
    const endOf = (targets: typeof forward) => targets.find((target) => target.mode === 'end');
    expect(endOf(reordered)).toStrictEqual(endOf(forward));
  });

  it('returns nothing when the export has no segments', () => {
    expect(getPatchTailTargets({
      segments: [],
      allSegments: segments,
      fileDuration: 20,
      frameDuration: frame,
      sourceEnd: 25,
    })).toStrictEqual([]);
  });
});
