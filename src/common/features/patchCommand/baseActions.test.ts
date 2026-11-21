// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { allPatchActions } from '../patchData/keymap.js';
import { getBaseActionForIntent, isUnwiredIntent, patchIntentToBaseAction } from './baseActions.js';
import { patchFlowIntents } from './commands.js';
import { parsePatchCommand } from './parser.js';
import type { KeyboardAction } from '../../types.js';

const baseActionNames = new Map<string, KeyboardAction>([
  ['splitcurrentsegment', 'splitCurrentSegment'],
  ['addsegment', 'addSegment'],
  ['export', 'export'],
]);

describe('patchIntentToBaseAction', () => {
  it('maps only known intents', () => {
    const known = new Set<string>([...allPatchActions, ...patchFlowIntents]);
    for (const intent of Object.keys(patchIntentToBaseAction)) expect(known.has(intent)).toBe(true);
  });

  it('wires the cutting and transport intents the console advertises', () => {
    expect(getBaseActionForIntent('add-segment')).toBe('addSegment');
    expect(getBaseActionForIntent('set-cut-start')).toBe('setCutStart');
    expect(getBaseActionForIntent('play-pause')).toBe('togglePlayResetSpeed');
    expect(getBaseActionForIntent('cut')).toBe('export');
    expect(getBaseActionForIntent('next-file')).toBe('batchOpenNextFile');
    expect(getBaseActionForIntent('merge')).toBe('mergeCutResults');
    expect(getBaseActionForIntent('post-process-cut')).toBe('finishCut');
    expect(getBaseActionForIntent('post-process-merge')).toBe('finishMerge');
  });

  it('reports the patch flow intents that still wait for their step', () => {
    expect(isUnwiredIntent('cut-and-merge')).toBe(true);
    expect(isUnwiredIntent('open-workpath-list')).toBe(true);
    expect(isUnwiredIntent('cut')).toBe(false);
  });
});

describe('parsePatchCommand with base actions', () => {
  it('accepts a raw base action name, case-insensitively', () => {
    expect(parsePatchCommand('splitCurrentSegment', [], baseActionNames)).toStrictEqual({
      ok: true,
      command: { name: 'splitcurrentsegment', intent: 'splitCurrentSegment', args: [], source: 'base-action' },
    });
    expect(parsePatchCommand('SPLITCURRENTSEGMENT', [], baseActionNames)).toMatchObject({ ok: true, command: { intent: 'splitCurrentSegment', source: 'base-action' } });
  });

  it('lets the curated names win over a same-named base action', () => {
    // `export` is an upstream alias for the patch `cut` intent, and `addSegment` for `add-segment`:
    // both are resolved before the raw base action lookup (and still run the base action).
    expect(parsePatchCommand('export', [], baseActionNames)).toMatchObject({ ok: true, command: { intent: 'cut', source: 'action' } });
    expect(parsePatchCommand('addSegment', [], baseActionNames)).toMatchObject({ ok: true, command: { intent: 'add-segment', source: 'action' } });
  });

  it('stays unknown without the base action list', () => {
    expect(parsePatchCommand('splitCurrentSegment')).toStrictEqual({ ok: false, error: 'unknown', name: 'splitcurrentsegment' });
  });
});
