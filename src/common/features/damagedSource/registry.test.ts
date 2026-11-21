// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { getSourceRepair, sourceRepairs } from './registry.js';
import { sourceDamageKinds, sourceDamageMissingCompositionOffsets } from './types.js';

describe('sourceRepairs registry', () => {
  it('declares exactly the kinds the type allows', () => {
    expect(sourceRepairs.map((repair) => repair.kind).sort()).toStrictEqual([...sourceDamageKinds].sort());
  });

  it('gives every repair a detection rule and a plan', () => {
    for (const repair of sourceRepairs) {
      expect(repair.detect).toBeTypeOf('function');
      expect(Object.values(repair.plan).every((value) => typeof value === 'boolean')).toBe(true);
    }
  });

  it('does not repeat a kind', () => {
    const kinds = sourceRepairs.map((repair) => repair.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it('looks a repair up by kind', () => {
    expect(getSourceRepair(sourceDamageMissingCompositionOffsets).kind).toBe(sourceDamageMissingCompositionOffsets);
  });
});
