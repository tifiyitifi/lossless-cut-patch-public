// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { shouldStartNewSegment } from './markStart.js';

const inside: { start: number, end: number } = { start: 10, end: 20 };

describe('shouldStartNewSegment', () => {
  it('adds a segment when armed, even inside the current one', () => {
    expect(shouldStartNewSegment({ forced: true, currentSegment: inside, relevantTime: 12 })).toBe(true);
  });

  it('moves the current start when not armed and the playhead is inside it', () => {
    expect(shouldStartNewSegment({ forced: false, currentSegment: inside, relevantTime: 12 })).toBe(false);
  });

  it('moves the current start when not armed and the playhead is before it', () => {
    expect(shouldStartNewSegment({ forced: false, currentSegment: inside, relevantTime: 2 })).toBe(false);
  });

  it('adds a segment when there is none', () => {
    expect(shouldStartNewSegment({ forced: false, currentSegment: undefined, relevantTime: 12 })).toBe(true);
  });

  it('adds a segment when armed and there is none either', () => {
    expect(shouldStartNewSegment({ forced: true, currentSegment: undefined, relevantTime: 12 })).toBe(true);
  });

  it('adds a segment when the playhead is at or past the current end', () => {
    expect(shouldStartNewSegment({ forced: false, currentSegment: inside, relevantTime: 20 })).toBe(true);
    expect(shouldStartNewSegment({ forced: false, currentSegment: inside, relevantTime: 21 })).toBe(true);
  });

  it('keeps moving the start of a marker (a segment without an end)', () => {
    expect(shouldStartNewSegment({ forced: false, currentSegment: { start: 10 }, relevantTime: 30 })).toBe(false);
  });

  it('starts the new segment of a marker when armed', () => {
    expect(shouldStartNewSegment({ forced: true, currentSegment: { start: 10 }, relevantTime: 30 })).toBe(true);
  });
});
