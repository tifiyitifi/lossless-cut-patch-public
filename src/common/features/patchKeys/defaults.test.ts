// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { KeyBinding } from '../../types.js';
import { patchCommandConsoleBinding } from '../patchCommand/consoleKeyBinding.js';
import { remapPatchTransportBindings } from '../patchTransport/transport.js';
import { baseDefaultKeyBindings } from './baseDefaults.js';
import { defaultKeyBindings, patchDefaultKeyBindings } from './patchDefaults.js';
import { resolveKeyBindings } from './resolve.js';

/** Order-insensitive view of a binding list: the two representations are built in different orders. */
const asSet = (bindings: readonly KeyBinding[]) => bindings
  .map(({ keys, action }) => `${keys}::${action}`)
  .sort();

describe('the patch default table', () => {
  it('is exactly what the legacy editor remap produces, so the two cannot drift apart', () => {
    // The scope resolver works from the explicit table; the results windows and the old remap tests
    // work from `remapPatchTransportBindings`. Both describe one layout, so they must agree.
    expect(asSet(resolveKeyBindings(defaultKeyBindings, { mode: 'patch' }))).toStrictEqual(asSet([
      ...remapPatchTransportBindings(baseDefaultKeyBindings, 'editor'),
      patchCommandConsoleBinding,
    ]));
  });

  it('re-purposes the upstream keys instead of adding a second binding on them', () => {
    const patchKeys = patchDefaultKeyBindings.map((binding) => binding.keys);
    // Each of these exists in the base table too: one key, one action per mode.
    expect(patchKeys).toContain('Space');
    expect(patchKeys).toContain('KeyD');
    expect(patchKeys).toContain('KeyF');
    expect(patchKeys).toContain('KeyC');
    expect(patchKeys).toContain('KeyZ');
  });

  it('ships the speed and frame keys', () => {
    expect(patchDefaultKeyBindings).toContainEqual(expect.objectContaining({ keys: 'KeyX', action: 'reducePlaybackRate' }));
    expect(patchDefaultKeyBindings).toContainEqual(expect.objectContaining({ keys: 'KeyZ', action: 'togglePlaybackRate' }));
    expect(patchDefaultKeyBindings).toContainEqual(expect.objectContaining({ keys: 'KeyC', action: 'increasePlaybackRate' }));
    expect(patchDefaultKeyBindings).toContainEqual(expect.objectContaining({ keys: 'ControlLeft+KeyE', action: 'captureSnapshot' }));
    expect(patchDefaultKeyBindings).toContainEqual(expect.objectContaining({ keys: 'KeyD', action: 'seekPreviousFrame' }));
    expect(patchDefaultKeyBindings).toContainEqual(expect.objectContaining({ keys: 'KeyF', action: 'seekNextFrame' }));
    expect(patchDefaultKeyBindings).toContainEqual(expect.objectContaining({ keys: 'AltLeft+KeyZ', action: 'timelineToggleComfortZoom' }));
  });

  it('ships the patch volume, marking and menu keys', () => {
    expect(patchDefaultKeyBindings).toContainEqual(expect.objectContaining({ keys: 'Minus', action: 'decreaseVolume' }));
    expect(patchDefaultKeyBindings).toContainEqual(expect.objectContaining({ keys: 'Equal', action: 'increaseVolume' }));
    expect(patchDefaultKeyBindings).toContainEqual(expect.objectContaining({ keys: 'AltLeft+ArrowUp', action: 'setCutStart' }));
    expect(patchDefaultKeyBindings).toContainEqual(expect.objectContaining({ keys: 'AltLeft+ArrowDown', action: 'setCutEnd' }));
    expect(patchDefaultKeyBindings).toContainEqual(expect.objectContaining({ keys: 'AltLeft+KeyQ', action: 'togglePatchMenuBar' }));
  });

  it('keeps every base default in base mode', () => {
    // No two base defaults share a combination, so the resolver must not drop one.
    expect(resolveKeyBindings(defaultKeyBindings, { mode: 'base' })).toHaveLength(baseDefaultKeyBindings.length);
  });

  it('never claims a key twice within one mode', () => {
    const editor = resolveKeyBindings(defaultKeyBindings, { mode: 'patch' });
    const combinations = editor.map((binding) => binding.keys);
    expect(combinations).toHaveLength(new Set(combinations).size);
  });
});

describe('resolveKeyBindings', () => {
  it('runs the untouched upstream layout in base mode', () => {
    const base = resolveKeyBindings(defaultKeyBindings, { mode: 'base' });
    expect(base).toContainEqual(expect.objectContaining({ keys: 'KeyD', action: 'cleanupFilesDialog' }));
    expect(base).toContainEqual(expect.objectContaining({ keys: 'KeyZ', action: 'timelineToggleComfortZoom' }));
    // Patch-only keys do nothing in base mode.
    expect(base.some((binding) => binding.action === 'seekNextFrame' && binding.keys === 'KeyD')).toBe(false);
    expect(base.some((binding) => binding.action === 'finish')).toBe(false);
    expect(base.some((binding) => binding.action === 'togglePatchCommandConsole')).toBe(false);
  });

  it('lets patch win on the keys it claims, and keeps the rest', () => {
    const patch = resolveKeyBindings(defaultKeyBindings, { mode: 'patch' });
    expect(patch).toContainEqual(expect.objectContaining({ keys: 'KeyD', action: 'seekPreviousFrame', scope: 'patch' }));
    expect(patch).not.toContainEqual(expect.objectContaining({ keys: 'KeyD', action: 'cleanupFilesDialog' }));
    // A key no patch binding claims stays available.
    expect(patch).toContainEqual(expect.objectContaining({ keys: 'KeyB', action: 'splitCurrentSegment' }));
    expect(patch).toContainEqual(expect.objectContaining({ keys: 'KeyE', action: 'export' }));
  });

  it('drops a disabled binding, which hands its key back to the other mode', () => {
    const disabled = defaultKeyBindings.map((binding) => (
      binding.scope === 'patch' && binding.keys === 'KeyD' ? { ...binding, enabled: false } : binding
    ));

    // In patch mode the key falls through to the base binding it was shadowing.
    expect(resolveKeyBindings(disabled, { mode: 'patch' })).toContainEqual(expect.objectContaining({ keys: 'KeyD', action: 'cleanupFilesDialog', scope: 'base' }));
    // Base mode is unaffected: it never ran patch bindings anyway.
    expect(resolveKeyBindings(disabled, { mode: 'base' })).toContainEqual(expect.objectContaining({ keys: 'KeyD', action: 'cleanupFilesDialog' }));
  });

  it('runs a user binding in both modes and lets it win', () => {
    const custom: KeyBinding[] = [...defaultKeyBindings, { keys: 'KeyQ', action: 'addSegment', scope: 'user' }];
    for (const mode of ['base', 'patch'] as const) {
      expect(resolveKeyBindings(custom, { mode })).toContainEqual(expect.objectContaining({ keys: 'KeyQ', action: 'addSegment' }));
    }
  });

  it('keeps a binding without a scope as a user binding', () => {
    const legacy: KeyBinding[] = [...baseDefaultKeyBindings, { keys: 'KeyQ', action: 'addSegment' }];
    for (const mode of ['base', 'patch'] as const) {
      expect(resolveKeyBindings(legacy, { mode })).toContainEqual(expect.objectContaining({ keys: 'KeyQ', action: 'addSegment' }));
    }
  });

  it('re-purposes the walk keys in the results windows', () => {
    const player = resolveKeyBindings(defaultKeyBindings, { mode: 'patch', context: 'player' });
    expect(player).toContainEqual(expect.objectContaining({ keys: 'PageUp', action: 'playlistPrev' }));
    expect(player).toContainEqual(expect.objectContaining({ keys: 'KeyE', action: 'mergeCutResults' }));

    const merged = resolveKeyBindings(defaultKeyBindings, { mode: 'patch', context: 'merged' });
    expect(merged).toContainEqual(expect.objectContaining({ keys: 'ArrowUp', action: 'jumpPrevSegment' }));
    expect(merged).not.toContainEqual(expect.objectContaining({ keys: 'KeyE', action: 'mergeCutResults' }));
  });
});
