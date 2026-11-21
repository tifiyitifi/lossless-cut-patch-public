// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { getPlayerWindowBounds, patchPlayerCascadeOffset } from './windowBounds.js';

const workArea = { x: 0, y: 0, width: 1920, height: 1080 };

describe('getPlayerWindowBounds', () => {
  it('uses the cutting window size, cascaded', () => {
    expect(getPlayerWindowBounds({ mainBounds: { x: 100, y: 100, width: 1600, height: 900 }, workArea })).toStrictEqual({
      x: 100 + patchPlayerCascadeOffset,
      y: 100 + patchPlayerCascadeOffset,
      width: 1600,
      height: 900,
    });
  });

  it('keeps the player inside the work area near the screen edge', () => {
    expect(getPlayerWindowBounds({ mainBounds: { x: 1000, y: 600, width: 1600, height: 900 }, workArea })).toStrictEqual({
      x: 1920 - 1600,
      y: 1080 - 900,
      width: 1600,
      height: 900,
    });
  });

  it('shrinks to the work area when the cutting window does not fit', () => {
    expect(getPlayerWindowBounds({ mainBounds: { x: 0, y: 0, width: 3000, height: 2000 }, workArea })).toStrictEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
  });

  it('never opens smaller than the minimum size', () => {
    expect(getPlayerWindowBounds({ mainBounds: { x: 0, y: 0, width: 100, height: 100 }, workArea })).toStrictEqual({
      x: patchPlayerCascadeOffset,
      y: patchPlayerCascadeOffset,
      width: 320,
      height: 240,
    });
  });

  it('respects a display to the left of the primary one', () => {
    const leftWorkArea = { x: -1920, y: 0, width: 1920, height: 1080 };
    expect(getPlayerWindowBounds({ mainBounds: { x: -1900, y: 100, width: 1600, height: 900 }, workArea: leftWorkArea })).toStrictEqual({
      x: -1900 + patchPlayerCascadeOffset,
      y: 100 + patchPlayerCascadeOffset,
      width: 1600,
      height: 900,
    });
  });
});
