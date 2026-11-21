// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { allPatchActions, defaultPatchKeyBindings, findPatchKeyConflict, formatPatchKeyLabel, getPatchActionForKey, getPatchKeyLabelForAction, mergePatchKeyBindings, normalizePatchKeyEvent, setPatchKeyBinding } from './keymap.js';

const baseEvent = { key: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };

describe('normalizePatchKeyEvent', () => {
  it('lower-cases single letters and keeps shift', () => {
    expect(normalizePatchKeyEvent({ ...baseEvent, key: 'I' })).toStrictEqual({ key: 'i', shift: false });
    expect(normalizePatchKeyEvent({ ...baseEvent, key: 'I', shiftKey: true })).toStrictEqual({ key: 'i', shift: true });
  });

  it('keeps non-letter keys verbatim', () => {
    expect(normalizePatchKeyEvent({ ...baseEvent, key: 'ArrowLeft' })).toStrictEqual({ key: 'ArrowLeft', shift: false });
    expect(normalizePatchKeyEvent({ ...baseEvent, key: ' ' })).toStrictEqual({ key: ' ', shift: false });
  });

  it('ignores events with ctrl/meta/alt held', () => {
    expect(normalizePatchKeyEvent({ ...baseEvent, key: 'a', ctrlKey: true })).toBeUndefined();
    expect(normalizePatchKeyEvent({ ...baseEvent, key: 'a', metaKey: true })).toBeUndefined();
    expect(normalizePatchKeyEvent({ ...baseEvent, key: 'a', altKey: true })).toBeUndefined();
  });
});

describe('getPatchActionForKey', () => {
  it('maps default bindings', () => {
    expect(getPatchActionForKey(defaultPatchKeyBindings, { key: ' ', shift: false })).toBe('play-pause');
    expect(getPatchActionForKey(defaultPatchKeyBindings, { key: 'i', shift: false })).toBe('set-cut-start');
    expect(getPatchActionForKey(defaultPatchKeyBindings, { key: 'ArrowLeft', shift: false })).toBe('seek-back');
    expect(getPatchActionForKey(defaultPatchKeyBindings, { key: 'PageUp', shift: false })).toBe('prev-file');
    expect(getPatchActionForKey(defaultPatchKeyBindings, { key: 'PageDown', shift: false })).toBe('next-file');
  });

  it('maps the snapshot and selection bindings', () => {
    expect(getPatchActionForKey(defaultPatchKeyBindings, { key: 'k', shift: false })).toBe('snapshot');
    expect(getPatchActionForKey(defaultPatchKeyBindings, { key: 'k', shift: true })).toBe('snapshot-clipboard');
    expect(getPatchActionForKey(defaultPatchKeyBindings, { key: 's', shift: false })).toBe('toggle-select');
    expect(getPatchActionForKey(defaultPatchKeyBindings, { key: 'p', shift: false })).toBe('play-selected');
  });

  it('returns undefined for unbound keys', () => {
    expect(getPatchActionForKey(defaultPatchKeyBindings, { key: 'q', shift: false })).toBeUndefined();
  });

  it('respects shift-specific bindings and their order', () => {
    const bindings = [
      { action: 'next-segment' as const, key: 'v', shift: false },
      { action: 'prev-segment' as const, key: 'v', shift: true },
    ];
    expect(getPatchActionForKey(bindings, { key: 'v', shift: false })).toBe('next-segment');
    expect(getPatchActionForKey(bindings, { key: 'v', shift: true })).toBe('prev-segment');
  });

  it('ignores shift when the binding does not specify it', () => {
    const bindings = [{ action: 'mute' as const, key: 'm' }];
    expect(getPatchActionForKey(bindings, { key: 'm', shift: false })).toBe('mute');
    expect(getPatchActionForKey(bindings, { key: 'm', shift: true })).toBe('mute');
  });
});

describe('key labels', () => {
  it('formats keys for display', () => {
    expect(formatPatchKeyLabel(' ')).toBe('Space');
    expect(formatPatchKeyLabel('ArrowLeft')).toBe('←');
    expect(formatPatchKeyLabel('i')).toBe('I');
    expect(formatPatchKeyLabel('PageDown')).toBe('PgDn');
  });

  it('finds the label for an action', () => {
    expect(getPatchKeyLabelForAction(defaultPatchKeyBindings, 'prev-file')).toBe('PgUp');
    expect(getPatchKeyLabelForAction(defaultPatchKeyBindings, 'cut')).toBe('E');
  });
});

describe('allPatchActions', () => {
  it('contains every bound action', () => {
    for (const binding of defaultPatchKeyBindings) {
      expect(allPatchActions).toContain(binding.action);
    }
  });

  it('has no duplicates', () => {
    expect(new Set(allPatchActions).size).toBe(allPatchActions.length);
  });
});

describe('mergePatchKeyBindings', () => {
  it('returns the defaults when there are no custom bindings', () => {
    expect(mergePatchKeyBindings([])).toStrictEqual([...defaultPatchKeyBindings]);
  });

  it('overrides only the customised action and keeps the order', () => {
    const merged = mergePatchKeyBindings([{ action: 'cut', key: 'q' }]);
    expect(merged).toHaveLength(defaultPatchKeyBindings.length);
    expect(merged[0]).toStrictEqual(defaultPatchKeyBindings[0]);
    expect(getPatchKeyLabelForAction(merged, 'cut')).toBe('Q');
    expect(getPatchActionForKey(merged, { key: 'e', shift: false })).toBeUndefined();
  });

  it('keeps custom bindings for actions without a default', () => {
    const merged = mergePatchKeyBindings([{ action: 'mute', key: 'n' }]);
    expect(getPatchActionForKey(merged, { key: 'n', shift: false })).toBe('mute');
    expect(getPatchActionForKey(merged, { key: 'm', shift: false })).toBeUndefined();
  });
});

describe('setPatchKeyBinding', () => {
  it('replaces an existing binding in place', () => {
    const next = setPatchKeyBinding(defaultPatchKeyBindings, 'cut', 'q', true);
    expect(next).toHaveLength(defaultPatchKeyBindings.length);
    expect(next.find((binding) => binding.action === 'cut')).toStrictEqual({ action: 'cut', key: 'q', shift: true });
    expect(next[0]).toStrictEqual(defaultPatchKeyBindings[0]);
  });

  it('appends a binding for an unbound action', () => {
    expect(setPatchKeyBinding([], 'mute', 'n')).toStrictEqual([{ action: 'mute', key: 'n', shift: undefined }]);
  });
});

describe('findPatchKeyConflict', () => {
  it('finds the action already using a key', () => {
    expect(findPatchKeyConflict(defaultPatchKeyBindings, 'i', false)).toBe('set-cut-start');
  });

  it('ignores the action being edited', () => {
    expect(findPatchKeyConflict(defaultPatchKeyBindings, 'i', false, 'set-cut-start')).toBeUndefined();
  });

  it('treats a shift-agnostic binding as conflicting with both shift states', () => {
    const bindings = [{ action: 'mute' as const, key: 'm' }];
    expect(findPatchKeyConflict(bindings, 'm', true)).toBe('mute');
    expect(findPatchKeyConflict(bindings, 'm', false)).toBe('mute');
  });

  it('keeps shift-specific bindings apart', () => {
    const bindings = [
      { action: 'seek-back' as const, key: 'v', shift: false },
      { action: 'seek-forward' as const, key: 'v', shift: true },
    ];
    expect(findPatchKeyConflict(bindings, 'v', true)).toBe('seek-forward');
    expect(findPatchKeyConflict(bindings, 'v', false)).toBe('seek-back');
  });
});
