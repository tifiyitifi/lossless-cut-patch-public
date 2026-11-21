// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { MergedNameValues } from './mergedName.js';
import {
  buildMergedNameValues, checkMergedNameRule, defaultLabelSeparator, defaultMergedNameRule,
  escapeWindowsReservedName, formatMergedNameDate, formatMergedNameTime, labelSeparatorOptions,
  mergedNamePresets, normalizeMergedLabels, parseLabelSeparator, parseMergedNameRule,
  renderMergedNameStem, resolveMergedName, resolveOptionalSegments, ruleHasUniqueToken,
  sanitizeNamePart,
} from './mergedName.js';

/* eslint-disable no-template-curly-in-string -- the rules are the subject of these tests. */

const date = new Date(2026, 9, 26, 18, 1, 6, 19);

function makeValues(overrides: Partial<Parameters<typeof buildMergedNameValues>[0]> = {}): MergedNameValues {
  return buildMergedNameValues({
    sourceName: 'source',
    sourceFolder: 'videos',
    labels: [],
    clipCount: 2,
    epochMs: date.getTime(),
    exportCount: undefined,
    labelSeparator: defaultLabelSeparator,
    maxLabelLength: 100,
    ...overrides,
  });
}

const render = (rule: string, overrides: Parameters<typeof makeValues>[0] = {}) => (
  renderMergedNameStem(rule, makeValues(overrides))
);

describe('sanitizeNamePart', () => {
  it('removes control, zero-width and line separator characters', () => {
    expect(sanitizeNamePart('a\u0000b\u{1F}c\u{7F}d\u{85}e\u{2028}f\u{2029}g\u{200B}h\u{200E}i')).toBe('abcdefghi');
  });

  it('keeps the normal space and the full-width space', () => {
    expect(sanitizeNamePart('a b')).toBe('a b');
    expect(sanitizeNamePart('あ\u{3000}い')).toBe('あ\u{3000}い');
  });

  it('maps the characters a file name cannot hold to their full-width form', () => {
    expect(sanitizeNamePart(String.raw`a\b/c:d?e"f<g>h*i|j~k`)).toBe('a＼b／c：d？e＂f＜g＞h＊i｜j～k');
  });

  it('trims the value', () => {
    expect(sanitizeNamePart('  a  ')).toBe('a');
  });
});

describe('labels', () => {
  it('skips empty labels, de-duplicates and keeps the merge order', () => {
    expect(normalizeMergedLabels({ labels: ['b', '', undefined, 'a', 'b'], maxLabelLength: 100 }))
      .toStrictEqual(['b', 'a']);
  });

  it('joins with the configured separator', () => {
    expect(render('{labels}', { labels: ['a', 'b'], labelSeparator: ',' })).toBe('a,b');
  });

  it('sanitizes and truncates every label', () => {
    expect(normalizeMergedLabels({ labels: ['A/B', 'abcdef'], maxLabelLength: 4 }))
      .toStrictEqual(['A／B', 'abcd']);
  });

  it('truncates without splitting a character outside the BMP', () => {
    expect(normalizeMergedLabels({ labels: ['😀😀'], maxLabelLength: 1 })).toStrictEqual(['😀']);
  });

  it('de-duplicates after sanitizing', () => {
    expect(normalizeMergedLabels({ labels: ['A/B', 'A／B'], maxLabelLength: 100 })).toStrictEqual(['A／B']);
  });
});

describe('optional segments', () => {
  it('drops the whole group when its only token is empty', () => {
    expect(render('{source}[ - {labels}]-merge', { labels: [] })).toBe('source-merge');
  });

  it('keeps the group when the token renders something', () => {
    expect(render('{source}[ - {labels}]-merge', { labels: ['a', 'b'] })).toBe('source - a-b-merge');
  });

  it('keeps a group that has no token', () => {
    expect(render('{source}[x]')).toBe('source[x]');
  });

  it('keeps a group with several tokens', () => {
    expect(render('{source}[ {labels}-{count}]', { labels: [] })).toBe('source-2');
  });

  it('treats nested brackets as literal and resolves the inner group', () => {
    expect(render('a[[ - {labels}]]b', { labels: [] })).toBe('a[]b');
    expect(render('a[[ - {labels}]]b', { labels: ['x'] })).toBe('a[ - x]b');
  });

  it('keeps an unmatched bracket', () => {
    expect(render('a[{source}')).toBe('a[source');
  });

  it('resolves groups in a rule that has characters outside the BMP', () => {
    // The bracket positions must stay UTF-16 indices: an astral character (an emoji) is two code
    // units, and counting code points would shift every bracket behind it.
    expect(render('a😀[ - {labels}]b', { labels: [] })).toBe('a😀b');
    expect(render('a😀[ - {labels}]b', { labels: ['x'] })).toBe('a😀 - xb');
  });

  it('resolves groups through the exported helper as well', () => {
    const values = makeValues({ labels: [] });
    expect(resolveOptionalSegments('[{labels}]', values)).toBe('');
  });
});

describe('rendering', () => {
  it('leaves an unknown token literal', () => {
    expect(render('{source}-{nope}')).toBe('source-{nope}');
  });

  it('renders an escaped brace literally', () => {
    // The braces are text, not a token: the value is not substituted, whatever the source is called.
    expect(render('{{source}}', { sourceName: 'clip' })).toBe('{source}');
    expect(render('{source}-{{labels}}', { sourceName: 'clip' })).toBe('clip-{labels}');
  });

  it('does not re-read a value as a token', () => {
    expect(render('{source}', { sourceName: 'a{labels}b', labels: ['x'] })).toBe('a{labels}b');
  });

  it('keeps brackets of the source name', () => {
    expect(render('{source}[ - {labels}]-merge', { sourceName: '[Group] A [1080p]', labels: ['x'] }))
      .toBe('[Group] A [1080p] - x-merge');
  });

  it('drops the separator in front of an empty token', () => {
    expect(render('{source}-{labels}-x', { labels: [] })).toBe('source-x');
    expect(render('{source} {labels}x', { labels: [] })).toBe('sourcex');
  });

  it('drops the separator behind an empty token at the start of the rule', () => {
    expect(render('{labels}-{source}', { labels: [] })).toBe('source');
    expect(render('{labels} - {source}', { labels: [] })).toBe('source');
    expect(render('{labels}-x', { labels: [] })).toBe('x');
  });

  it('renders {label} only when exactly one label is mergeable', () => {
    expect(render('{label}', { labels: ['a'] })).toBe('a');
    expect(render('{label}', { labels: ['a', 'b'] })).toBe('');
    expect(render('{label}', { labels: ['', 'a'] })).toBe('a');
  });

  it('renders the clip count, the date and the time', () => {
    expect(formatMergedNameDate(date.getTime())).toBe('2026-10-26');
    expect(formatMergedNameTime(date.getTime())).toBe('18_01_06');
    expect(render('{count}-{date}-{time}', { clipCount: 7 })).toBe('7-2026-10-26-18_01_06');
  });
});

describe('escapeWindowsReservedName', () => {
  it('marks a reserved name, also in another case', () => {
    expect(escapeWindowsReservedName('CON')).toBe('CON[WindowsReservedName]');
    expect(escapeWindowsReservedName('con')).toBe('con[WindowsReservedName]');
  });

  it('marks the part before the first dot', () => {
    expect(escapeWindowsReservedName('CON.mp4')).toBe('CON[WindowsReservedName].mp4');
  });

  it('leaves a name that only starts with a reserved name alone', () => {
    expect(escapeWindowsReservedName('CON1')).toBe('CON1');
    expect(escapeWindowsReservedName('console')).toBe('console');
  });
});

describe('checkMergedNameRule', () => {
  it('rejects an empty rule', () => {
    expect(checkMergedNameRule(' '.repeat(3))).toStrictEqual({ code: 'emptyRule' });
  });

  it('rejects a path separator', () => {
    const backslash = String.fromCodePoint(0x5C);
    expect(checkMergedNameRule('{source}/{labels}')).toStrictEqual({ code: 'separator', chars: '/' });
    expect(checkMergedNameRule(`a${backslash}b`)).toStrictEqual({ code: 'separator', chars: backslash });
  });

  it('accepts a token rule', () => {
    expect(checkMergedNameRule(defaultMergedNameRule)).toBeUndefined();
  });
});

describe('resolveMergedName', () => {
  const resolve = (overrides: Partial<Parameters<typeof resolveMergedName>[0]> = {}) => resolveMergedName({
    rule: defaultMergedNameRule,
    sourceName: 'clip',
    sourceFolder: 'videos',
    labels: [],
    ext: 'mp4',
    outputDir: 'C:/work/.losslesscut_work/merged',
    epochMs: date.getTime(),
    exportCount: undefined,
    labelSeparator: defaultLabelSeparator,
    maxLabelLength: 100,
    isWindows: true,
    ...overrides,
  });

  it('appends the output extension itself', () => {
    expect(resolve({ rule: '{source}', sourceName: 'clip' })).toStrictEqual({ fileName: 'clip.mp4' });
    expect(resolve({ rule: '{source}', ext: '.mp4' })).toStrictEqual({ fileName: 'clip.mp4' });
    expect(resolve({ rule: '{source}', ext: '' })).toStrictEqual({ fileName: 'clip' });
  });

  it('renders the default rule', () => {
    expect(resolve({ labels: [] })).toStrictEqual({ fileName: 'clip-merge.mp4' });
    expect(resolve({ labels: ['intro', 'end'] })).toStrictEqual({ fileName: 'clip - intro-end-merge.mp4' });
  });

  it('never lets a label or the source name create a folder', () => {
    expect(resolve({ labels: ['A/B'] })).toStrictEqual({ fileName: 'clip - A／B-merge.mp4' });
    expect(resolve({ sourceName: 'a:b', labels: [] })).toStrictEqual({ fileName: 'a：b-merge.mp4' });
  });

  it('avoids a hidden name and a trailing dot', () => {
    expect(resolve({ rule: '{source}', sourceName: '.clip' })).toStrictEqual({ fileName: '．clip.mp4' });
    expect(resolve({ rule: '{source}.', sourceName: 'clip' })).toStrictEqual({ fileName: 'clip.mp4' });
  });

  it('marks a Windows reserved name', () => {
    expect(resolve({ rule: '{source}', sourceName: 'CON' })).toStrictEqual({ fileName: 'CON[WindowsReservedName].mp4' });
  });

  it('reports a rule problem and an empty name', () => {
    expect(resolve({ rule: '{source}/{labels}' })).toStrictEqual({ problem: { code: 'separator', chars: '/' } });
    expect(resolve({ rule: '{labels}', labels: [] })).toStrictEqual({ problem: { code: 'emptyName' } });
  });

  it('refuses a long name instead of shortening it', () => {
    expect(resolve({ rule: '{source}', sourceName: 'a'.repeat(400) })).toStrictEqual({ problem: { code: 'pathTooLong' } });
    expect(resolve({ rule: '{source}-{datetime}', sourceName: 'a'.repeat(400) })).toStrictEqual({ problem: { code: 'pathTooLong' } });
  });

  it('uses the Windows path budget of the merged folder', () => {
    const longDir = `C:/${'d'.repeat(220)}`;
    const result = resolve({ rule: '{source}', sourceName: 'b'.repeat(20), outputDir: longDir });
    expect('fileName' in result).toBe(true);
    if (!('fileName' in result)) return;
    // The joined path stays below the `>= 259` limit upstream refuses.
    expect(longDir.length + 1 + result.fileName.length).toBeLessThanOrEqual(258);
    expect(resolve({ rule: '{source}', sourceName: 'b'.repeat(100), outputDir: longDir }))
      .toStrictEqual({ problem: { code: 'pathTooLong' } });
  });

  it('refuses when the merged folder leaves no room for a file name', () => {
    expect(resolve({ rule: '{source}', outputDir: `C:/${'d'.repeat(300)}` })).toStrictEqual({ problem: { code: 'pathTooLong' } });
  });

  it('does not apply the Windows path budget on another platform', () => {
    const longDir = `/${'d'.repeat(400)}`;
    expect(resolve({ rule: '{source}', sourceName: 'clip', outputDir: longDir, isWindows: false }))
      .toStrictEqual({ fileName: 'clip.mp4' });
  });
});

describe('ruleHasUniqueToken', () => {
  it('accepts the tokens that always differ', () => {
    expect(ruleHasUniqueToken('{source}-{datetime}')).toBe(true);
    expect(ruleHasUniqueToken('{source}-{epoch_ms}')).toBe(true);
    expect(ruleHasUniqueToken('{source}-{export_count}')).toBe(true);
  });

  it('rejects the tokens that repeat', () => {
    expect(ruleHasUniqueToken('{source}')).toBe(false);
    expect(ruleHasUniqueToken('{source}-{date}')).toBe(false);
    expect(ruleHasUniqueToken('{source}-{labels}')).toBe(false);
    expect(ruleHasUniqueToken('{source}-{count}')).toBe(false);
  });

  it('does not count an escaped token as used', () => {
    // `{{datetime}}` renders the literal text `{datetime}`, so it makes nothing unique.
    expect(ruleHasUniqueToken('{source}-{{datetime}}')).toBe(false);
    expect(ruleHasUniqueToken('{source}-{datetime}')).toBe(true);
  });
});

describe('defaults and presets', () => {
  it('offers the default rule first', () => {
    expect(mergedNamePresets[0]).toStrictEqual({ id: 'default', rule: defaultMergedNameRule });
    expect(defaultMergedNameRule).toBe('{source}[ - {labels}]-merge');
  });

  it('keeps every preset usable', () => {
    for (const preset of mergedNamePresets) expect(checkMergedNameRule(preset.rule)).toBeUndefined();
  });

  it('offers the label separators', () => {
    expect(labelSeparatorOptions).toContain(defaultLabelSeparator);
    expect(defaultLabelSeparator).toBe('-');
  });

  it('falls back to the defaults for a missing or unusable value', () => {
    expect(parseMergedNameRule(undefined)).toBe(defaultMergedNameRule);
    expect(parseMergedNameRule('')).toBe(defaultMergedNameRule);
    expect(parseMergedNameRule('{labels}')).toBe('{labels}');
    expect(parseLabelSeparator('nope')).toBe(defaultLabelSeparator);
    expect(parseLabelSeparator(',')).toBe(',');
  });
});
