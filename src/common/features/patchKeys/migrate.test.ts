// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { KeyBinding } from '../../types.js';
import { baseDefaultKeyBindings } from './baseDefaults.js';
import { withAddedPatchKeys, withKeyBindingScopes, withoutRemovedPatchKeys, withRenamedPatchKeys, withRetargetedPatchKeys } from './migrate.js';
import { defaultKeyBindings } from './patchDefaults.js';

describe('withKeyBindingScopes', () => {
  it('scopes an old table and appends the patch defaults', () => {
    const legacy: KeyBinding[] = [...baseDefaultKeyBindings, { keys: 'KeyQ', action: 'addSegment' }];
    const migrated = withKeyBindingScopes(legacy);

    // The upstream rows are base defaults again, the user's own row says so, and every key the old
    // table did not use at all gained its patch default.
    expect(migrated).toContainEqual(expect.objectContaining({ keys: 'KeyD', action: 'cleanupFilesDialog', scope: 'base', enabled: true }));
    expect(migrated).toContainEqual(expect.objectContaining({ keys: 'KeyQ', action: 'addSegment', scope: 'user', enabled: true }));
    expect(migrated).toContainEqual(expect.objectContaining({ keys: 'KeyD', action: 'seekPreviousFrame', scope: 'patch', enabled: true }));
    expect(migrated).toHaveLength(defaultKeyBindings.length + 1);
  });

  it('does not re-add a default whose key a user binding claims', () => {
    // The user rebound E: their key wins, and re-adding the default would leave a binding that can
    // never run.
    const legacy: KeyBinding[] = [...baseDefaultKeyBindings.filter(({ keys }) => keys !== 'KeyE'), { keys: 'KeyE', action: 'addSegment' }];
    const migrated = withKeyBindingScopes(legacy);
    expect(migrated).toContainEqual(expect.objectContaining({ keys: 'KeyE', action: 'addSegment', scope: 'user' }));
    expect(migrated).not.toContainEqual(expect.objectContaining({ keys: 'KeyE', action: 'export' }));
  });

  it('is idempotent', () => {
    const once = withKeyBindingScopes(baseDefaultKeyBindings);
    expect(withKeyBindingScopes(once)).toStrictEqual(once);
  });

  it('keeps a switched-off default switched off', () => {
    const disabled: KeyBinding[] = [{ keys: 'KeyD', action: 'seekPreviousFrame', scope: 'patch', enabled: false }];
    const migrated = withKeyBindingScopes(disabled);
    expect(migrated).toContainEqual(expect.objectContaining({ keys: 'KeyD', action: 'seekPreviousFrame', enabled: false }));
  });
});

describe('withAddedPatchKeys', () => {
  // v7 runs after v4, so every stored row already carries its scope.
  const scopedBaseDefaults = baseDefaultKeyBindings.map((binding) => ({ ...binding, scope: 'base' as const }));

  it('adds the volume, marking and menu rows to a table that predates them', () => {
    const migrated = withAddedPatchKeys(scopedBaseDefaults);

    expect(migrated).toContainEqual(expect.objectContaining({ keys: 'Minus', action: 'decreaseVolume', scope: 'patch', enabled: true }));
    expect(migrated).toContainEqual(expect.objectContaining({ keys: 'Equal', action: 'increaseVolume', scope: 'patch', enabled: true }));
    expect(migrated).toContainEqual(expect.objectContaining({ keys: 'AltLeft+ArrowUp', action: 'setCutStart', scope: 'patch', enabled: true }));
    expect(migrated).toContainEqual(expect.objectContaining({ keys: 'AltLeft+ArrowDown', action: 'setCutEnd', scope: 'patch', enabled: true }));
    expect(migrated).toContainEqual(expect.objectContaining({ keys: 'AltLeft+KeyQ', action: 'togglePatchMenuBar', scope: 'patch', enabled: true }));
  });

  it('leaves the upstream volume rows in place for base mode', () => {
    const migrated = withAddedPatchKeys(scopedBaseDefaults);
    expect(migrated).toContainEqual(expect.objectContaining({ keys: 'AltLeft+ArrowUp', action: 'increaseVolume', scope: 'base' }));
    expect(migrated).toContainEqual(expect.objectContaining({ keys: 'AltLeft+ArrowDown', action: 'decreaseVolume', scope: 'base' }));
  });

  it('does not add a row whose combination the user already owns', () => {
    const table: KeyBinding[] = [
      { keys: 'Equal', action: 'addSegment', scope: 'user' },
      { keys: 'AltLeft+ArrowUp', action: 'increaseVolume', scope: 'user' },
      { keys: 'AltLeft+KeyQ', action: 'addSegment', scope: 'user' },
    ];
    const migrated = withAddedPatchKeys(table);

    expect(migrated).toContainEqual(expect.objectContaining({ keys: 'Equal', action: 'addSegment', scope: 'user' }));
    expect(migrated).toContainEqual(expect.objectContaining({ keys: 'AltLeft+ArrowUp', action: 'increaseVolume', scope: 'user' }));
    expect(migrated).toContainEqual(expect.objectContaining({ keys: 'AltLeft+KeyQ', action: 'addSegment', scope: 'user' }));
    expect(migrated.filter((binding) => binding.keys === 'Equal')).toHaveLength(1);
    expect(migrated.filter((binding) => binding.keys === 'AltLeft+ArrowUp')).toHaveLength(1);
    expect(migrated.filter((binding) => binding.keys === 'AltLeft+KeyQ')).toHaveLength(1);
  });

  it('is idempotent', () => {
    const once = withAddedPatchKeys(scopedBaseDefaults);
    expect(withAddedPatchKeys(once)).toStrictEqual(once);
  });

  it('does not re-add a row the user switched off', () => {
    const table: KeyBinding[] = [{ keys: 'Equal', action: 'increaseVolume', scope: 'patch', enabled: false }];
    const migrated = withAddedPatchKeys(table);
    expect(migrated).toContainEqual(expect.objectContaining({ keys: 'Equal', action: 'increaseVolume', scope: 'patch', enabled: false }));
    expect(migrated.filter((binding) => binding.keys === 'Equal' && binding.action === 'increaseVolume')).toHaveLength(1);
  });
});

describe('withoutRemovedPatchKeys', () => {
  it('drops the two briefly shipped cut-marking rows', () => {
    const table: KeyBinding[] = [
      ...baseDefaultKeyBindings.map((binding) => ({ ...binding, scope: 'base' as const })),
      { keys: 'ShiftLeft+AltLeft+ArrowLeft', action: 'setCutStart', scope: 'patch', enabled: true },
      { keys: 'ShiftLeft+AltLeft+ArrowRight', action: 'setCutEnd', scope: 'patch', enabled: true },
    ];
    const migrated = withoutRemovedPatchKeys(table);

    expect(migrated).not.toContainEqual(expect.objectContaining({ keys: 'ShiftLeft+AltLeft+ArrowLeft', action: 'setCutStart' }));
    expect(migrated).not.toContainEqual(expect.objectContaining({ keys: 'ShiftLeft+AltLeft+ArrowRight', action: 'setCutEnd' }));
  });

  it('leaves a user binding on the same combination alone', () => {
    const table: KeyBinding[] = [{ keys: 'ShiftLeft+AltLeft+ArrowLeft', action: 'addSegment', scope: 'user' }];
    expect(withoutRemovedPatchKeys(table)).toStrictEqual(table);
  });

  it('leaves a patch row that was rebound to another action alone', () => {
    const table: KeyBinding[] = [{ keys: 'ShiftLeft+AltLeft+ArrowLeft', action: 'seekBackwards', scope: 'patch' }];
    expect(withoutRemovedPatchKeys(table)).toStrictEqual(table);
  });

  it('is idempotent', () => {
    const once = withoutRemovedPatchKeys(baseDefaultKeyBindings);
    expect(withoutRemovedPatchKeys(once)).toStrictEqual(once);
  });
});

describe('withRetargetedPatchKeys', () => {
  it('retargets the old patch defaults', () => {
    const migrated = withRetargetedPatchKeys([
      { keys: 'KeyZ', action: 'resetPlaybackRate', scope: 'patch', enabled: true },
      { keys: 'KeyD', action: 'seekNextFrame', scope: 'patch', enabled: true },
      { keys: 'KeyF', action: 'seekPreviousFrame', scope: 'patch', enabled: true },
    ]);
    expect(migrated).toContainEqual(expect.objectContaining({ keys: 'KeyZ', action: 'togglePlaybackRate', scope: 'patch' }));
    expect(migrated).toContainEqual(expect.objectContaining({ keys: 'KeyD', action: 'seekPreviousFrame', scope: 'patch' }));
    expect(migrated).toContainEqual(expect.objectContaining({ keys: 'KeyF', action: 'seekNextFrame', scope: 'patch' }));
  });

  it('keeps a switched-off default switched off', () => {
    const migrated = withRetargetedPatchKeys([{ keys: 'KeyD', action: 'seekNextFrame', scope: 'patch', enabled: false }]);
    expect(migrated).toStrictEqual([{ keys: 'KeyD', action: 'seekPreviousFrame', scope: 'patch', enabled: false }]);
  });

  it('leaves a user-rebound key alone', () => {
    const table: KeyBinding[] = [{ keys: 'KeyZ', action: 'addSegment', scope: 'user' }];
    expect(withRetargetedPatchKeys(table)).toStrictEqual(table);
  });

  it('leaves rows without a patch scope alone', () => {
    const table: KeyBinding[] = [
      { keys: 'KeyZ', action: 'resetPlaybackRate' },
      { keys: 'KeyZ', action: 'timelineToggleComfortZoom', scope: 'base' },
    ];
    expect(withRetargetedPatchKeys(table)).toStrictEqual(table);
  });

  it('leaves the new defaults alone (idempotent)', () => {
    const table: KeyBinding[] = [
      { keys: 'KeyZ', action: 'togglePlaybackRate', scope: 'patch', enabled: true },
      { keys: 'KeyD', action: 'seekPreviousFrame', scope: 'patch', enabled: true },
      { keys: 'KeyF', action: 'seekNextFrame', scope: 'patch', enabled: true },
    ];
    expect(withRetargetedPatchKeys(table)).toStrictEqual(table);
  });
});

describe('withRenamedPatchKeys', () => {
  it('moves the finish-and-keep key from Shift+G to Shift+F', () => {
    const migrated = withRenamedPatchKeys([{ keys: 'ShiftLeft+KeyG', action: 'finishKeepSource', scope: 'patch', enabled: true }]);
    expect(migrated).toStrictEqual([{ keys: 'ShiftLeft+KeyF', action: 'finishKeepSource', scope: 'patch', enabled: true }]);
  });

  it('keeps a switched-off default switched off', () => {
    const migrated = withRenamedPatchKeys([{ keys: 'ShiftLeft+KeyG', action: 'finishKeepSource', scope: 'patch', enabled: false }]);
    expect(migrated).toStrictEqual([{ keys: 'ShiftLeft+KeyF', action: 'finishKeepSource', scope: 'patch', enabled: false }]);
  });

  it('leaves a user-rebound key alone', () => {
    const table: KeyBinding[] = [{ keys: 'ShiftLeft+KeyG', action: 'addSegment', scope: 'user' }];
    expect(withRenamedPatchKeys(table)).toStrictEqual(table);
  });

  it('leaves a moved default that is no longer on Shift+G alone (idempotent)', () => {
    const table: KeyBinding[] = [{ keys: 'ShiftLeft+KeyF', action: 'finishKeepSource', scope: 'patch', enabled: true }];
    expect(withRenamedPatchKeys(table)).toStrictEqual(table);
  });

  it('keeps the old key when the user already uses the new one', () => {
    // Dropping the row would leave finish-and-keep without any key: the old key is free, so it stays.
    const table: KeyBinding[] = [
      { keys: 'ShiftLeft+KeyG', action: 'finishKeepSource', scope: 'patch', enabled: true },
      { keys: 'ShiftLeft+KeyF', action: 'addSegment', scope: 'user' },
    ];
    expect(withRenamedPatchKeys(table)).toStrictEqual([
      { keys: 'ShiftLeft+KeyG', action: 'finishKeepSource', scope: 'patch', enabled: true },
      { keys: 'ShiftLeft+KeyF', action: 'addSegment', scope: 'user' },
    ]);
  });

  it('renames the old row even when a switched-off row still sits on the new key', () => {
    // A switched-off row does not hold the key: it dispatches nothing (`resolveKeyBindings` skips
    // it) and raises no conflict, so dropping the fork's action would only lose its key.
    const table: KeyBinding[] = [
      { keys: 'ShiftLeft+KeyG', action: 'finishKeepSource', scope: 'patch', enabled: true },
      { keys: 'ShiftLeft+KeyF', action: 'addSegment', scope: 'user', enabled: false },
    ];
    expect(withRenamedPatchKeys(table)).toStrictEqual([
      { keys: 'ShiftLeft+KeyF', action: 'finishKeepSource', scope: 'patch', enabled: true },
      { keys: 'ShiftLeft+KeyF', action: 'addSegment', scope: 'user', enabled: false },
    ]);
  });
});
