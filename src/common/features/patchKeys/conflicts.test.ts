// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { KeyBinding } from '../../types.js';
import { analyzeKeyBindingConflicts, analyzeDisableImpact, findBlockingConflicts } from './conflicts.js';
import { defaultKeyBindings } from './patchDefaults.js';

describe('analyzeKeyBindingConflicts', () => {
  it('blocks a key of the user that takes a default key', () => {
    const report = analyzeKeyBindingConflicts(defaultKeyBindings, { keys: 'KeyD', action: 'addSegment', scope: 'user' });
    expect(report.severity).toBe('blocking');
    // Both layouts claim D; the report names them.
    expect(report.conflicts.some(({ binding }) => binding.action === 'seekPreviousFrame')).toBe(true);
    expect(report.conflicts.some(({ binding }) => binding.action === 'cleanupFilesDialog')).toBe(true);
  });

  it('only warns when the candidate belongs to one layout', () => {
    const report = analyzeKeyBindingConflicts(defaultKeyBindings, { keys: 'KeyD', action: 'addSegment', scope: 'base' });
    expect(report.severity).toBe('warning');
    expect(report.conflicts.length).toBeGreaterThan(0);
  });

  it('treats the same action on the same key as no conflict', () => {
    // The layout deliberately has two keys for one action, and one key must stay one action.
    const bindings: KeyBinding[] = [{ keys: 'KeyI', action: 'setCutStart', scope: 'base' }];
    expect(analyzeKeyBindingConflicts(bindings, { keys: 'KeyI', action: 'setCutStart', scope: 'user' }).conflicts).toStrictEqual([]);
  });

  it('ignores a switched-off default, so disabling frees its key', () => {
    const bindings: KeyBinding[] = [
      { keys: 'KeyD', action: 'seekPreviousFrame', scope: 'patch', enabled: false },
    ];
    expect(analyzeKeyBindingConflicts(bindings, { keys: 'KeyD', action: 'addSegment', scope: 'user' }).conflicts).toStrictEqual([]);
  });

  it('lists the keys that keep the conflicting action reachable', () => {
    const bindings: KeyBinding[] = [
      { keys: 'KeyI', action: 'setCutStart', scope: 'base' },
      { keys: 'ArrowUp', action: 'setCutStart', scope: 'patch' },
      { keys: 'KeyD', action: 'seekPreviousFrame', scope: 'patch' },
    ];
    const report = analyzeKeyBindingConflicts(bindings, { keys: 'KeyD', action: 'addSegment', scope: 'user' });
    expect(report.conflicts).toHaveLength(1);
    // Deleting D would still leave the frame step on nothing, and the report says so.
    expect(report.conflicts[0]?.bindingAlternatives).toStrictEqual([]);
  });
});

describe('analyzeDisableImpact', () => {
  it('names the base binding a patch key was shadowing', () => {
    const target = defaultKeyBindings.find((binding) => binding.scope === 'patch' && binding.keys === 'KeyD');
    expect(target).toBeDefined();
    const impact = analyzeDisableImpact(defaultKeyBindings, target!);
    expect(impact).toContainEqual(expect.objectContaining({ keys: 'KeyD', action: 'cleanupFilesDialog' }));
  });

  it('reports nothing when the key has no fallback', () => {
    const target = defaultKeyBindings.find((binding) => binding.scope === 'patch' && binding.keys === 'ShiftLeft+KeyE');
    expect(target).toBeDefined();
    expect(analyzeDisableImpact(defaultKeyBindings, target!)).toStrictEqual([]);
  });
});

describe('findBlockingConflicts', () => {
  it('finds nothing in the shipped layout', () => {
    // The two default tables are disjoint by construction: base/patch collisions are resolved by the
    // mode, and nothing here is a user binding.
    expect(findBlockingConflicts(defaultKeyBindings)).toStrictEqual([]);
  });

  it('finds a user binding on a default key', () => {
    const bindings: KeyBinding[] = [...defaultKeyBindings, { keys: 'KeyD', action: 'addSegment', scope: 'user' }];
    expect(findBlockingConflicts(bindings).length).toBeGreaterThan(0);
  });
});
