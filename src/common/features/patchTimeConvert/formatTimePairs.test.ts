// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { defaultTimePairGap, formatTimePairDocument, formatTimePairs, normalizeTimePairGap, planLlcTimePairs } from './formatTimePairs.js';
import { parseTimePairs } from './parseTimePairs.js';

describe('normalizeTimePairGap', () => {
  it('keeps the allowed values and clamps the rest', () => {
    expect(normalizeTimePairGap(1)).toBe(1);
    expect(normalizeTimePairGap(8)).toBe(8);
    expect(normalizeTimePairGap(0)).toBe(1);
    expect(normalizeTimePairGap(99)).toBe(8);
    expect(normalizeTimePairGap(3.4)).toBe(3);
  });

  it('falls back to the default for missing or broken values', () => {
    expect(normalizeTimePairGap(undefined)).toBe(defaultTimePairGap);
    expect(normalizeTimePairGap(NaN)).toBe(defaultTimePairGap);
  });
});

describe('formatTimePairs', () => {
  it('writes the canonical time pair lines with two spaces by default', () => {
    expect(formatTimePairs([
      { start: 90, end: 92, label: undefined },
      { start: 3723.456, end: 3724, label: '剧情A' },
    ], { includeLabels: true })).toBe('00:01:30.000  00:01:32.000\n01:02:03.456  01:02:04.000  剧情A');
  });

  it('uses the gap for both separators', () => {
    const rows = [{ start: 90, end: 92, label: 'A' }];
    expect(formatTimePairs(rows, { includeLabels: true, gap: 1 })).toBe('00:01:30.000 00:01:32.000 A');
    expect(formatTimePairs(rows, { includeLabels: true, gap: 4 })).toBe('00:01:30.000    00:01:32.000    A');
    // A stored value out of range is clamped, not trusted.
    expect(formatTimePairs(rows, { includeLabels: true, gap: 0 })).toBe('00:01:30.000 00:01:32.000 A');
  });

  it('drops the labels when asked to', () => {
    expect(formatTimePairs([{ start: 90, end: 92, label: 'A' }], { includeLabels: false })).toBe('00:01:30.000  00:01:32.000');
  });

  it('keeps hours wide instead of wrapping at 99', () => {
    expect(formatTimePairs([{ start: 360_000, end: 360_001, label: undefined }], { includeLabels: true }))
      .toBe('100:00:00.000  100:00:01.000');
  });

  it('is empty for no rows', () => {
    expect(formatTimePairs([], { includeLabels: true })).toBe('');
  });

  it('is read back by the parser without loss', () => {
    const rows = [
      { start: 0, end: 1.5, label: undefined },
      { start: 1234.567, end: 1235, label: 'take 2' },
    ];
    for (const gap of [1, 2, 5]) {
      expect(parseTimePairs(formatTimePairs(rows, { includeLabels: true, gap }), { firstLineIsName: false }).rows).toStrictEqual(rows);
    }
  });
});

describe('formatTimePairDocument', () => {
  const rows = [
    { start: 90, end: 92, label: undefined },
    { start: 170, end: 623, label: '剧情A' },
  ];

  it('puts the video name on the first line and a blank line under it', () => {
    expect(formatTimePairDocument({ rows, includeLabels: true, mediaFileName: 'a.mp4' }))
      .toBe('a.mp4\n\n00:01:30.000  00:01:32.000\n00:02:50.000  00:10:23.000  剧情A');
  });

  it('is just the cuts when there is no name', () => {
    expect(formatTimePairDocument({ rows, includeLabels: false, mediaFileName: undefined }))
      .toBe('00:01:30.000  00:01:32.000\n00:02:50.000  00:10:23.000');
    expect(formatTimePairDocument({ rows, includeLabels: false, mediaFileName: '  ' }))
      .toBe('00:01:30.000  00:01:32.000\n00:02:50.000  00:10:23.000');
  });

  it('round trips through the parser with the name line enabled', () => {
    const text = formatTimePairDocument({ rows, includeLabels: true, mediaFileName: 'a.mp4', gap: 3 });
    expect(parseTimePairs(text, { firstLineIsName: true })).toStrictEqual({ mediaName: 'a.mp4', rows, errors: [] });
  });
});

describe('planLlcTimePairs', () => {
  const segments = [
    { start: 90, end: 92, name: 'A', selected: true },
    { start: 170, end: 623, name: '', selected: false },
    { start: 690 },
    { start: 800, end: 800, name: 'zero' },
    { start: NaN, end: 900, name: 'broken' },
    { start: 1000, end: 1001, name: 'B', selected: true },
  ];

  it('keeps selected cuts in file order and counts what it skipped', () => {
    expect(planLlcTimePairs({ segments, includeUnselected: false })).toStrictEqual({
      rows: [
        { start: 90, end: 92, label: 'A' },
        { start: 1000, end: 1001, label: 'B' },
      ],
      skippedUnselected: 1,
      skippedMarkers: 1,
      skippedInvalid: 2,
    });
  });

  it('includes unselected segments on request', () => {
    const plan = planLlcTimePairs({ segments, includeUnselected: true });
    expect(plan.skippedUnselected).toBe(0);
    expect(plan.rows.map((row) => row.start)).toStrictEqual([90, 170, 1000]);
    // An empty label stays empty instead of becoming a blank third column.
    expect(plan.rows[1]).toStrictEqual({ start: 170, end: 623, label: undefined });
  });

  it('handles a project without segments', () => {
    expect(planLlcTimePairs({ segments: [], includeUnselected: false })).toStrictEqual({
      rows: [],
      skippedUnselected: 0,
      skippedMarkers: 0,
      skippedInvalid: 0,
    });
  });
});
