// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { KeyBinding } from '../../types.js';
import { defaultKeyBindings } from './patchDefaults.js';
import { pickDisplayKeyBinding, usesMetaKey } from './displayKey.js';
import { resolveKeyBindings } from './resolve.js';

const patchBindings = resolveKeyBindings(defaultKeyBindings, { mode: 'patch' });

describe('pickDisplayKeyBinding', () => {
  it('shows Ctrl+Z on Windows instead of the macOS alias', () => {
    expect(pickDisplayKeyBinding(patchBindings, 'undo', { preferMetaKey: false })?.keys).toBe('ControlLeft+KeyZ');
  });

  it('shows Cmd+Z on macOS, where Meta is the primary modifier', () => {
    expect(pickDisplayKeyBinding(patchBindings, 'undo', { preferMetaKey: true })?.keys).toBe('MetaLeft+KeyZ');
  });

  it('keeps the alias when the only spelling of the action uses Meta', () => {
    const metaOnly: KeyBinding[] = [{ keys: 'MetaLeft+KeyZ', action: 'undo' }];
    expect(pickDisplayKeyBinding(metaOnly, 'undo', { preferMetaKey: false })?.keys).toBe('MetaLeft+KeyZ');
  });

  it('prefers the patch layout over the upstream key it sits next to', () => {
    // Both work; the landing page teaches the patch layout (`X`), not the upstream `J`.
    expect(pickDisplayKeyBinding(patchBindings, 'reducePlaybackRate', { preferMetaKey: false })?.keys).toBe('KeyX');
    expect(pickDisplayKeyBinding(patchBindings, 'increasePlaybackRate', { preferMetaKey: false })?.keys).toBe('KeyC');
  });

  it('prefers the user binding over both modes', () => {
    const bindings: KeyBinding[] = [
      ...patchBindings,
      { keys: 'KeyQ', action: 'reducePlaybackRate', scope: 'user' },
    ];
    expect(pickDisplayKeyBinding(bindings, 'reducePlaybackRate', { preferMetaKey: false })?.keys).toBe('KeyQ');
  });

  it('returns undefined for an action without a binding', () => {
    expect(pickDisplayKeyBinding(patchBindings, 'mergeCutResults', { preferMetaKey: false })).toBeUndefined();
  });

  it('recognizes both Meta spellings', () => {
    expect(usesMetaKey('MetaLeft+KeyZ')).toBe(true);
    expect(usesMetaKey('MetaRight+KeyZ')).toBe(true);
    expect(usesMetaKey('ControlLeft+KeyZ')).toBe(false);
  });
});
