// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { CutNameClip, CutNameValues, RuleCutNameContext } from './cutName.js';
import {
  buildCutNameValues, checkCutNameRule, cutNamePresets, cutRuleSeparatesClips, defaultCutLabelSeparator,
  defaultCutNameRule, formatCutNameTime, migrateCutNameRule, oldDefaultCutNameRule, parseCutLabelSeparator,
  parseCutNameRule, parseRuleCutNameContext, renderCutNameStem, renderRuleCutName, resolveCutNames,
} from './cutName.js';

/* eslint-disable no-template-curly-in-string -- the rules are the subject of these tests. */

const date = new Date(2026, 9, 26, 18, 1, 6, 19);
const epochMs = date.getTime();

const clips: CutNameClip[] = [
  { label: 'intro', start: 0, end: 12.5 },
  { label: undefined, start: 30, end: 40 },
  { label: 'intro', start: 100, end: 101.25 },
];

function makeValues(overrides: Partial<Parameters<typeof buildCutNameValues>[0]> = {}): CutNameValues {
  return buildCutNameValues({
    sourceName: 'source',
    sourceFolder: 'videos',
    clips,
    index: 0,
    epochMs,
    exportCount: undefined,
    labelSeparator: defaultCutLabelSeparator,
    maxLabelLength: 100,
    minZeroPadding: 0,
    ...overrides,
  });
}

const render = (rule: string, overrides: Parameters<typeof makeValues>[0] = {}) => (
  renderCutNameStem(rule, makeValues(overrides))
);

describe('formatCutNameTime', () => {
  it('writes a file name friendly timecode', () => {
    expect(formatCutNameTime(0)).toBe('00.00.00.000');
    expect(formatCutNameTime(1.5)).toBe('00.00.01.500');
    expect(formatCutNameTime(3661.25)).toBe('01.01.01.250');
  });
});

describe('cut name tokens', () => {
  it('renders the source, the number in the batch, the label and the cut times', () => {
    expect(render(defaultCutNameRule)).toBe('source-1 - intro-00.00.00.000-00.00.12.500');
  });

  it('pads the number to the size of the batch', () => {
    expect(render('{seg_num}', { index: 2 })).toBe('3');
    expect(render('{seg_num}', { clips: Array.from({ length: 10 }, () => ({ start: 0, end: 1 })), index: 9 }))
      .toBe('10');
  });

  it('honours the minimum zero padding', () => {
    expect(render('{seg_num}', { minZeroPadding: 3 })).toBe('001');
    expect(render('{seg_num}', { clips: Array.from({ length: 12 }, () => ({ start: 0, end: 1 })), index: 1 }))
      .toBe('02');
  });

  it('uses the cut times of this clip', () => {
    expect(render('{cut_from}-{cut_to}', { index: 1 })).toBe('00.00.30.000-00.00.40.000');
  });

  it('joins the labels of the whole batch, like the merge rule does', () => {
    // A repeated label is kept once, exactly like the merged result's `{labels}`.
    expect(render('{labels}', { labelSeparator: '_' })).toBe('intro');
    expect(render('{labels}', { clips: [{ label: 'a', start: 0, end: 1 }, { label: 'b', start: 2, end: 3 }] })).toBe('a-b');
    expect(render('{count}')).toBe('3');
  });

  it('drops an optional group whose token is empty', () => {
    expect(render('{source}[ - {label}]-{seg_num}', { index: 1 })).toBe('source-2');
  });

  it('escapes the source name instead of creating a folder', () => {
    expect(render('{source}', { sourceName: 'a/b' })).toBe('a／b');
  });

  it('writes the date tokens', () => {
    expect(render('{date}_{time}')).toBe('2026-10-26_18_01_06');
  });
});

describe('cutRuleSeparatesClips', () => {
  it('knows which rules can name the clips of one export differently', () => {
    expect(cutRuleSeparatesClips('{source}')).toBe(false);
    // Only the number inside the batch separates the clips: the whole export shares one timestamp
    // and one export number, so those render the same value for every clip.
    expect(cutRuleSeparatesClips('{source}-{seg_num}')).toBe(true);
    expect(cutRuleSeparatesClips('{source}-{datetime}')).toBe(false);
    expect(cutRuleSeparatesClips('{source}-{export_count}')).toBe(false);
    expect(cutRuleSeparatesClips('{source}-{label}')).toBe(false);
    expect(cutRuleSeparatesClips('{{datetime}}')).toBe(false);
  });

  it('matches what the export does with a stamp rule', () => {
    // The hint (`collisionProne = !cutRuleSeparatesClips`) and the export must agree: a rule it
    // warns about really does get the forced suffix, instead of the two disagreeing.
    const stampRule = '{source}[ - {label}]-{datetime}';
    expect(cutRuleSeparatesClips(stampRule)).toBe(false);
    const result = resolveCutNames({
      rule: stampRule,
      sourceName: 'source',
      sourceFolder: '',
      clips: [{ start: 0, end: 1 }, { start: 2, end: 3 }],
      ext: 'mp4',
      outputDir: '/work/clips',
      epochMs,
      exportCount: undefined,
      labelSeparator: '-',
      maxLabelLength: 100,
      minZeroPadding: 0,
      isWindows: false,
      caseInsensitive: false,
    });
    if (!('names' in result)) throw new Error('expected names');
    expect(result.suffixes.map((suffix) => suffix !== '')).toStrictEqual([true, true]);
  });
});

describe('resolveCutNames', () => {
  const resolve = (overrides: Partial<Parameters<typeof resolveCutNames>[0]> = {}) => resolveCutNames({
    rule: defaultCutNameRule,
    sourceName: 'source',
    sourceFolder: 'videos',
    clips,
    ext: 'mp4',
    outputDir: '/work/clips',
    epochMs,
    exportCount: undefined,
    labelSeparator: defaultCutLabelSeparator,
    maxLabelLength: 100,
    minZeroPadding: 0,
    isWindows: false,
    caseInsensitive: false,
    ...overrides,
  });

  it('names every clip and appends the extension', () => {
    const result = resolve();
    expect('names' in result && result.names).toStrictEqual([
      'source-1 - intro-00.00.00.000-00.00.12.500.mp4',
      'source-2-00.00.30.000-00.00.40.000.mp4',
      'source-3 - intro-00.01.40.000-00.01.41.250.mp4',
    ]);
    expect('names' in result && result.suffixes.map((suffix) => suffix !== '')).toStrictEqual([false, false, false]);
  });

  it('appends a number and the time to every clip when the rule renders the same name', () => {
    const result = resolve({ rule: '{source}' });
    if (!('names' in result)) throw new Error('expected names');
    // The stamp is the same for the whole export, the number keeps the names apart.
    expect(result.names[0]).toBe('source - 1-2026-10-26--18_01_06.019.mp4');
    expect(result.names[1]).toBe('source - 2-2026-10-26--18_01_06.019.mp4');
    expect(result.names[2]).toBe('source - 3-2026-10-26--18_01_06.019.mp4');
    expect(result.suffixes.map((suffix) => suffix !== '')).toStrictEqual([true, true, true]);
  });

  it('does not touch the clip that already had a unique name', () => {
    const result = resolve({ rule: '{source}[ - {label}]' });
    if (!('names' in result)) throw new Error('expected names');
    // Two clips carry the "intro" label, so they both get the suffix; the third one has no label
    // and renders a name of its own, so it keeps it.
    expect(result.names).toStrictEqual([
      'source - intro - 1-2026-10-26--18_01_06.019.mp4',
      'source.mp4',
      'source - intro - 3-2026-10-26--18_01_06.019.mp4',
    ]);
    expect(result.suffixes.map((suffix) => suffix !== '')).toStrictEqual([true, false, true]);
  });

  it('compares names the way the file system does when asked', () => {
    const result = resolve({ rule: '{source}{label}', clips: [{ label: 'A', start: 0, end: 1 }, { label: 'a', start: 2, end: 3 }], caseInsensitive: true });
    if (!('names' in result)) throw new Error('expected names');
    expect(result.suffixes.map((suffix) => suffix !== '')).toStrictEqual([true, true]);
  });

  it('refuses a name that does not fit instead of shortening it', () => {
    // A shortened name would lose the cut times (and could collide with a sibling), so the export
    // stops and the user has to shorten the folder or the rule.
    expect(resolve({ sourceName: 'x'.repeat(300) })).toStrictEqual({ problem: { code: 'pathTooLong' } });
    expect(resolve({ rule: '{source}', sourceName: 'x'.repeat(300) })).toStrictEqual({ problem: { code: 'pathTooLong' } });
  });

  it('refuses a name the forced suffix would push over the budget', () => {
    // The plain stem fits (240 of the 246 characters a `.mp4` name leaves on this platform), but the
    // number + time suffix the duplicate rule appends does not.
    expect(resolve({ rule: '{source}', sourceName: 'x'.repeat(240) })).toStrictEqual({ problem: { code: 'pathTooLong' } });
  });

  it('accepts a name that exactly fills the budget', () => {
    const clip = [{ start: 0, end: 1 }];
    // `.mp4` leaves 246 characters of stem; one more does not fit.
    expect('names' in resolve({ rule: '{source}', sourceName: 'x'.repeat(246), clips: clip })).toBe(true);
    expect(resolve({ rule: '{source}', sourceName: 'x'.repeat(247), clips: clip })).toStrictEqual({ problem: { code: 'pathTooLong' } });
  });

  it('refuses a rule that cannot name a file', () => {
    expect(resolve({ rule: '  ' })).toStrictEqual({ problem: { code: 'emptyRule' } });
    expect(resolve({ rule: 'a/b' })).toStrictEqual({ problem: { code: 'separator', chars: '/' } });
    // The unlabeled clip renders nothing for `{label}`: there is no name to write.
    expect(resolve({ rule: '{label}', clips: [{ start: 0, end: 1 }] })).toStrictEqual({ problem: { code: 'emptyName' } });
  });

  it('reports the clip that has no usable name', () => {
    expect(checkCutNameRule('{source}')).toBeUndefined();
  });

  it('renders a name for a changed label with the same forced suffix', () => {
    const context: RuleCutNameContext = {
      kind: 'rule',
      rule: '{source}-{label}',
      outputDir: '/work/clips',
      extension: '.mp4',
      sourceName: 'source',
      sourceFolder: 'videos',
      clips: [{ label: 'old', start: 0, end: 12.5 }],
      index: 0,
      epochMs,
      labelSeparator: defaultCutLabelSeparator,
      maxLabelLength: 100,
      minZeroPadding: 0,
      maxStemLength: 246,
      forcedSuffix: '',
    };
    expect(renderRuleCutName(context)).toBe('source-old.mp4');
    expect(renderRuleCutName(context, 'new')).toBe('source-new.mp4');
    // Clearing the label falls back to the optional group, exactly like the export would.
    expect(renderRuleCutName(context, '')).toBe('source.mp4');
  });

  it('keeps the forced suffix when a label is renamed', () => {
    const context: RuleCutNameContext = {
      kind: 'rule',
      rule: '{source}',
      outputDir: '/work/clips',
      extension: '.mp4',
      sourceName: 'source',
      sourceFolder: '',
      clips: [{ label: undefined, start: 0, end: 1 }, { label: undefined, start: 2, end: 3 }],
      index: 1,
      epochMs,
      labelSeparator: defaultCutLabelSeparator,
      maxLabelLength: 100,
      minZeroPadding: 0,
      maxStemLength: 246,
      forcedSuffix: ' - 2-2026-10-26--18_01_06.019',
    };
    expect(renderRuleCutName(context, 'intro')).toBe('source - 2-2026-10-26--18_01_06.019.mp4');
  });

  it('names the clips of the batch in the token values, so `{labels}` stays the export view', () => {
    const context: RuleCutNameContext = {
      kind: 'rule',
      rule: '{labels}',
      outputDir: '/work/clips',
      extension: '.mp4',
      sourceName: 'source',
      sourceFolder: '',
      clips: [{ label: 'a', start: 0, end: 1 }, { label: 'b', start: 2, end: 3 }],
      index: 0,
      epochMs,
      labelSeparator: '-',
      maxLabelLength: 100,
      minZeroPadding: 0,
      maxStemLength: 246,
      forcedSuffix: '',
    };
    expect(renderRuleCutName(context, 'c')).toBe('c-b.mp4');
  });
});

describe('parseRuleCutNameContext', () => {
  const stored = {
    kind: 'rule',
    rule: '{source}-{seg_num}',
    outputDir: '/work/clips',
    extension: '.mp4',
    sourceName: 'source',
    sourceFolder: '',
    clips: [{ label: 'a', start: 0, end: 1 }],
    index: 0,
    epochMs,
    labelSeparator: '-',
    maxLabelLength: 100,
    minZeroPadding: 0,
    maxStemLength: 246,
    forcedSuffix: '',
  };

  it('accepts a record the export wrote', () => {
    expect(parseRuleCutNameContext(stored)).toStrictEqual(stored);
  });

  it('rejects a record it cannot re-render', () => {
    expect(parseRuleCutNameContext(undefined)).toBeUndefined();
    expect(parseRuleCutNameContext({ ...stored, index: 5 })).toBeUndefined();
    expect(parseRuleCutNameContext({ ...stored, rule: '  ' })).toBeUndefined();
    expect(parseRuleCutNameContext({ ...stored, clips: 'nope' })).toBeUndefined();
    expect(parseRuleCutNameContext({ ...stored, kind: 'template' })).toBeUndefined();
  });

  it('rejects a clip whose times cannot be rendered', () => {
    // `typeof NaN === 'number'`: a hand-edited record would otherwise render `NaN` into the name.
    expect(parseRuleCutNameContext({ ...stored, clips: [{ start: NaN, end: 1 }] })).toBeUndefined();
    expect(parseRuleCutNameContext({ ...stored, clips: [{ start: 0, end: Infinity }] })).toBeUndefined();
  });
});

describe('presets and parsing', () => {
  it('offers the default rule first', () => {
    expect(cutNamePresets[0]).toStrictEqual({ id: 'default', rule: defaultCutNameRule });
  });

  it('falls back to the defaults', () => {
    expect(parseCutNameRule(undefined)).toBe(defaultCutNameRule);
    expect(parseCutNameRule('')).toBe(defaultCutNameRule);
    expect(parseCutNameRule('{source}')).toBe('{source}');
    expect(parseCutLabelSeparator('nope')).toBe(defaultCutLabelSeparator);
    expect(parseCutLabelSeparator('_')).toBe('_');
  });

  it('migrates only the old default rule', () => {
    // `electron-store` wrote the old default into every install that never edited the rule.
    expect(migrateCutNameRule(oldDefaultCutNameRule)).toBe(defaultCutNameRule);
    expect(migrateCutNameRule(defaultCutNameRule)).toBe(defaultCutNameRule);
    // A rule the user typed (or the missing value) is left alone.
    expect(migrateCutNameRule('{source}-{seg_num}')).toBe('{source}-{seg_num}');
    expect(migrateCutNameRule(undefined)).toBeUndefined();
  });
});
