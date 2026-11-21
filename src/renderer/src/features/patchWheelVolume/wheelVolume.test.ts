import { describe, expect, it } from 'vitest';

import { planPatchWheelVolume } from './wheelVolume';

const noModifiers = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };

describe('planPatchWheelVolume', () => {
  it('turns the volume up on a wheel up and down on a wheel down', () => {
    expect(planPatchWheelVolume({ modifiers: noModifiers, deltaY: -100 })).toBe(0.07);
    expect(planPatchWheelVolume({ modifiers: noModifiers, deltaY: 100 })).toBe(-0.07);
  });

  it('follows a custom step', () => {
    expect(planPatchWheelVolume({ modifiers: noModifiers, deltaY: -100, step: 0.1 })).toBe(0.1);
    expect(planPatchWheelVolume({ modifiers: noModifiers, deltaY: 100, step: 0.1 })).toBe(-0.1);
  });

  it('leaves a wheel with any modifier to the timeline wheel', () => {
    for (const modifierKey of ['ctrlKey', 'shiftKey', 'altKey', 'metaKey'] as const) {
      expect(planPatchWheelVolume({
        modifiers: { ...noModifiers, [modifierKey]: true },
        deltaY: -100,
      })).toBeUndefined();
    }
  });

  it('ignores a gesture without a vertical delta', () => {
    expect(planPatchWheelVolume({ modifiers: noModifiers, deltaY: 0 })).toBeUndefined();
  });
});
