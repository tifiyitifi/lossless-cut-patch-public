// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import {
  getDefaultFinishSource, getFinishPresetChoices, getFinishSourceChoices, normalizeFinishSourceForFlow, withFinishFlowSource,
} from './flow.js';

describe('getFinishSourceChoices', () => {
  it('does not offer skip to Shift+E', () => {
    expect(getFinishSourceChoices('finish')).toStrictEqual(['finished', 'detached', 'keep']);
  });

  it('offers every destination to Shift+F, skip included', () => {
    expect(getFinishSourceChoices('keepSource')).toStrictEqual(['finished', 'skip', 'detached', 'keep']);
  });
});

describe('getFinishPresetChoices', () => {
  it('does not offer the skip preset to Shift+E', () => {
    expect(getFinishPresetChoices('finish')).toStrictEqual(['one-video', 'archive', 'loop-video']);
  });

  it('offers the skip preset to Shift+F', () => {
    expect(getFinishPresetChoices('keepSource')).toContain('skip');
  });
});

describe('getDefaultFinishSource', () => {
  it('parks the source for deletion when finishing, and keeps it when skipping', () => {
    expect(getDefaultFinishSource('finish')).toBe('detached');
    expect(getDefaultFinishSource('keepSource')).toBe('skip');
  });
});

describe('normalizeFinishSourceForFlow', () => {
  it('drops a skip stored by an older build out of the Shift+E workflow', () => {
    expect(normalizeFinishSourceForFlow('finish', 'skip')).toBe('detached');
  });

  it('keeps the destinations the flow offers, including skip for Shift+F', () => {
    for (const source of ['finished', 'detached', 'keep'] as const) {
      expect(normalizeFinishSourceForFlow('finish', source)).toBe(source);
    }
    for (const source of ['finished', 'skip', 'detached', 'keep'] as const) {
      expect(normalizeFinishSourceForFlow('keepSource', source)).toBe(source);
    }
  });
});

describe('withFinishFlowSource', () => {
  it('returns the same object when nothing has to change', () => {
    const options = { source: 'finished' as const, next: 'next' as const };
    expect(withFinishFlowSource('finish', options)).toBe(options);
  });

  it('replaces only the source', () => {
    const options = { source: 'skip' as const, next: 'none' as const };
    expect(withFinishFlowSource('finish', options)).toStrictEqual({ source: 'detached', next: 'none' });
  });
});
