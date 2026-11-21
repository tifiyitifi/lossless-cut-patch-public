// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';
import JSON5 from 'json5';

import type { LlcTranslate } from './llcProjectText.js';
import { buildLlcSegmentComments, renderLlcProjectText } from './llcProjectText.js';

/** Emulates i18next interpolation: the English key text is the message. */
const translate: LlcTranslate = (key, options) => key.replaceAll(/\{\{(\w+)\}\}/g, (match, name: string) => {
  const value = options?.[name];
  return value == null ? match : String(value);
});

const cut = (start: number | string, end: number | string | undefined, extra: Record<string, unknown> = {}) => ({
  start,
  ...((end !== undefined) && { end }),
  name: '',
  selected: true,
  segId: `seg-${String(start)}`,
  ...extra,
});

describe('buildLlcSegmentComments', () => {
  it('numbers by start time and by queue position, not by file order', () => {
    const comments = buildLlcSegmentComments([cut(20, 30), cut(0, 10), cut(10, 20)], translate);
    expect(comments).toStrictEqual(['#3 (queue 1)', '#1 (queue 2)', '#2 (queue 3)']);
  });

  it('gives a marker no number and does not let it push the others around', () => {
    const comments = buildLlcSegmentComments([cut(5, undefined), cut(20, 30), cut(0, 10)], translate);
    expect(comments).toStrictEqual(['Marker (no end time, not exported)', '#2 (queue 1)', '#1 (queue 2)']);
  });

  it('leaves an unselected segment out of the queue numbering', () => {
    const comments = buildLlcSegmentComments([cut(0, 10), cut(10, 20, { selected: false }), cut(20, 30)], translate);
    expect(comments).toStrictEqual(['#1 (queue 1)', '#2 (not exported)', '#3 (queue 2)']);
  });

  it('falls back to all segments when nothing is selected (the export does the same)', () => {
    const comments = buildLlcSegmentComments([cut(0, 10, { selected: false }), cut(10, 20, { selected: false })], translate);
    expect(comments).toStrictEqual(['#1 (queue 1)', '#2 (queue 2)']);
  });

  it('breaks equal start times by end time', () => {
    const comments = buildLlcSegmentComments([cut(5, 20), cut(5, 10)], translate);
    expect(comments).toStrictEqual(['#2 (queue 1)', '#1 (queue 2)']);
  });

  it('reads stored timecodes (v3) like numbers (v2)', () => {
    const comments = buildLlcSegmentComments([
      cut('00:00:10.000000000', '00:00:20.000000000'),
      cut('00:00:00.000000000', '00:00:10.000000000'),
    ], translate);
    expect(comments).toStrictEqual(['#2 (queue 1)', '#1 (queue 2)']);
  });

  it('has no comment for a segment it cannot read', () => {
    const comments = buildLlcSegmentComments([{ start: 'not a time', end: 10, name: '' }, null], translate);
    expect(comments).toStrictEqual([undefined, undefined]);
  });
});

describe('renderLlcProjectText', () => {
  const project = {
    version: 3,
    mediaFileName: 'a.mp4',
    cutSegments: [
      cut('00:00:10.000000000', '00:00:20.000000000'),
      cut('00:00:00.000000000', '00:00:10.000000000'),
    ],
  };

  it('writes the header, a comment per segment and the data unchanged', () => {
    expect(renderLlcProjectText(project, { t: translate })).toBe(`// LosslessCut project (JSON5). Comments are for humans; the app ignores them.
// The colored number #n is the segment's place in the video by start time; markers (no end time) have no number.
// The queue number is the export and merge order: the segments are cut and merged in the order they appear below.
{
  version: 3,
  mediaFileName: 'a.mp4',
  cutSegments: [
    // #2 (queue 1)
    {
      start: '00:00:10.000000000',
      end: '00:00:20.000000000',
      name: '',
      selected: true,
      segId: 'seg-00:00:10.000000000',
    },
    // #1 (queue 2)
    {
      start: '00:00:00.000000000',
      end: '00:00:10.000000000',
      name: '',
      selected: true,
      segId: 'seg-00:00:00.000000000',
    },
  ],
}`);
  });

  it('parses back to the same project (comments are invisible to JSON5)', () => {
    expect(JSON5.parse(renderLlcProjectText(project, { t: translate }))).toStrictEqual(project);
  });

  it('explains the patchExport block and keeps it above the segments', () => {
    const finished = {
      version: 3,
      mediaFileName: 'a.mp4',
      patchExport: {
        mode: 'merge',
        merged: [{ path: 'a-merged.mp4', segIds: ['s1'] }],
        clips: [{ path: 'a-1.mp4', segId: 's1' }],
      },
      cutSegments: [cut('00:00:00.000000000', '00:00:10.000000000')],
    };
    const text = renderLlcProjectText(finished, { t: translate });
    expect(text).toContain('// The patchExport block records the outputs of the last finished export');
    expect(text.indexOf('patchExport')).toBeLessThan(text.indexOf('cutSegments'));
    expect(JSON5.parse(text)).toStrictEqual(finished);
  });

  it('writes no explanation of the block when the project has none', () => {
    expect(renderLlcProjectText(project, { t: translate })).not.toContain('patchExport');
  });

  it('writes plain JSON5 without a translation function', () => {
    expect(renderLlcProjectText(project)).toBe(JSON5.stringify(project, null, 2));
  });

  it('keeps JSON5 formatting for nested values and markers', () => {
    const withNesting = {
      version: 2,
      mediaFileName: 'a.mp4',
      cutSegments: [
        { start: 0, end: 5, name: 'one', tags: { speaker: 'a' }, selected: true, segId: 'x' },
        { start: 5, name: 'marker' },
      ],
    };
    expect(renderLlcProjectText(withNesting)).toBe(JSON5.stringify(withNesting, null, 2));
    const commented = renderLlcProjectText(withNesting, { t: translate });
    expect(commented).toContain("      tags: {\n        speaker: 'a',\n      },\n");
    expect(commented).toContain('    // Marker (no end time, not exported)\n');
  });

  it('puts a blank line after every fifth segment, but not after the last one', () => {
    const many = Array.from({ length: 12 }, (_, index) => cut(index * 10, index * 10 + 5));
    const text = renderLlcProjectText({ version: 2, mediaFileName: 'a.mp4', cutSegments: many }, { t: translate });
    const lines = text.split('\n');
    const emptyLines = lines.flatMap((line, index) => (line === '' ? [index] : []));
    expect(emptyLines).toHaveLength(2);
    for (const lineIndex of emptyLines) {
      expect(lines[lineIndex - 1]).toBe('    },');
      expect(lines[lineIndex + 1]).toMatch(/^ {4}\/\/ #/);
    }
    expect(lines.at(-3)).toBe('    },');
    expect(lines.at(-2)).toBe('  ],');

    const plain = { version: 2, mediaFileName: 'a.mp4', cutSegments: many };
    expect(renderLlcProjectText(plain)).toBe(JSON5.stringify(plain, null, 2));
  });

  it('keeps unknown top-level fields, in their order', () => {
    const custom = { version: 2, customThing: { a: 1 }, mediaFileName: 'm.mp4', cutSegments: [] };
    const text = renderLlcProjectText(custom, { t: translate });
    expect(JSON5.parse(text)).toStrictEqual(custom);
    expect(text.indexOf('customThing')).toBeLessThan(text.indexOf('mediaFileName'));
    expect(text).toContain('  cutSegments: [],\n}');
  });

  it('leaves a non-object project to JSON5', () => {
    expect(renderLlcProjectText([1, 2])).toBe(JSON5.stringify([1, 2], null, 2));
  });
});
