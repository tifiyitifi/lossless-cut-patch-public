// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { fixedPlaybackRateStep, parsePlaybackRateStepMode, parseRememberedPlaybackRate, planPlaybackRateToggle, stepPlaybackRate } from './playbackRate.js';

describe('parseRememberedPlaybackRate', () => {
  it('keeps a rate inside the player range', () => {
    expect(parseRememberedPlaybackRate(1)).toBe(1);
    expect(parseRememberedPlaybackRate(0.5)).toBe(0.5);
    expect(parseRememberedPlaybackRate(2)).toBe(2);
    expect(parseRememberedPlaybackRate(16)).toBe(16);
    expect(parseRememberedPlaybackRate(0.1)).toBe(0.1);
  });

  it('falls back to 1x for anything a hand edit could have left there', () => {
    for (const value of [undefined, null, '2', NaN, Infinity, 0, -1, 0.05, 17]) {
      expect(parseRememberedPlaybackRate(value)).toBe(1);
    }
  });
});

describe('planPlaybackRateToggle', () => {
  it('remembers the current rate and goes to 1x', () => {
    expect(planPlaybackRateToggle({ currentRate: 2, rememberedRate: 1 })).toStrictEqual({ rate: 1, rememberedRate: 2 });
    expect(planPlaybackRateToggle({ currentRate: 0.5, rememberedRate: 2 })).toStrictEqual({ rate: 1, rememberedRate: 0.5 });
  });

  it('restores the remembered rate from 1x and keeps it remembered', () => {
    expect(planPlaybackRateToggle({ currentRate: 1, rememberedRate: 2 })).toStrictEqual({ rate: 2, rememberedRate: 2 });
    expect(planPlaybackRateToggle({ currentRate: 1, rememberedRate: 0.5 })).toStrictEqual({ rate: 0.5, rememberedRate: 0.5 });
  });

  it('does nothing at 1x with nothing remembered', () => {
    expect(planPlaybackRateToggle({ currentRate: 1, rememberedRate: 1 })).toStrictEqual({ rate: 1, rememberedRate: 1 });
  });

  it('treats a garbage remembered rate as "nothing remembered"', () => {
    expect(planPlaybackRateToggle({ currentRate: 1, rememberedRate: NaN })).toStrictEqual({ rate: 1, rememberedRate: 1 });
    expect(planPlaybackRateToggle({ currentRate: 1, rememberedRate: 99 })).toStrictEqual({ rate: 1, rememberedRate: 1 });
  });

  it('does not remember a garbage current rate', () => {
    expect(planPlaybackRateToggle({ currentRate: NaN, rememberedRate: 2 })).toStrictEqual({ rate: 1, rememberedRate: 1 });
  });

  it('round-trips: 1x -> 2x -> 1x -> 2x', () => {
    const first = planPlaybackRateToggle({ currentRate: 1, rememberedRate: 2 });
    expect(first.rate).toBe(2);
    const second = planPlaybackRateToggle({ currentRate: first.rate, rememberedRate: first.rememberedRate });
    expect(second).toStrictEqual({ rate: 1, rememberedRate: 2 });
    const third = planPlaybackRateToggle({ currentRate: second.rate, rememberedRate: second.rememberedRate });
    expect(third).toStrictEqual({ rate: 2, rememberedRate: 2 });
  });
});

describe('parsePlaybackRateStepMode', () => {
  it('keeps the two known modes', () => {
    expect(parsePlaybackRateStepMode('base')).toBe('base');
    expect(parsePlaybackRateStepMode('fixed')).toBe('fixed');
  });

  it('falls back to the patch default (fixed) for anything else', () => {
    for (const value of [undefined, null, 'multiply', 0, true]) {
      expect(parsePlaybackRateStepMode(value)).toBe('fixed');
    }
  });
});

describe('stepPlaybackRate', () => {
  it('steps by a fixed 0.1', () => {
    expect(fixedPlaybackRateStep).toBe(0.1);
    expect(stepPlaybackRate({ currentRate: 1, direction: 1 })).toBe(1.1);
    expect(stepPlaybackRate({ currentRate: 1, direction: -1 })).toBe(0.9);
    expect(stepPlaybackRate({ currentRate: 0.7, direction: 1 })).toBe(0.8);
  });

  it('stops at the player range', () => {
    expect(stepPlaybackRate({ currentRate: 0.1, direction: -1 })).toBe(0.1);
    expect(stepPlaybackRate({ currentRate: 16, direction: 1 })).toBe(16);
  });

  it('cleans up the floating point drift so presses stay on the 0.1 grid', () => {
    expect(stepPlaybackRate({ currentRate: 0.2, direction: 1 })).toBe(0.3);
    expect(stepPlaybackRate({ currentRate: 0.30000000000000004, direction: 1 })).toBe(0.4);
  });

  it('uses the multiplier for the "more" keys', () => {
    expect(stepPlaybackRate({ currentRate: 1, direction: 1, multiplier: 2 })).toBe(1.2);
    expect(stepPlaybackRate({ currentRate: 1, direction: -1, multiplier: 2 })).toBe(0.8);
  });

  it('treats direction 0 as slowing down, like the base rate calculator', () => {
    expect(stepPlaybackRate({ currentRate: 1, direction: 0 })).toBe(0.9);
  });
});
