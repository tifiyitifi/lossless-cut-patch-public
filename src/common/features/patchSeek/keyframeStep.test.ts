// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { isTargetCovered, keyframePrefetchKey, mergeKeyframeTimes, resolveKeyframeStep, shouldReadKeyframes } from './keyframeStep.js';

const times = [0, 2, 4, 6, 8, 10, 12];
const sigma = 1 / 30;

type Direction = -1 | 1;

/**
Simulate a hold: after every press the hook remembers the target and the preview continues from
it. `drift` is how far the playhead moves between two presses (0 while paused).
*/
function runHold({ direction, start, drift, presses }: { direction: Direction, start: number, drift: number, presses: number }) {
  let liveTime = start;
  let commandedTime = start;
  let lastTarget: number | undefined;
  const targets: (number | undefined)[] = [];
  for (let press = 0; press < presses; press += 1) {
    const { target } = resolveKeyframeStep({ keyframeTimes: times, direction, liveTime, commandedTime, lastTarget, sigma });
    targets.push(target);
    if (target == null) break;
    lastTarget = target;
    commandedTime = target;
    liveTime = target + drift;
  }
  return targets;
}

function step({ direction, liveTime, commandedTime, lastTarget }: {
  direction: Direction;
  liveTime: number;
  commandedTime: number;
  lastTarget: number | undefined;
}) {
  return resolveKeyframeStep({ keyframeTimes: times, direction, liveTime, commandedTime, lastTarget, sigma });
}

describe('resolveKeyframeStep', () => {
  it('keeps stepping backwards while playing, instead of re-finding the same keyframe', () => {
    expect(runHold({ direction: -1, start: 8.8, drift: 0.05, presses: 6 })).toStrictEqual([8, 6, 4, 2, 0, undefined]);
  });

  it('keeps stepping forwards while playing', () => {
    expect(runHold({ direction: 1, start: 8.8, drift: 0.05, presses: 3 })).toStrictEqual([10, 12, undefined]);
  });

  it('behaves like upstream while paused (stable playhead)', () => {
    // Paused inside a GOP: its keyframe.
    expect(step({ direction: -1, liveTime: 8.5, commandedTime: 8.5, lastTarget: undefined }).target).toBe(8);
    // Paused one frame after a keyframe: still the same keyframe.
    expect(step({ direction: -1, liveTime: 8.2, commandedTime: 8.2, lastTarget: undefined }).target).toBe(8);
    // Paused on a keyframe: the previous one, then the one before that.
    expect(runHold({ direction: -1, start: 8, drift: 0, presses: 3 })).toStrictEqual([6, 4, 2]);
  });

  it('drops the anchor when playback leaves the anchor GOP', () => {
    const result = step({ direction: -1, liveTime: 10.5, commandedTime: 8, lastTarget: 8 });
    expect(result.usedAnchor).toBe(false);
    expect(result.target).toBe(10);
  });

  it('drops the anchor after a seek that did not come from a step (pause, timeline jump)', () => {
    // Paused at 9.5 after playing on from the keyframe at 8: the previous keyframe is 8, not 6.
    const paused = step({ direction: -1, liveTime: 9.5, commandedTime: 9.5, lastTarget: 8 });
    expect(paused.usedAnchor).toBe(false);
    expect(paused.target).toBe(8);
  });

  it('ignores a non-finite anchor instead of seeking to NaN', () => {
    const result = step({ direction: -1, liveTime: 8.5, commandedTime: 8.5, lastTarget: NaN });
    expect(result.usedAnchor).toBe(false);
    expect(result.target).toBe(8);
  });

  it('stops at the start and the end of the file', () => {
    expect(step({ direction: -1, liveTime: 0, commandedTime: 0, lastTarget: undefined }).target).toBeUndefined();
    expect(step({ direction: 1, liveTime: 12, commandedTime: 12, lastTarget: undefined }).target).toBeUndefined();
  });

  it('returns undefined when no keyframe is known', () => {
    const result = resolveKeyframeStep({ keyframeTimes: [], direction: -1, liveTime: 8, commandedTime: 8, lastTarget: undefined, sigma });
    expect(result.target).toBeUndefined();
    expect(result.base).toBe(8);
  });

  it('tolerates unsorted and duplicated keyframe lists', () => {
    const messy = [10, 2, 6, 2, 0, 8, 4];
    const result = resolveKeyframeStep({ keyframeTimes: messy, direction: -1, liveTime: 8.5, commandedTime: 8.5, lastTarget: undefined, sigma });
    expect(result.target).toBe(8);
  });

  it('falls back to the unknown-fps sigma when sigma is not usable', () => {
    const result = resolveKeyframeStep({ keyframeTimes: times, direction: -1, liveTime: 8.05, commandedTime: 8.05, lastTarget: undefined, sigma: 0 });
    expect(result.base).toBe(8.05);
    // 0.1s is wider than the 0.05s distance to the keyframe, so the keyframe is excluded.
    expect(result.target).toBe(6);
  });

  it('does not throw on NaN times', () => {
    const result = resolveKeyframeStep({ keyframeTimes: times, direction: -1, liveTime: NaN, commandedTime: NaN, lastTarget: undefined, sigma });
    expect(result.base).toBe(0);
    expect(result.target).toBeUndefined();
  });
});

/**
Upstream `findNearestKeyFrameTime` (src/renderer/src/ffmpeg.ts) plus the `+ direction * sigma`
that `seekClosestKeyframe` applies. It cannot be imported here: the renderer module reads
`window.require` at load time, which does not exist in the node test environment. Keep in sync.
*/
function upstreamTarget(keyframeTimes: readonly number[], direction: Direction, time: number) {
  const candidates = keyframeTimes.filter((candidate) => (direction > 0 ? candidate >= time : candidate <= time));
  if (candidates.length === 0) return undefined;
  return candidates.reduce((best, candidate) => (direction > 0 ? Math.min(best, candidate) : Math.max(best, candidate)));
}

describe('paused parity with upstream', () => {
  it('returns what the upstream query returns while the playhead stands still', () => {
    const positions = [0, 0.5, 2, 2.03, 2.2, 4, 7.9, 8, 8.03, 10, 11.5, 12, 12.5];
    for (const direction of [-1, 1] as const) {
      for (const start of positions) {
        let position = start;
        let lastTarget: number | undefined;
        for (let press = 0; press < 5; press += 1) {
          const expected = upstreamTarget(times, direction, position + direction * sigma);
          const result = resolveKeyframeStep({
            keyframeTimes: times,
            direction,
            liveTime: position,
            commandedTime: position,
            lastTarget,
            sigma,
          });
          expect(result.target, `direction ${direction}, start ${start}, press ${press}`).toBe(expected);
          if (result.target == null) break;
          lastTarget = result.target;
          position = result.target;
        }
      }
    }
  });
});

describe('mergeKeyframeTimes', () => {
  it('merges, deduplicates, sorts and drops non-finite times', () => {
    expect(mergeKeyframeTimes([4, 0], [2, 4, NaN, Infinity])).toStrictEqual([0, 2, 4]);
  });

  it('returns an empty list for no input', () => {
    expect(mergeKeyframeTimes()).toStrictEqual([]);
  });
});

describe('shouldReadKeyframes', () => {
  const coverage = [{ from: 0, to: 20 }];

  it('reads when the cache cannot provide a target', () => {
    expect(shouldReadKeyframes({ result: { target: undefined, base: 8, usedAnchor: false }, coverage })).toBe(true);
  });

  it('reads when nothing was read for this file yet', () => {
    // The upstream cache window is not proof: it is a window around a stale commanded time.
    expect(shouldReadKeyframes({ result: { target: 8, base: 8.5, usedAnchor: false }, coverage: [] })).toBe(true);
  });

  it('trusts a target whose whole span was read', () => {
    expect(shouldReadKeyframes({ result: { target: 8, base: 8.5, usedAnchor: false }, coverage })).toBe(false);
    expect(shouldReadKeyframes({ result: { target: 12, base: 8, usedAnchor: true }, coverage })).toBe(false);
  });

  it('reads when the step would cross a hole between two reads', () => {
    // What the log showed: the known times were [8.35, 16.69, 25.02, 250.02, 258.35] - two windows
    // with 26 unread keyframes between them. 225s looked like the next keyframe.
    const windows = [{ from: 0, to: 25.021 }, { from: 250.021, to: 283.008 }];
    const forward = resolveKeyframeStep({ keyframeTimes: [8.354, 16.688, 25.021, 250.021, 258.354], direction: 1, liveTime: 25.021, commandedTime: 25.021, lastTarget: 25.021, sigma });
    expect(forward.target).toBe(250.021); // what the old code did
    expect(shouldReadKeyframes({ result: forward, coverage: windows })).toBe(true);

    const backward = resolveKeyframeStep({ keyframeTimes: [66.688, 208.354, 216.688], direction: -1, liveTime: 208.354, commandedTime: 208.354, lastTarget: 208.354, sigma });
    expect(backward.target).toBe(66.688); // the log: 208.354 -> 66.688, 17 keyframes skipped
    expect(shouldReadKeyframes({ result: backward, coverage: [{ from: 60, to: 92 }, { from: 200, to: 217 }] })).toBe(true);
  });

  it('trusts the same step once the span is read', () => {
    const result = resolveKeyframeStep({ keyframeTimes: [8.354, 16.688, 25.021, 250.021], direction: 1, liveTime: 25.021, commandedTime: 25.021, lastTarget: 25.021, sigma });
    expect(shouldReadKeyframes({ result, coverage: [{ from: 0, to: 283.008 }] })).toBe(false);
  });
});

describe('isTargetCovered', () => {
  it('needs one range that contains the whole span, not two adjacent ones', () => {
    expect(isTargetCovered({ base: 10, target: 30, coverage: [{ from: 0, to: 15 }, { from: 15, to: 40 }] })).toBe(false);
    expect(isTargetCovered({ base: 10, target: 30, coverage: [{ from: 0, to: 40 }] })).toBe(true);
  });

  it('works in both directions', () => {
    expect(isTargetCovered({ base: 40, target: 10, coverage: [{ from: 0, to: 40 }] })).toBe(true);
    expect(isTargetCovered({ base: 40, target: 10, coverage: [{ from: 20, to: 40 }] })).toBe(false);
  });

  it('rejects a non-finite position', () => {
    expect(isTargetCovered({ base: NaN, target: 10, coverage: [{ from: 0, to: 40 }] })).toBe(false);
  });
});
describe('keyframePrefetchKey', () => {
  it('is different for the two directions', () => {
    // A window that was prefetched ahead of the playhead does not serve the step backwards.
    expect(keyframePrefetchKey({ direction: 1, center: 25, window: 10 })).not.toBe(keyframePrefetchKey({ direction: -1, center: 25, window: 10 }));
  });

  it('is the same for the same window', () => {
    expect(keyframePrefetchKey({ direction: 1, center: 25, window: 10 })).toBe(keyframePrefetchKey({ direction: 1, center: 25, window: 10 }));
  });

  it('is different for another position in the same window', () => {
    // The prefetch reads the window ahead of the playhead: two positions need two different reads
    // (the second one would be missing its tail otherwise).
    expect(keyframePrefetchKey({ direction: 1, center: 25, window: 10 })).not.toBe(keyframePrefetchKey({ direction: 1, center: 29, window: 10 }));
  });

  it('is different for two positions in the same second', () => {
    // The key identifies the range that was read: a read that starts a fraction of a second later
    // does not cover the first keyframes of the requested range, so it must not serve it.
    expect(keyframePrefetchKey({ direction: 1, center: 25, window: 60 })).not.toBe(keyframePrefetchKey({ direction: 1, center: 25.04, window: 60 }));
  });

  it('is different for another window size', () => {
    expect(keyframePrefetchKey({ direction: 1, center: 25, window: 10 })).not.toBe(keyframePrefetchKey({ direction: 1, center: 25, window: 20 }));
  });
});
