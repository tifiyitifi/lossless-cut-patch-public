// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { TimecodeFormat } from '../../types.js';
import { getTimecodeHintGroups } from './formatHints.js';
import { parseCompactTimeInput } from './parseCompactTime.js';

const allModes: TimecodeFormat[] = ['timecodeWithDecimalFraction', 'frameCount', 'seconds', 'timecodeWithFramesFraction'];

describe('getTimecodeHintGroups', () => {
  it('lists the compact formats and the current format for every mode', () => {
    for (const mode of allModes) {
      const groups = getTimecodeHintGroups({ mode, showRelative: true });
      expect(groups.map((group) => group.id)).toStrictEqual(['compact', 'mode']);
      for (const group of groups) expect(group.hints.length).toBeGreaterThan(0);
    }
  });

  it('keeps every compact example parseable', () => {
    const [compact] = getTimecodeHintGroups({ mode: 'seconds', showRelative: true });
    for (const hint of compact!.hints) {
      if (hint.id === 'relative') {
        expect(parseCompactTimeInput(hint.example.replace(/^[+-]/, ''))).toBeDefined();
      } else {
        expect(parseCompactTimeInput(hint.example)).toBeDefined();
      }
    }
  });

  it('offers the relative seek only where the dialog allows it', () => {
    const hintIds = (showRelative: boolean) => getTimecodeHintGroups({ mode: 'seconds', showRelative })[0]!.hints.map((hint) => hint.id);
    expect(hintIds(true)).toContain('relative');
    expect(hintIds(false)).not.toContain('relative');
  });

  it('does not repeat a hint within a mode', () => {
    for (const mode of allModes) {
      const ids = getTimecodeHintGroups({ mode, showRelative: true }).flatMap((group) => group.hints.map((hint) => hint.id));
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
