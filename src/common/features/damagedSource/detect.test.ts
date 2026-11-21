// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { detectSourceDamage } from './detect.js';
import type { SourceProbeFacts } from './types.js';
import { sourceDamageMissingCompositionOffsets } from './types.js';

const facts = (overrides: Partial<SourceProbeFacts> = {}): SourceProbeFacts => ({
  hasVideo: true,
  hasBFrames: false,
  hasCtts: true,
  ...overrides,
});

describe('detectSourceDamage', () => {
  it('reports nothing for an audio-only file', () => {
    expect(detectSourceDamage(facts({ hasVideo: false, hasBFrames: true, hasCtts: false }))).toStrictEqual([]);
  });

  it('reports nothing for a file without B frames, even without composition offsets', () => {
    // A Constrained Baseline file stores its frames in display order, so pts === dts is correct.
    expect(detectSourceDamage(facts({ hasBFrames: false, hasCtts: false }))).toStrictEqual([]);
  });

  it('reports nothing for a B-frame file that has composition offsets', () => {
    expect(detectSourceDamage(facts({ hasBFrames: true, hasCtts: true, cttsAllZero: false }))).toStrictEqual([]);
  });

  it('reports the broken frame timing when a B-frame file has no ctts box at all', () => {
    const result = detectSourceDamage(facts({ hasBFrames: true, hasCtts: false }));
    expect(result.map((damage) => damage.kind)).toStrictEqual([sourceDamageMissingCompositionOffsets]);
  });

  it('reports it when the ctts box exists but every offset is zero', () => {
    const result = detectSourceDamage(facts({ hasBFrames: true, hasCtts: true, cttsAllZero: true }));
    expect(result.map((damage) => damage.kind)).toStrictEqual([sourceDamageMissingCompositionOffsets]);
  });

  it('keeps the probe facts as evidence', () => {
    const probe = facts({ hasBFrames: true, hasCtts: false });
    expect(detectSourceDamage(probe)[0]?.evidence).toBe(probe);
  });

  it('falls back to the first GOP when the header could not be read', () => {
    const result = detectSourceDamage(facts({ hasBFrames: true, hasCtts: undefined, firstGopPtsEqualsDts: true }));
    expect(result.map((damage) => damage.kind)).toStrictEqual([sourceDamageMissingCompositionOffsets]);
  });

  it('does not use the first GOP when the header says the file is fine', () => {
    // A correct file can have a first GOP without B frames, so the sample must not override the box.
    expect(detectSourceDamage(facts({ hasBFrames: true, hasCtts: true, cttsAllZero: false, firstGopPtsEqualsDts: true }))).toStrictEqual([]);
  });

  it('reports nothing when the header could not be read and the sample looks fine', () => {
    expect(detectSourceDamage(facts({ hasBFrames: true, hasCtts: undefined, firstGopPtsEqualsDts: false }))).toStrictEqual([]);
  });

  it('reports nothing when the header could not be read and there is no sample', () => {
    expect(detectSourceDamage(facts({ hasBFrames: true, hasCtts: undefined }))).toStrictEqual([]);
  });
});
