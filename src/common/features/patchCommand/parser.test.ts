// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { legacyPatchCommands, upstreamActionAliases, patchFlowIntents } from './commands.js';
import { parsePatchCommand } from './parser.js';

describe('parsePatchCommand', () => {
  it('rejects empty input', () => {
    expect(parsePatchCommand(' '.repeat(3))).toStrictEqual({ ok: false, error: 'empty', name: '' });
  });

  it('parses a legacy code', () => {
    const result = parsePatchCommand('xc');
    expect(result).toStrictEqual({
      ok: true,
      command: { name: 'xc', intent: 'cut', args: [], source: 'legacy' },
    });
  });

  it('is case-insensitive and splits arguments', () => {
    const result = parsePatchCommand('  XC   foo bar ');
    expect(result).toStrictEqual({
      ok: true,
      command: { name: 'xc', intent: 'cut', args: ['foo', 'bar'], source: 'legacy' },
    });
  });

  it('parses a patch action id', () => {
    const result = parsePatchCommand('set-cut-start');
    expect(result).toStrictEqual({
      ok: true,
      command: { name: 'set-cut-start', intent: 'set-cut-start', args: [], source: 'action' },
    });
  });

  it('parses upstream action aliases', () => {
    const result = parsePatchCommand('addSegment');
    expect(result).toStrictEqual({
      ok: true,
      command: { name: 'addsegment', intent: 'add-segment', args: [], source: 'action' },
    });
  });

  it('parses help / clear', () => {
    expect(parsePatchCommand('help')).toMatchObject({ ok: true, command: { intent: 'help' } });
    expect(parsePatchCommand('?')).toMatchObject({ ok: true, command: { intent: 'help' } });
    expect(parsePatchCommand('clear')).toMatchObject({ ok: true, command: { intent: 'clear' } });
  });

  it('parses the empty work directory cleanup under both names', () => {
    expect(parsePatchCommand('clearemptyworkdirs')).toMatchObject({ ok: true, command: { intent: 'clear-empty-work-dirs', source: 'builtin' } });
    expect(parsePatchCommand('cewd')).toMatchObject({ ok: true, command: { intent: 'clear-empty-work-dirs', source: 'builtin' } });
    expect(parsePatchCommand('clear-empty-work-dirs')).toMatchObject({ ok: true, command: { intent: 'clear-empty-work-dirs', source: 'builtin' } });
    expect(parsePatchCommand('  clear   empty work dirs ')).toMatchObject({ ok: true, command: { intent: 'clear-empty-work-dirs', source: 'builtin', args: [] } });
    // An extra word after the phrase is an argument of the cleanup, never the `clear` (console)
    // command with the phrase as arguments.
    expect(parsePatchCommand('clear empty work dirs extra')).toMatchObject({ ok: true, command: { intent: 'clear-empty-work-dirs', source: 'builtin', args: ['extra'] } });
    expect(parsePatchCommand('CLEAR EMPTY WORK DIRS')).toMatchObject({ ok: true, command: { intent: 'clear-empty-work-dirs' } });
    expect(parsePatchCommand('clear extra')).toMatchObject({ ok: true, command: { intent: 'clear', args: ['extra'] } });
  });

  it('reports unknown commands', () => {
    expect(parsePatchCommand('nope')).toStrictEqual({ ok: false, error: 'unknown', name: 'nope' });
  });

  it('parses every flow intent by its id', () => {
    for (const intent of patchFlowIntents) {
      expect(parsePatchCommand(intent)).toMatchObject({ ok: true, command: { intent } });
    }
  });

  it('lists every flow intent once, except the ones resolved as built-ins', () => {
    expect(new Set(patchFlowIntents).size).toBe(patchFlowIntents.length);
    expect(patchFlowIntents).not.toContain('help');
    expect(patchFlowIntents).not.toContain('clear');
    expect(patchFlowIntents).not.toContain('toggle-keyboard-practice');
    expect(patchFlowIntents).not.toContain('clear-empty-work-dirs');
  });

  it('parses the upstream names of the segment operations', () => {
    expect(parsePatchCommand('detectBlackScenes')).toMatchObject({ ok: true, command: { intent: 'detect-black-scenes' } });
    expect(parsePatchCommand('combineOverlappingSegments')).toMatchObject({ ok: true, command: { intent: 'combine-overlapping-segments' } });
    expect(parsePatchCommand('reorderSegsByStartTime')).toMatchObject({ ok: true, command: { intent: 'reorder-segments' } });
  });

  it('covers every documented legacy code', () => {
    for (const command of legacyPatchCommands) {
      expect(parsePatchCommand(command.code)).toMatchObject({ ok: true, command: { intent: command.intent } });
    }
  });

  it('maps every alias to a non-empty intent', () => {
    for (const [alias, intent] of Object.entries(upstreamActionAliases)) {
      expect(parsePatchCommand(alias)).toMatchObject({ ok: true, command: { intent } });
    }
  });
});
