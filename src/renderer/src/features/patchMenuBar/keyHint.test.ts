import { describe, expect, it } from 'vitest';

import type { KeyBinding } from '../../../../common/types';
import { pickMenuBarKey } from './keyHint';

const patchDefault: KeyBinding = { keys: 'AltLeft+KeyQ', action: 'togglePatchMenuBar', scope: 'patch' };

describe('pickMenuBarKey', () => {
  it('returns the patch default keys', () => {
    expect(pickMenuBarKey([patchDefault], { preferMetaKey: false })).toBe('AltLeft+KeyQ');
  });

  it('returns undefined when the action has no key', () => {
    expect(pickMenuBarKey([], { preferMetaKey: false })).toBeUndefined();
    expect(pickMenuBarKey([
      { keys: 'AltLeft+KeyQ', action: 'addSegment', scope: 'patch' },
    ], { preferMetaKey: false })).toBeUndefined();
  });

  it('follows a user binding', () => {
    expect(pickMenuBarKey([
      patchDefault,
      { keys: 'ControlLeft+ShiftLeft+KeyM', action: 'togglePatchMenuBar', scope: 'user' },
    ], { preferMetaKey: false })).toBe('ControlLeft+ShiftLeft+KeyM');
  });

  it('prefers the platform spelling over a Meta alias', () => {
    expect(pickMenuBarKey([
      { keys: 'MetaLeft+KeyQ', action: 'togglePatchMenuBar', scope: 'patch' },
      { keys: 'ControlLeft+KeyQ', action: 'togglePatchMenuBar', scope: 'patch' },
    ], { preferMetaKey: false })).toBe('ControlLeft+KeyQ');
  });
});
