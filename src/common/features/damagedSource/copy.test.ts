// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { getSourceRepairCopy } from './copy.js';
import { sourceDamageKinds } from './types.js';

/** The real one resolves keys; the identity makes the assertions independent of the translation files. */
const t = (key: string) => key;

describe('getSourceRepairCopy', () => {
  it('names every kind of damage the registry can detect', () => {
    for (const kind of sourceDamageKinds) {
      const copy = getSourceRepairCopy(kind, t);
      expect(copy.title.trim()).not.toBe('');
      expect(copy.symptom.trim()).not.toBe('');
      expect(copy.title).not.toBe(copy.symptom);
    }
  });

  it('keeps the technical name of the defect in the title', () => {
    // The menu is the only place a user can find out what is actually wrong with the file.
    expect(getSourceRepairCopy('missingCompositionOffsets', t).title).toContain('ctts');
  });
});
