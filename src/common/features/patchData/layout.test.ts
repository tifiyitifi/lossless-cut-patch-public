// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { PatchLayoutFractions } from './layout.js';
import { computePatchLayoutSizes, defaultPatchLayoutFractions, distributeSpace, patchMinColumnWidth, planDefaultLayout, toDockviewInitialHeights } from './layout.js';

describe('defaultPatchLayoutFractions', () => {
  it('column fractions add up to 1', () => {
    const sum = defaultPatchLayoutFractions.columns.reduce((acc, value) => acc + value, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it('row fractions add up to 1 per column', () => {
    for (const rows of defaultPatchLayoutFractions.rows) {
      expect(rows.reduce((acc, value) => acc + value, 0)).toBeCloseTo(1, 10);
    }
  });

  it('keeps the middle (viewer) column the dominant one', () => {
    const [left = 0, middle = 0, right = 0] = defaultPatchLayoutFractions.columns;
    expect(middle).toBeGreaterThan(left + right);
  });

  it('gives the segment column more room than the file-list column', () => {
    const [left = 0, , right = 0] = defaultPatchLayoutFractions.columns;
    expect(right).toBeGreaterThan(left);
  });
});

describe('distributeSpace', () => {
  it('splits the default columns proportionally and adds up exactly', () => {
    const sizes = distributeSpace(2560, defaultPatchLayoutFractions.columns, patchMinColumnWidth);
    expect(sizes).toStrictEqual([256, 1920, 384]);
    expect(sizes.reduce((acc, value) => acc + value, 0)).toBe(2560);
  });

  it('absorbs rounding in the largest slice', () => {
    const sizes = distributeSpace(1000, [1 / 3, 1 / 3, 1 / 3], 0);
    expect(sizes.reduce((acc, value) => acc + value, 0)).toBe(1000);
  });

  it('honours the minimum size and still fills the total', () => {
    const sizes = distributeSpace(1000, [0.1, 0.6, 0.3], 150);
    expect(sizes[0]).toBe(150);
    expect(sizes.reduce((acc, value) => acc + value, 0)).toBe(1000);
  });
});

describe('computePatchLayoutSizes', () => {
  it('produces one width per column and one height per row', () => {
    const sizes = computePatchLayoutSizes(2560, 1355);
    expect(sizes.columns).toHaveLength(3);
    expect(sizes.rows.map((row) => row.length)).toStrictEqual([3, 2, 2]);
  });

  it('fills the window exactly', () => {
    const sizes = computePatchLayoutSizes(1920, 1080);
    expect(sizes.columns.reduce((acc, value) => acc + value, 0)).toBe(1920);
    for (const rows of sizes.rows) {
      expect(rows.reduce((acc, value) => acc + value, 0)).toBe(1080);
    }
  });

  it('keeps the player row the largest of the middle column', () => {
    const sizes = computePatchLayoutSizes(1920, 1080);
    const [player = 0, consoleHeight = 0] = sizes.rows[1] ?? [];
    expect(player).toBeGreaterThan(consoleHeight * 3);
  });

  it('keeps the file list the largest row of the left column', () => {
    const [workDir = 0, videoList = 0, keyGuide = 0] = computePatchLayoutSizes(2560, 1355).rows[0] ?? [];
    expect(videoList).toBeGreaterThan(workDir);
    expect(videoList).toBeGreaterThan(keyGuide);
  });

  it('scales with the window (percentages, not fixed pixels)', () => {
    const large = computePatchLayoutSizes(2560, 1355);
    const larger = computePatchLayoutSizes(3200, 1355);
    expect(large.columns).toStrictEqual([256, 1920, 384]);
    expect(larger.columns[1] ?? 0).toBeGreaterThan(large.columns[1] ?? 0);
    expect((large.columns[1] ?? 0) / 2560).toBeCloseTo(0.75, 3);
    expect((larger.columns[1] ?? 0) / 3200).toBeCloseTo(0.75, 3);
  });

  it('widens the narrow side columns instead of crushing them', () => {
    const sizes = computePatchLayoutSizes(1280, 800);
    expect(sizes.columns[0]).toBe(patchMinColumnWidth);
    expect(sizes.columns[2]).toBe(patchMinColumnWidth);
    expect(sizes.columns.reduce((acc, value) => acc + value, 0)).toBe(1280);
  });

  it('accepts a custom fraction set', () => {
    const fractions: PatchLayoutFractions = { columns: [0.5, 0.5], rows: [[0.25, 0.75], [1]] };
    const sizes = computePatchLayoutSizes(1000, 800, fractions);
    expect(sizes.columns).toStrictEqual([500, 500]);
    expect(sizes.rows).toStrictEqual([[200, 600], [800]]);
  });
});

describe('toDockviewInitialHeights', () => {
  it('reserves the heights of all following rows', () => {
    expect(toDockviewInitialHeights([120, 600, 280])).toStrictEqual([880, 280]);
  });

  it('returns one value per row after the first', () => {
    expect(toDockviewInitialHeights([800, 200])).toStrictEqual([200]);
    expect(toDockviewInitialHeights([1000])).toStrictEqual([]);
    expect(toDockviewInitialHeights([])).toStrictEqual([]);
  });
});

describe('planDefaultLayout', () => {
  const specs = planDefaultLayout(2560, 1355);

  it('plans every panel once', () => {
    expect(specs.map((spec) => spec.id)).toStrictEqual(['player', 'workDir', 'segments', 'videoList', 'keyGuide', 'console', 'mergePreview']);
  });

  it('starts with the panel that fills the window (no position, no size)', () => {
    const [first] = specs;
    expect(first?.id).toBe('player');
    expect(first?.position).toBeUndefined();
    expect(first?.initialWidth).toBeUndefined();
    expect(first?.initialHeight).toBeUndefined();
  });

  it('only positions panels against an already-added panel', () => {
    const seen = new Set<string>();
    for (const spec of specs) {
      if (spec.position != null) expect(seen.has(spec.position.referencePanel)).toBe(true);
      seen.add(spec.id);
    }
  });

  it('gives the side columns explicit widths and the viewer none', () => {
    const workDir = specs.find((spec) => spec.id === 'workDir');
    const segments = specs.find((spec) => spec.id === 'segments');
    const player = specs.find((spec) => spec.id === 'player');
    expect(workDir?.position?.direction).toBe('left');
    expect(workDir?.initialWidth).toBe(256);
    expect(segments?.position?.direction).toBe('right');
    expect(segments?.initialWidth).toBe(384);
    expect(player?.initialWidth).toBeUndefined();
  });

  it('gives every added row an initial height', () => {
    for (const spec of specs) {
      if (spec.position?.direction === 'below') expect(spec.initialHeight).toBeGreaterThan(0);
    }
  });

  it('reserves the remaining height for the first row of each column', () => {
    const videoList = specs.find((spec) => spec.id === 'videoList');
    const keyGuide = specs.find((spec) => spec.id === 'keyGuide');
    // 15 / 55 / 30 of 1355 -> videoList reserves its own + keyGuide (55% + 30%), keyGuide only 30%.
    expect(videoList?.initialHeight).toBe(1152);
    expect(keyGuide?.initialHeight).toBe(407);
  });
});
