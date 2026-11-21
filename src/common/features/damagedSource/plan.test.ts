// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { getDamageRepairPlan } from './plan.js';
import { sourceDamageMissingCompositionOffsets, sourceDamageKinds } from './types.js';

describe('getDamageRepairPlan', () => {
  it('has a plan for every kind of damage', () => {
    for (const kind of sourceDamageKinds) {
      expect(getDamageRepairPlan(kind)).toBeDefined();
    }
  });

  it('needs a transcode for playback of a broken frame timing file', () => {
    expect(getDamageRepairPlan(sourceDamageMissingCompositionOffsets).playbackNeedsTranscode).toBe(true);
  });

  it('needs the exported video track re-encoded, because a copy keeps the damage', () => {
    expect(getDamageRepairPlan(sourceDamageMissingCompositionOffsets).exportNeedsVideoEncode).toBe(true);
  });

  it('keeps the resolution of the exported clips', () => {
    expect(getDamageRepairPlan(sourceDamageMissingCompositionOffsets).exportKeepResolution).toBe(true);
  });

  it('forbids encoding only the joins, because the copied middle stays broken', () => {
    expect(getDamageRepairPlan(sourceDamageMissingCompositionOffsets).forbidsPartialEncode).toBe(true);
  });
});
