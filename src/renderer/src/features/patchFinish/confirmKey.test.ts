// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import isSwalConfirmKey from './confirmKey';

const base = { code: 'KeyE', ctrlKey: false, altKey: false, metaKey: false, repeat: false, shiftKey: false };

describe('isSwalConfirmKey', () => {
  it('confirms on E and Shift+E', () => {
    expect(isSwalConfirmKey(base)).toBe(true);
    expect(isSwalConfirmKey({ ...base, shiftKey: true })).toBe(true);
  });

  it('ignores other keys', () => {
    expect(isSwalConfirmKey({ ...base, code: 'Enter' })).toBe(false);
    expect(isSwalConfirmKey({ ...base, code: 'ArrowLeft' })).toBe(false);
    expect(isSwalConfirmKey({ ...base, code: 'KeyQ' })).toBe(false);
    // Shift+another key is still not the finish key.
    expect(isSwalConfirmKey({ ...base, code: 'KeyQ', shiftKey: true })).toBe(false);
  });

  it('confirms on Shift+F only where the skip workflow asks for it', () => {
    const shiftF = { ...base, code: 'KeyF', shiftKey: true };
    expect(isSwalConfirmKey(shiftF, { includeSkipKey: true })).toBe(true);
    // Plain `F` steps one frame, never a confirm key.
    expect(isSwalConfirmKey({ ...base, code: 'KeyF' }, { includeSkipKey: true })).toBe(false);
    // The export's "Nothing to export" prompt must not answer to the skip key.
    expect(isSwalConfirmKey(shiftF)).toBe(false);
    expect(isSwalConfirmKey(shiftF, { includeSkipKey: false })).toBe(false);
  });

  it('leaves the OS-modified keys alone', () => {
    expect(isSwalConfirmKey({ ...base, ctrlKey: true })).toBe(false);
    expect(isSwalConfirmKey({ ...base, altKey: true })).toBe(false);
    expect(isSwalConfirmKey({ ...base, metaKey: true })).toBe(false);
    expect(isSwalConfirmKey({ ...base, ctrlKey: true, shiftKey: true })).toBe(false);
  });

  it('ignores the auto-repeat of a held key', () => {
    expect(isSwalConfirmKey({ ...base, repeat: true })).toBe(false);
  });
});
