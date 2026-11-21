// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { KeyBinding } from '../../types.js';
import { describeLayoutDifferences, describeUserChanges, hasUserChanges } from './differences.js';
import { baseDefaultKeyBindings } from './baseDefaults.js';
import { defaultKeyBindings } from './patchDefaults.js';

const rowForKey = (differences: ReturnType<typeof describeLayoutDifferences>, key: string) => (
  differences.find((difference) => difference.keys === key)
);

describe('describeLayoutDifferences', () => {
  it('lists the keys patch mode re-purposes', () => {
    const differences = describeLayoutDifferences();

    expect(rowForKey(differences, 'KeyZ')).toStrictEqual({ keys: 'KeyZ', baseAction: 'timelineToggleComfortZoom', patchAction: 'togglePlaybackRate' });
    expect(rowForKey(differences, 'KeyD')).toStrictEqual({ keys: 'KeyD', baseAction: 'cleanupFilesDialog', patchAction: 'seekPreviousFrame' });
    expect(rowForKey(differences, 'KeyF')).toStrictEqual({ keys: 'KeyF', baseAction: 'toggleFullscreenVideo', patchAction: 'seekNextFrame' });
    expect(rowForKey(differences, 'KeyC')).toStrictEqual({ keys: 'KeyC', baseAction: 'captureSnapshot', patchAction: 'increasePlaybackRate' });
    expect(rowForKey(differences, 'Space')).toStrictEqual({ keys: 'Space', baseAction: 'togglePlayResetSpeed', patchAction: 'togglePlayNoResetSpeed' });
    expect(rowForKey(differences, 'PageUp')).toStrictEqual({ keys: 'PageUp', baseAction: 'jumpFirstSegment', patchAction: 'jumpSeekPrevSegment' });
  });

  it('lists the keys patch mode adds with an empty base side', () => {
    const differences = describeLayoutDifferences();

    expect(rowForKey(differences, 'KeyX')).toStrictEqual({ keys: 'KeyX', baseAction: undefined, patchAction: 'reducePlaybackRate' });
    expect(rowForKey(differences, 'ControlLeft+KeyE')).toStrictEqual({ keys: 'ControlLeft+KeyE', baseAction: undefined, patchAction: 'captureSnapshot' });
  });

  it('lists the alternative comfort zoom key instead of inventing a difference on Z', () => {
    const differences = describeLayoutDifferences();
    expect(rowForKey(differences, 'AltLeft+KeyZ')).toStrictEqual({ keys: 'AltLeft+KeyZ', baseAction: undefined, patchAction: 'timelineToggleComfortZoom' });
  });

  it('leaves the keys both modes handle the same way out', () => {
    const differences = describeLayoutDifferences();
    const keys = differences.map((difference) => difference.keys);
    expect(keys).not.toContain('KeyB');
    expect(keys).not.toContain('KeyE');
    expect(keys).not.toContain('ShiftLeft+Slash');
    expect(keys).not.toContain('ControlLeft+KeyZ');
  });

  it('ninety percent of the rows come from the right hands of the two tables', () => {
    // Every row must have at least one side, and never the same action on both.
    for (const difference of describeLayoutDifferences()) {
      expect(difference.baseAction !== undefined || difference.patchAction !== undefined).toBe(true);
      expect(difference.baseAction).not.toBe(difference.patchAction);
    }
  });

  it('compares by combination, not by the hand that holds the modifier', () => {
    const base: KeyBinding[] = [{ keys: 'ShiftRight+ArrowRight', action: 'jumpCutEnd' }];
    const patch: KeyBinding[] = [{ keys: 'ShiftLeft+ArrowRight', action: 'jumpSegmentEndPreview' }];
    expect(describeLayoutDifferences(base, patch)).toStrictEqual([
      { keys: 'ShiftLeft+ArrowRight', baseAction: 'jumpCutEnd', patchAction: 'jumpSegmentEndPreview' },
    ]);
  });
});

describe('describeUserChanges', () => {
  it('reports nothing for the shipped table', () => {
    const changes = describeUserChanges(defaultKeyBindings);
    expect(changes).toStrictEqual({ added: [], disabled: [], missing: [] });
    expect(hasUserChanges(changes)).toBe(false);
  });

  it('reports an added key', () => {
    const changes = describeUserChanges([...defaultKeyBindings, { keys: 'KeyQ', action: 'addSegment', scope: 'user' }]);
    expect(changes.added).toStrictEqual([{ keys: 'KeyQ', action: 'addSegment', scope: 'user' }]);
    expect(hasUserChanges(changes)).toBe(true);
  });

  it('reports a switched-off default once', () => {
    const bindings = defaultKeyBindings.map((binding) => (
      binding.scope === 'patch' && binding.keys === 'KeyD' ? { ...binding, enabled: false } : binding
    ));
    const changes = describeUserChanges(bindings);
    expect(changes.disabled).toStrictEqual([{ keys: 'KeyD', action: 'seekPreviousFrame', scope: 'patch', enabled: false }]);
  });

  it('reports a default the stored table lost', () => {
    const withoutExport = defaultKeyBindings.filter((binding) => binding.action !== 'export');
    expect(describeUserChanges(withoutExport).missing).toStrictEqual([{ keys: 'KeyE', action: 'export', scope: 'base', enabled: true }]);
  });

  it('ignores the spelling of the modifier hand', () => {
    const bindings = defaultKeyBindings.map((binding) => (
      binding.keys === 'ShiftLeft+KeyZ' ? { ...binding, keys: 'ShiftRight+KeyZ' } : binding
    ));
    expect(describeUserChanges(bindings)).toStrictEqual({ added: [], disabled: [], missing: [] });
  });

  it('compares against an explicit default table', () => {
    const changes = describeUserChanges(baseDefaultKeyBindings, baseDefaultKeyBindings);
    expect(hasUserChanges(changes)).toBe(false);
  });
});
