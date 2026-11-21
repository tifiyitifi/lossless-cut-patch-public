// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { isSameFrameTime, planFrameStep, resolveFrameStepFps } from './frameStep.js';

describe('resolveFrameStepFps', () => {
  it('keeps a usable FPS', () => {
    expect(resolveFrameStepFps(30)).toBe(30);
    expect(resolveFrameStepFps(23.976)).toBe(23.976);
    expect(resolveFrameStepFps(60)).toBe(60);
  });

  it('falls back to 30 for anything unusable', () => {
    for (const value of [undefined, NaN, 0, -30, Infinity]) {
      expect(resolveFrameStepFps(value)).toBe(30);
    }
  });
});

describe('planFrameStep', () => {
  const fps = 30;

  it('moves exactly one frame in each direction', () => {
    expect(planFrameStep({ anchor: 1, direction: 1, fps, duration: 10 })).toStrictEqual({ frame: 31, time: 31 / 30 });
    expect(planFrameStep({ anchor: 1, direction: -1, fps, duration: 10 })).toStrictEqual({ frame: 29, time: 29 / 30 });
  });

  it('rounds a position between frames to the frame the picture shows', () => {
    // 1.004s is between frame 30 and 31 at 30fps; the nearest frame is 30.
    expect(planFrameStep({ anchor: 1.004, direction: 1, fps, duration: 10 }).frame).toBe(31);
    expect(planFrameStep({ anchor: 1.004, direction: -1, fps, duration: 10 }).frame).toBe(29);
    // 1.02s is nearer frame 31.
    expect(planFrameStep({ anchor: 1.02, direction: 1, fps, duration: 10 }).frame).toBe(32);
  });

  it('does not step before the start of the file', () => {
    expect(planFrameStep({ anchor: 0, direction: -1, fps, duration: 10 })).toStrictEqual({ frame: 0, time: 0 });
    expect(planFrameStep({ anchor: 0.005, direction: -1, fps, duration: 10 })).toStrictEqual({ frame: 0, time: 0 });
  });

  it('clamps the last step to the duration', () => {
    const last = planFrameStep({ anchor: 9.99, direction: 1, fps, duration: 10 });
    expect(last.time).toBe(10);
    expect(last.frame).toBe(300);
  });

  it('does not clamp when the duration is unknown', () => {
    expect(planFrameStep({ anchor: 1, direction: 1, fps, duration: undefined }).time).toBe(31 / 30);
    expect(planFrameStep({ anchor: 1, direction: 1, fps, duration: NaN }).time).toBe(31 / 30);
  });

  it('uses 30fps when the FPS is unknown', () => {
    expect(planFrameStep({ anchor: 1, direction: 1, fps: undefined, duration: 10 })).toStrictEqual({ frame: 31, time: 31 / 30 });
    expect(planFrameStep({ anchor: 1, direction: 1, fps: 0, duration: 10 })).toStrictEqual({ frame: 31, time: 31 / 30 });
  });

  it('treats a garbage anchor as the start of the file', () => {
    expect(planFrameStep({ anchor: NaN, direction: 1, fps, duration: 10 }).frame).toBe(1);
    expect(planFrameStep({ anchor: -5, direction: 1, fps, duration: 10 }).frame).toBe(1);
  });

  it('keeps the position for a zero direction', () => {
    expect(planFrameStep({ anchor: 1, direction: 0, fps, duration: 10 })).toStrictEqual({ frame: 30, time: 1 });
  });

  it('stays one frame apart across repeated steps', () => {
    let anchor = 0;
    for (let i = 1; i <= 5; i += 1) {
      const plan = planFrameStep({ anchor, direction: 1, fps, duration: 10 });
      expect(plan.frame).toBe(i);
      anchor = plan.time;
    }
    for (let i = 4; i >= 0; i -= 1) {
      const plan = planFrameStep({ anchor, direction: -1, fps, duration: 10 });
      expect(plan.frame).toBe(i);
      anchor = plan.time;
    }
  });

  it('handles a fractional FPS', () => {
    const ntsc = 30000 / 1001;
    const plan = planFrameStep({ anchor: 1, direction: 1, fps: ntsc, duration: 10 });
    expect(plan.frame).toBe(Math.round(ntsc) + 1);
    expect(plan.time).toBeCloseTo(plan.frame / ntsc, 9);
  });
});

describe('isSameFrameTime', () => {
  it('accepts the same frame and rejects a different one', () => {
    expect(isSameFrameTime(1, 1, 30)).toBe(true);
    expect(isSameFrameTime(1, 1 + 1 / 30, 30)).toBe(false);
    // Half a frame of rounding slack.
    expect(isSameFrameTime(1, 1 + 0.4 / 30, 30)).toBe(true);
  });

  it('uses the fallback FPS when the real one is unknown', () => {
    expect(isSameFrameTime(1, 1 + 1 / 30, undefined)).toBe(false);
    expect(isSameFrameTime(1, 1 + 0.4 / 30, undefined)).toBe(true);
  });
});
