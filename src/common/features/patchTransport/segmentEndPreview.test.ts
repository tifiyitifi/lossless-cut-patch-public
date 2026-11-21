// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import getSegmentEndPreviewTime, { resolveSegmentEndPreviewRange } from './segmentEndPreview.js';

const segment = { start: 10, end: 20, leadInSeconds: 3 };

describe('getSegmentEndPreviewTime', () => {
  it('lands a lead-in before the end', () => {
    expect(getSegmentEndPreviewTime({ ...segment, currentTime: 10 })).toBe(17);
    expect(getSegmentEndPreviewTime({ ...segment, currentTime: 16 })).toBe(17);
  });

  it('goes to the end when the playhead is already inside the lead-in', () => {
    expect(getSegmentEndPreviewTime({ ...segment, currentTime: 17 })).toBe(20);
    expect(getSegmentEndPreviewTime({ ...segment, currentTime: 19 })).toBe(20);
  });

  it('goes to the end when the playhead is past the segment', () => {
    expect(getSegmentEndPreviewTime({ ...segment, currentTime: 25 })).toBe(20);
  });

  it('goes a lead-in before the end even when the playhead is before the segment', () => {
    expect(getSegmentEndPreviewTime({ ...segment, currentTime: 5 })).toBe(17);
  });

  it('has no tail to preview in a segment shorter than the lead-in', () => {
    const shortSegment = { start: 10, end: 12, leadInSeconds: 3 };
    expect(getSegmentEndPreviewTime({ ...shortSegment, currentTime: 11 })).toBe(12);
    expect(getSegmentEndPreviewTime({ ...shortSegment, currentTime: 5 })).toBe(10);
  });

  it('behaves like "jump to the end" when the lead-in is zero', () => {
    expect(getSegmentEndPreviewTime({ start: 10, end: 20, currentTime: 10, leadInSeconds: 0 })).toBe(20);
  });

  it('treats a negative or invalid lead-in as zero', () => {
    expect(getSegmentEndPreviewTime({ start: 10, end: 20, currentTime: 10, leadInSeconds: -3 })).toBe(20);
    expect(getSegmentEndPreviewTime({ start: 10, end: 20, currentTime: 10, leadInSeconds: NaN })).toBe(20);
  });

  it('does not move the playhead backwards in a segment whose end is before its start', () => {
    expect(getSegmentEndPreviewTime({ start: 20, end: 10, currentTime: 25, leadInSeconds: 3 })).toBe(25);
    expect(getSegmentEndPreviewTime({ start: 10, end: 10, currentTime: 12, leadInSeconds: 3 })).toBe(12);
  });
});

describe('resolveSegmentEndPreviewRange', () => {
  const segments = [
    { start: 10, end: 20 },
    { start: 30, end: 40 },
  ];

  it('previews the tail of the selected segment in the cutting window', () => {
    expect(resolveSegmentEndPreviewRange({ scope: 'segment', segments, selectedIndex: 1 })).toStrictEqual({ start: 30, end: 40 });
  });

  it('has nothing to preview when the selected segment has no end', () => {
    expect(resolveSegmentEndPreviewRange({ scope: 'segment', segments: [{ start: 10 }], selectedIndex: 0 })).toBeUndefined();
  });

  it('has nothing to preview when there is no selected segment', () => {
    expect(resolveSegmentEndPreviewRange({ scope: 'segment', segments, selectedIndex: -1 })).toBeUndefined();
  });

  it('previews the tail of the clip that is playing in the results windows', () => {
    // The results windows play one clip; their cut list is a throw-away one.
    expect(resolveSegmentEndPreviewRange({
      scope: 'timeline',
      segments,
      selectedIndex: 0,
      timeline: { start: 0, end: 42 },
    })).toStrictEqual({ start: 0, end: 42 });
  });

  it('has nothing to preview when the clip has no known duration', () => {
    expect(resolveSegmentEndPreviewRange({ scope: 'timeline', segments, selectedIndex: 0 })).toBeUndefined();
  });

  it('has nothing to preview in a segment whose end is not after its start', () => {
    expect(resolveSegmentEndPreviewRange({ scope: 'segment', segments: [{ start: 20, end: 10 }], selectedIndex: 0 })).toBeUndefined();
    expect(resolveSegmentEndPreviewRange({ scope: 'segment', segments: [{ start: 20, end: 20 }], selectedIndex: 0 })).toBeUndefined();
    expect(resolveSegmentEndPreviewRange({
      scope: 'timeline',
      segments,
      selectedIndex: 0,
      timeline: { start: 10, end: 10 },
    })).toBeUndefined();
  });
});
