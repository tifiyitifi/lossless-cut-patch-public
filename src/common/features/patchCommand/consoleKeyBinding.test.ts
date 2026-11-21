// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { patchCommandConsoleBinding, withPatchCommandConsoleBinding } from './consoleKeyBinding.js';

describe('withPatchCommandConsoleBinding', () => {
  it('appends the default console binding to a config that predates it', () => {
    const existing = [{ keys: 'KeyK', action: 'togglePlayNoResetSpeed' } as const];
    const result = withPatchCommandConsoleBinding(existing);
    expect(result).toHaveLength(2);
    expect(result[1]).toStrictEqual(patchCommandConsoleBinding);
    expect(result[0]).toStrictEqual(existing[0]);
  });

  it('leaves a config that already has the action alone (even if rebound or unbound elsewhere)', () => {
    const rebound = [{ keys: 'ControlLeft+KeyP', action: 'togglePatchCommandConsole' } as const];
    expect(withPatchCommandConsoleBinding(rebound)).toStrictEqual(rebound);
    expect(withPatchCommandConsoleBinding([])).toStrictEqual([patchCommandConsoleBinding]);
  });

  it('does not mutate the input', () => {
    const existing: { keys: string, action: 'togglePlayNoResetSpeed' }[] = [{ keys: 'KeyK', action: 'togglePlayNoResetSpeed' }];
    withPatchCommandConsoleBinding(existing);
    expect(existing).toHaveLength(1);
  });
});
