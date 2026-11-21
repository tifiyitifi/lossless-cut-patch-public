// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { completeCommandInput, filterCommandCandidates, getCommandCandidates, getCommandCompletionTerm, getCommandHint, getCommandQuery } from './commandCandidates';
import { isModifierOnlyEvent, matchesKeyBinding } from '../patch/keyMatch';

const noAliases: never[] = [];

function keyEvent(code: string, modifiers: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>> = {}) {
  return { code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...modifiers };
}

describe('matchesKeyBinding', () => {
  it('matches code plus modifiers exactly', () => {
    expect(matchesKeyBinding(keyEvent('Space', { shiftKey: true }), 'ShiftLeft+Space')).toBe(true);
    expect(matchesKeyBinding(keyEvent('Space'), 'ShiftLeft+Space')).toBe(false);
    expect(matchesKeyBinding(keyEvent('Space', { shiftKey: true, ctrlKey: true }), 'ShiftLeft+Space')).toBe(false);
    expect(matchesKeyBinding(keyEvent('KeyK', { shiftKey: true }), 'ShiftLeft+Space')).toBe(false);
  });

  it('treats left and right modifiers the same way', () => {
    expect(matchesKeyBinding(keyEvent('Space', { shiftKey: true }), 'ShiftRight+Space')).toBe(true);
  });

  it('ignores missing bindings', () => {
    expect(matchesKeyBinding(keyEvent('Space', { shiftKey: true }), undefined)).toBe(false);
    expect(matchesKeyBinding(keyEvent('Space', { shiftKey: true }), '')).toBe(false);
  });

  it('never matches a bare modifier press', () => {
    // A bare Shift press used to match `ShiftLeft+Space` and opened the console, stealing Shift
    // from every other shortcut.
    expect(matchesKeyBinding(keyEvent('ShiftLeft', { shiftKey: true }), 'ShiftLeft+Space')).toBe(false);
    expect(matchesKeyBinding(keyEvent('ShiftRight', { shiftKey: true }), 'ShiftLeft+Space')).toBe(false);
    expect(matchesKeyBinding(keyEvent('ControlLeft', { ctrlKey: true }), 'ControlLeft+Space')).toBe(false);
    expect(isModifierOnlyEvent('ShiftLeft')).toBe(true);
    expect(isModifierOnlyEvent('Space')).toBe(false);
  });
});

describe('command candidates', () => {
  it('lists every built-in command with its compiled-in short name', () => {
    const candidates = getCommandCandidates(noAliases);
    const batch = candidates.find((candidate) => candidate.intent === 'toggle-batch-files-list');
    expect(batch?.names).toStrictEqual(['togglebatchfileslist', 'tbfl']);
    const settings = candidates.find((candidate) => candidate.intent === 'toggle-command-custom-settings');
    expect(settings?.names).toStrictEqual(['togglecommandcustomsettings', 'tccs']);
  });

  it('lists the multi-word name of the empty work directory cleanup', () => {
    const candidates = getCommandCandidates(noAliases);
    const clearDirs = candidates.find((candidate) => candidate.intent === 'clear-empty-work-dirs');
    expect(clearDirs?.names).toStrictEqual(['clearemptyworkdirs', 'cewd', 'clear-empty-work-dirs', 'clear empty work dirs']);
    expect(filterCommandCandidates(candidates, 'clear empty work dirs').map((candidate) => candidate.intent)).toStrictEqual(['clear-empty-work-dirs']);
  });

  it('folds the user aliases into the names of their command', () => {
    const candidates = getCommandCandidates([{ alias: 'Hide', intent: 'toggle-batch-files-list' }]);
    const batch = candidates.find((candidate) => candidate.intent === 'toggle-batch-files-list');
    expect(batch?.names).toStrictEqual(['togglebatchfileslist', 'tbfl', 'hide']);
    expect(batch?.userAliases).toStrictEqual(['hide']);
  });

  it('reads the query from the whole input', () => {
    expect(getCommandQuery('  TBFL  extra ')).toBe('tbfl extra');
    expect(getCommandQuery(' '.repeat(3))).toBe('');
  });

  it('matches and completes a multi-word phrase while it is typed', () => {
    const candidates = getCommandCandidates(noAliases);
    const [clearDirs] = filterCommandCandidates(candidates, 'clear empty');
    expect(clearDirs?.intent).toBe('clear-empty-work-dirs');
    expect(clearDirs == null ? undefined : getCommandCompletionTerm('clear empty', clearDirs)).toBe('clear empty work dirs');
    expect(completeCommandInput('clear empty', 'clear empty work dirs')).toBe('clear empty work dirs');
    expect(completeCommandInput('clear empty work dirs extra', 'clear empty work dirs')).toBe('clear empty work dirs extra');
    expect(getCommandHint('clear empty', candidates)).toBe(' work dirs');
    expect(getCommandHint('clear empty work dirs', candidates)).toBeUndefined();
    expect(getCommandHint('clear empty work dirs extra', candidates)).toBeUndefined();
  });

  it('filters by prefix and by intent id', () => {
    const candidates = getCommandCandidates(noAliases);
    expect(filterCommandCandidates(candidates, 'tb').map((candidate) => candidate.intent)).toStrictEqual(['toggle-batch-files-list']);
    expect(filterCommandCandidates(candidates, 'custom').map((candidate) => candidate.intent)).toStrictEqual(['toggle-command-custom-settings']);
    expect(filterCommandCandidates(candidates, 'nope')).toStrictEqual([]);
    expect(filterCommandCandidates(candidates, '')).toHaveLength(candidates.length);
  });

  it('completes the command token and keeps the arguments', () => {
    expect(completeCommandInput('tb', 'togglebatchfileslist')).toBe('togglebatchfileslist');
    expect(completeCommandInput('tb   a b', 'togglebatchfileslist')).toBe('togglebatchfileslist a b');
  });

  it('hints the remainder only for a unique match', () => {
    const candidates = getCommandCandidates(noAliases);
    expect(getCommandHint('tb', candidates)).toBe('fl');
    expect(getCommandHint('tbfl', candidates)).toBeUndefined();
    expect(getCommandHint('', candidates)).toBeUndefined();
    expect(getCommandHint('nope', candidates)).toBeUndefined();
  });

  it('does not hint when the query matches several commands', () => {
    const candidates = getCommandCandidates([{ alias: 'tb', intent: 'toggle-command-custom-settings' }]);
    expect(getCommandHint('t', candidates)).toBeUndefined();
  });
});
