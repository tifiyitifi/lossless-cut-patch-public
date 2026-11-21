// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { addUserAlias, removeUserAlias, validateAlias } from './aliasValidation.js';
import { patchBuiltinCommands, reservedCommandNames } from './builtinCommands.js';
import { parsePatchCommand } from './parser.js';

describe('built-in commands', () => {
  it('reserves every canonical name and short name', () => {
    for (const command of patchBuiltinCommands) {
      expect(reservedCommandNames).toContain(command.name);
      for (const shortName of command.shortNames) expect(reservedCommandNames).toContain(shortName);
    }
  });

  it('parses the full name and the default short name, case-insensitively', () => {
    expect(parsePatchCommand('togglebatchfileslist')).toMatchObject({ ok: true, command: { intent: 'toggle-batch-files-list', source: 'builtin' } });
    expect(parsePatchCommand('TBFL')).toMatchObject({ ok: true, command: { intent: 'toggle-batch-files-list', source: 'builtin' } });
    expect(parsePatchCommand('togglecommandcustomsettings')).toMatchObject({ ok: true, command: { intent: 'toggle-command-custom-settings', source: 'builtin' } });
    expect(parsePatchCommand('tccs')).toMatchObject({ ok: true, command: { intent: 'toggle-command-custom-settings', source: 'builtin' } });
  });

  it('keeps built-in commands ahead of user aliases', () => {
    const result = parsePatchCommand('tbfl', [{ alias: 'tbfl', intent: 'merge' }]);
    expect(result).toMatchObject({ ok: true, command: { intent: 'toggle-batch-files-list', source: 'builtin' } });
  });
});

describe('parsePatchCommand with user aliases', () => {
  const aliases = [
    { alias: 'hide', intent: 'toggle-batch-files-list' as const },
    { alias: 'cfg', intent: 'toggle-command-custom-settings' as const },
  ];

  it('resolves a user alias and splits arguments', () => {
    expect(parsePatchCommand('  HIDE  foo ', aliases)).toStrictEqual({
      ok: true,
      command: { name: 'hide', intent: 'toggle-batch-files-list', args: ['foo'], source: 'user-alias' },
    });
    expect(parsePatchCommand('cfg', aliases)).toMatchObject({ ok: true, command: { intent: 'toggle-command-custom-settings', source: 'user-alias' } });
  });

  it('still reports unknown names', () => {
    expect(parsePatchCommand('nope', aliases)).toStrictEqual({ ok: false, error: 'unknown', name: 'nope' });
  });
});

describe('validateAlias', () => {
  const existing = [{ alias: 'hide', intent: 'toggle-batch-files-list' as const }];

  it('accepts a fresh lower-case name', () => {
    expect(validateAlias(' Hide2 ', [])).toBeUndefined();
  });

  it('rejects empty, over-long and invalid names', () => {
    expect(validateAlias(' '.repeat(3), [])).toBe('empty');
    expect(validateAlias('a'.repeat(25), [])).toBe('tooLong');
    expect(validateAlias('has space', [])).toBe('invalidCharacters');
    expect(validateAlias('UPPER!', [])).toBe('invalidCharacters');
  });

  it('reserves built-in names, legacy codes and flow intents', () => {
    expect(validateAlias('tbfl', [])).toBe('reserved');
    expect(validateAlias('togglebatchfileslist', [])).toBe('reserved');
    expect(validateAlias('xc', [])).toBe('reserved');
    expect(validateAlias('merge', [])).toBe('reserved');
    expect(validateAlias('help', [])).toBe('reserved');
  });

  it('rejects a duplicate alias, case-insensitively', () => {
    expect(validateAlias('HIDE', existing)).toBe('duplicate');
  });
});

describe('addUserAlias / removeUserAlias', () => {
  it('adds a normalized alias and ignores a rejected one', () => {
    const added = addUserAlias([], '  Hide ', 'toggle-batch-files-list');
    expect(added).toStrictEqual([{ alias: 'hide', intent: 'toggle-batch-files-list' }]);
    expect(addUserAlias(added, 'tbfl', 'merge')).toStrictEqual(added);
    expect(addUserAlias(added, 'hide', 'merge')).toStrictEqual(added);
  });

  it('allows several aliases for the same command and removes by name', () => {
    let aliases = addUserAlias([], 'hide', 'toggle-batch-files-list');
    aliases = addUserAlias(aliases, 'hide2', 'toggle-batch-files-list');
    expect(aliases).toHaveLength(2);
    expect(removeUserAlias(aliases, 'HIDE')).toStrictEqual([{ alias: 'hide2', intent: 'toggle-batch-files-list' }]);
  });
});
