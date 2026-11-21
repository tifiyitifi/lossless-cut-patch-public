// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { KeyBinding } from '../../types.js';
import {
  patchMergedTransportAdditions,
  patchMergedTransportOverrides,
  patchPlayerMergeBinding,
  patchPlayerRemovedBindings,
  patchPlayerTransportAdditions,
  patchPlayerTransportOverrides,
  patchTimecodeToggleKeys,
  patchTransportAdditions,
  patchTransportOverrides,
  remapPatchTransportBindings,
} from './transport.js';

const others: KeyBinding[] = [
  { keys: 'KeyL', action: 'increasePlaybackRate' },
  { keys: 'KeyJ', action: 'reducePlaybackRate' },
];

const additions: KeyBinding[] = [
  { keys: 'Delete', action: 'removeCurrentCutpoint' },
  { keys: 'KeyN', action: 'labelCurrentSegment' },
  { keys: 'ControlLeft+KeyD', action: 'duplicateCurrentSegment' },
  { keys: 'AltLeft+Slash', action: 'toggleNewSegmentMark' },
  { keys: 'ControlLeft+PageUp', action: 'jumpSeekFirstSegment' },
  { keys: 'ControlLeft+PageDown', action: 'jumpSeekLastSegment' },
  { keys: 'MetaLeft+PageUp', action: 'jumpSeekFirstSegment' },
  { keys: 'MetaLeft+PageDown', action: 'jumpSeekLastSegment' },
  { keys: 'ShiftLeft+KeyE', action: 'finish' },
  { keys: 'ControlLeft+Delete', action: 'discardSource' },
  { keys: 'ShiftLeft+KeyF', action: 'finishKeepSource' },
  { keys: 'NumpadDivide', action: 'goToTimecode' },
  { keys: 'ShiftLeft+PageUp', action: 'batchOpenPlayPreviousFile' },
  { keys: 'ShiftLeft+PageDown', action: 'batchOpenPlayNextFile' },
  { keys: 'ControlLeft+KeyE', action: 'captureSnapshot' },
  { keys: 'KeyX', action: 'reducePlaybackRate' },
  { keys: 'Minus', action: 'decreaseVolume' },
  { keys: 'Equal', action: 'increaseVolume' },
  { keys: 'AltLeft+KeyQ', action: 'togglePatchMenuBar' },
  { keys: 'AltLeft+KeyZ', action: 'timelineToggleComfortZoom' },
];

/** The additions minus the ones whose key a test already uses. */
const additionsExcept = (...keys: string[]) => additions.filter((binding) => !keys.includes(binding.keys));

describe('remapPatchTransportBindings', () => {
  it('re-purposes the transport defaults', () => {
    expect(remapPatchTransportBindings([
      { keys: 'Space', action: 'togglePlayResetSpeed' },
      { keys: 'KeyK', action: 'togglePlayNoResetSpeed' },
      { keys: 'Backspace', action: 'removeCurrentCutpoint' },
      { keys: 'PageUp', action: 'jumpFirstSegment' },
      { keys: 'PageDown', action: 'jumpLastSegment' },
      { keys: 'ShiftLeft+ArrowRight', action: 'jumpCutEnd' },
      { keys: 'Enter', action: 'labelCurrentSegment' },
      { keys: 'KeyZ', action: 'timelineToggleComfortZoom' },
      { keys: 'KeyC', action: 'captureSnapshot' },
      { keys: 'KeyD', action: 'cleanupFilesDialog' },
      { keys: 'KeyF', action: 'toggleFullscreenVideo' },
      ...others,
    ])).toStrictEqual([
      { keys: 'Space', action: 'togglePlayNoResetSpeed' },
      { keys: 'KeyK', action: 'resetPlaybackRate' },
      { keys: 'Backspace', action: 'jumpTimelineStart' },
      { keys: 'PageUp', action: 'jumpSeekPrevSegment' },
      { keys: 'PageDown', action: 'jumpSeekNextSegment' },
      { keys: 'ShiftLeft+ArrowRight', action: 'jumpSegmentEndPreview' },
      { keys: 'Enter', action: 'toggleFullscreenVideo' },
      { keys: 'KeyZ', action: 'togglePlaybackRate' },
      { keys: 'KeyC', action: 'increasePlaybackRate' },
      { keys: 'KeyD', action: 'seekPreviousFrame' },
      { keys: 'KeyF', action: 'seekNextFrame' },
      ...others,
      ...additions,
    ]);
  });

  it('leaves everything else untouched', () => {
    expect(remapPatchTransportBindings(others)).toStrictEqual([...others, ...additions]);
  });

  it('does not add a binding when the user already uses its key', () => {
    const bindings: KeyBinding[] = [
      ...others,
      { keys: 'Delete', action: 'removeSelectedSegments' },
      { keys: 'KeyN', action: 'addSegment' },
    ];
    expect(remapPatchTransportBindings(bindings)).toStrictEqual([
      ...bindings,
      ...additionsExcept('Delete', 'KeyN'),
    ]);
  });

  it('does not add the duplicate key when the user already uses it', () => {
    const bindings: KeyBinding[] = [...others, { keys: 'ControlLeft+KeyD', action: 'addSegment' }];
    expect(remapPatchTransportBindings(bindings)).toStrictEqual([
      ...bindings,
      ...additionsExcept('ControlLeft+KeyD'),
    ]);
  });

  it('respects a user binding that differs from the upstream default', () => {
    // Space moved to another action, K was rebound, Backspace unbound, Enter moved: none is re-purposed.
    expect(remapPatchTransportBindings([
      { keys: 'Space', action: 'togglePlayNoResetSpeed' },
      { keys: 'KeyK', action: 'togglePlayResetSpeed' },
      { keys: 'Enter', action: 'toggleFullscreenVideo' },
    ])).toStrictEqual([
      { keys: 'Space', action: 'togglePlayNoResetSpeed' },
      { keys: 'KeyK', action: 'togglePlayResetSpeed' },
      { keys: 'Enter', action: 'toggleFullscreenVideo' },
      ...additions,
    ]);
  });

  it('does not mutate the input', () => {
    const input: KeyBinding[] = [{ keys: 'Space', action: 'togglePlayResetSpeed' }];
    remapPatchTransportBindings(input);
    expect(input).toStrictEqual([{ keys: 'Space', action: 'togglePlayResetSpeed' }]);
  });

  it('keeps the segment walk in the merged-result window', () => {
    const defaults: KeyBinding[] = [
      { keys: 'PageUp', action: 'jumpFirstSegment' },
      { keys: 'PageDown', action: 'jumpLastSegment' },
      { keys: 'ArrowUp', action: 'jumpPrevSegment' },
      { keys: 'ArrowDown', action: 'jumpNextSegment' },
      { keys: 'ShiftLeft+AltLeft+ArrowUp', action: 'jumpSeekPrevSegment' },
      { keys: 'ShiftLeft+AltLeft+ArrowDown', action: 'jumpSeekNextSegment' },
      { keys: 'Enter', action: 'labelCurrentSegment' },
      { keys: 'KeyS', action: 'selectOnlyCurrentSegment' },
    ];

    expect(remapPatchTransportBindings(defaults, 'merged')).toStrictEqual([
      // PageUp / PageDown seek through the chapters, exactly like the cutting window.
      { keys: 'PageUp', action: 'jumpSeekPrevSegment' },
      { keys: 'PageDown', action: 'jumpSeekNextSegment' },
      // The bare arrows stay on the chapter walk (they are not turned into playlist moves).
      { keys: 'ArrowUp', action: 'jumpPrevSegment' },
      { keys: 'ArrowDown', action: 'jumpNextSegment' },
      { keys: 'ShiftLeft+AltLeft+ArrowUp', action: 'jumpSeekPrevSegment' },
      { keys: 'ShiftLeft+AltLeft+ArrowDown', action: 'jumpSeekNextSegment' },
      { keys: 'Enter', action: 'toggleFullscreenVideo' },
      // The user's own S binding is kept, so the new selection key is not added.
      { keys: 'KeyS', action: 'selectOnlyCurrentSegment' },
      { keys: 'KeyN', action: 'renameResultLabel' },
      { keys: 'ControlLeft+PageUp', action: 'jumpSeekFirstSegment' },
      { keys: 'ControlLeft+PageDown', action: 'jumpSeekLastSegment' },
      { keys: 'MetaLeft+PageUp', action: 'jumpSeekFirstSegment' },
      { keys: 'MetaLeft+PageDown', action: 'jumpSeekLastSegment' },
      { keys: 'ShiftLeft+KeyE', action: 'finish' },
      { keys: 'NumpadDivide', action: 'goToTimecode' },
      { keys: 'ControlLeft+KeyE', action: 'captureSnapshot' },
      { keys: 'KeyX', action: 'reducePlaybackRate' },
      { keys: 'Minus', action: 'decreaseVolume' },
      { keys: 'Equal', action: 'increaseVolume' },
      { keys: 'AltLeft+KeyZ', action: 'timelineToggleComfortZoom' },
      { keys: 'ShiftLeft+KeyN', action: 'renameResultFull' },
      { keys: 'AltLeft+ArrowUp', action: 'increaseVolume' },
      { keys: 'AltLeft+ArrowDown', action: 'decreaseVolume' },
      { keys: 'ShiftLeft+KeyS', action: 'selectOnlyCurrentSegment' },
    ]);
  });

  it('adds the merged window selection keys only when their keys are free', () => {
    const mergedKeys = remapPatchTransportBindings(others, 'merged');
    expect(mergedKeys).toContainEqual({ keys: 'KeyS', action: 'toggleCurrentSegmentSelected' });
    expect(mergedKeys).toContainEqual({ keys: 'ShiftLeft+KeyS', action: 'selectOnlyCurrentSegment' });

    // Not in the cut-results window: it has no segment list of its own.
    expect(remapPatchTransportBindings(others, 'player')).not.toContainEqual({ keys: 'KeyS', action: 'toggleCurrentSegmentSelected' });
    expect(remapPatchTransportBindings(others)).not.toContainEqual({ keys: 'KeyS', action: 'toggleCurrentSegmentSelected' });
  });

  it('walks the result playlist in the player window', () => {
    const defaults: KeyBinding[] = [
      { keys: 'PageUp', action: 'jumpFirstSegment' },
      { keys: 'PageDown', action: 'jumpLastSegment' },
      { keys: 'ArrowUp', action: 'jumpPrevSegment' },
      { keys: 'ArrowDown', action: 'jumpNextSegment' },
      { keys: 'ShiftLeft+AltLeft+ArrowUp', action: 'jumpSeekPrevSegment' },
      { keys: 'ShiftLeft+AltLeft+ArrowDown', action: 'jumpSeekNextSegment' },
      { keys: 'Enter', action: 'labelCurrentSegment' },
      { keys: 'ShiftLeft+ArrowRight', action: 'jumpCutEnd' },
    ];

    expect(remapPatchTransportBindings(defaults, 'player')).toStrictEqual([
      { keys: 'PageUp', action: 'playlistPrev' },
      { keys: 'PageDown', action: 'playlistNext' },
      { keys: 'ArrowUp', action: 'playlistPrev' },
      { keys: 'ArrowDown', action: 'playlistNext' },
      { keys: 'ShiftLeft+AltLeft+ArrowUp', action: 'playlistPrev' },
      { keys: 'ShiftLeft+AltLeft+ArrowDown', action: 'playlistNext' },
      { keys: 'Enter', action: 'toggleFullscreenVideo' },
      { keys: 'ShiftLeft+ArrowRight', action: 'jumpSegmentEndPreview' },
      { keys: 'KeyN', action: 'renameResultLabel' },
      { keys: 'ControlLeft+PageUp', action: 'playlistFirst' },
      { keys: 'ControlLeft+PageDown', action: 'playlistLast' },
      { keys: 'MetaLeft+PageUp', action: 'playlistFirst' },
      { keys: 'MetaLeft+PageDown', action: 'playlistLast' },
      { keys: 'ShiftLeft+KeyE', action: 'finish' },
      { keys: 'NumpadDivide', action: 'goToTimecode' },
      { keys: 'ControlLeft+KeyE', action: 'captureSnapshot' },
      { keys: 'KeyX', action: 'reducePlaybackRate' },
      { keys: 'Minus', action: 'decreaseVolume' },
      { keys: 'Equal', action: 'increaseVolume' },
      { keys: 'AltLeft+KeyZ', action: 'timelineToggleComfortZoom' },
      { keys: 'ShiftLeft+KeyN', action: 'renameResultFull' },
      { keys: 'AltLeft+ArrowUp', action: 'increaseVolume' },
      { keys: 'AltLeft+ArrowDown', action: 'decreaseVolume' },
    ]);
  });

  it('walks the result playlist with the first/last keys, and drops the dead Delete key', () => {
    const defaults: KeyBinding[] = [
      { keys: 'ShiftLeft+AltLeft+PageUp', action: 'jumpSeekFirstSegment' },
      { keys: 'ShiftLeft+AltLeft+PageDown', action: 'jumpSeekLastSegment' },
      { keys: 'Delete', action: 'removeCurrentCutpoint' },
    ];
    const remapped = remapPatchTransportBindings(defaults, 'player');
    expect(remapped).toContainEqual({ keys: 'ShiftLeft+AltLeft+PageUp', action: 'playlistFirst' });
    expect(remapped).toContainEqual({ keys: 'ShiftLeft+AltLeft+PageDown', action: 'playlistLast' });
    expect(remapped).not.toContainEqual({ keys: 'Delete', action: 'removeCurrentCutpoint' });
  });

  it('keeps the segment-end preview key in the results windows', () => {
    // The results windows play one clip, so the key previews the tail of that clip there.
    const defaults: KeyBinding[] = [{ keys: 'ShiftLeft+ArrowRight', action: 'jumpCutEnd' }];
    for (const context of ['player', 'merged'] as const) {
      expect(remapPatchTransportBindings(defaults, context)).toContainEqual({ keys: 'ShiftLeft+ArrowRight', action: 'jumpSegmentEndPreview' });
    }
    expect(remapPatchTransportBindings(defaults, 'editor')).toContainEqual({ keys: 'ShiftLeft+ArrowRight', action: 'jumpSegmentEndPreview' });
  });

  it('keeps a user binding that uses the same key for something else in the results windows', () => {
    const custom: KeyBinding[] = [{ keys: 'ShiftLeft+ArrowRight', action: 'seekForwards' }];
    expect(remapPatchTransportBindings(custom, 'player')).toContainEqual({ keys: 'ShiftLeft+ArrowRight', action: 'seekForwards' });
  });

  it('leaves a customized segment key alone in the player window too', () => {
    const bindings: KeyBinding[] = [
      { keys: 'PageUp', action: 'addSegment' },
      { keys: 'PageDown', action: 'jumpLastSegment' },
    ];
    const remapped = remapPatchTransportBindings(bindings, 'player');
    expect(remapped).toContainEqual({ keys: 'PageUp', action: 'addSegment' });
    expect(remapped).toContainEqual({ keys: 'PageDown', action: 'playlistNext' });
  });

  it('does not add Shift+N when the user already uses it', () => {
    const bindings: KeyBinding[] = [...others, { keys: 'ShiftLeft+KeyN', action: 'removeSelectedSegments' }];
    expect(remapPatchTransportBindings(bindings, 'player')).toContainEqual({ keys: 'ShiftLeft+KeyN', action: 'removeSelectedSegments' });
    expect(remapPatchTransportBindings(bindings, 'player').filter((binding) => binding.keys === 'ShiftLeft+KeyN')).toHaveLength(1);
  });

  it('re-purposes a binding that uses the other hand for the modifier', () => {
    // The keyboard hook matches the modifiers by their kind, so the right hand is the same
    // combination as the left one.
    expect(remapPatchTransportBindings([
      { keys: 'ShiftRight+ArrowRight', action: 'jumpCutEnd' },
    ])).toStrictEqual([
      // The user's own spelling of the key is kept.
      { keys: 'ShiftRight+ArrowRight', action: 'jumpSegmentEndPreview' },
      ...additions,
    ]);
  });

  it('keeps the segment-end preview key in the results windows, whatever hand it uses', () => {
    const defaults: KeyBinding[] = [{ keys: 'ShiftRight+ArrowRight', action: 'jumpCutEnd' }];
    for (const context of ['player', 'merged'] as const) {
      expect(remapPatchTransportBindings(defaults, context)).toContainEqual({ keys: 'ShiftRight+ArrowRight', action: 'jumpSegmentEndPreview' });
    }
  });

  it('remaps the result playlist keys whatever hand the modifier comes from', () => {
    const defaults: KeyBinding[] = [{ keys: 'ControlRight+PageUp', action: 'jumpSeekFirstSegment' }];
    expect(remapPatchTransportBindings(defaults, 'player')).toContainEqual({ keys: 'ControlRight+PageUp', action: 'playlistFirst' });
  });

  it('does not add a key the user already uses with the other hand', () => {
    const bindings: KeyBinding[] = [...others, { keys: 'ControlRight+KeyD', action: 'addSegment' }];
    expect(remapPatchTransportBindings(bindings)).not.toContainEqual({ keys: 'ControlLeft+KeyD', action: 'duplicateCurrentSegment' });
  });
});

describe('the merge key', () => {
  const defaults: KeyBinding[] = [{ keys: 'KeyE', action: 'export' }];

  it('merges the cut results in the results window', () => {
    expect(remapPatchTransportBindings(defaults, 'player')).toContainEqual({ keys: 'KeyE', action: 'mergeCutResults' });
  });

  it('keeps exporting in the cutting window', () => {
    expect(remapPatchTransportBindings(defaults)).toStrictEqual([...defaults, ...additions]);
  });

  it('does not merge in the merged-result window', () => {
    const remapped = remapPatchTransportBindings(defaults, 'merged');
    expect(remapped).toContainEqual({ keys: 'KeyE', action: 'export' });
    expect(remapped).not.toContainEqual({ keys: 'KeyE', action: 'mergeCutResults' });
  });

  it('respects a user binding that moved export away from E', () => {
    const custom: KeyBinding[] = [{ keys: 'KeyF', action: 'export' }];
    expect(remapPatchTransportBindings(custom, 'player')).not.toContainEqual({ keys: 'KeyF', action: 'mergeCutResults' });
  });
});

describe('the cut marking arrows', () => {
  const arrows: KeyBinding[] = [
    { keys: 'ArrowUp', action: 'jumpPrevSegment' },
    { keys: 'ArrowDown', action: 'jumpNextSegment' },
    { keys: 'KeyI', action: 'setCutStart' },
    { keys: 'KeyO', action: 'setCutEnd' },
  ];

  it('marks the in / out point with Up / Down, next to I / O', () => {
    const remapped = remapPatchTransportBindings(arrows);
    expect(remapped).toContainEqual({ keys: 'ArrowUp', action: 'setCutStart' });
    expect(remapped).toContainEqual({ keys: 'ArrowDown', action: 'setCutEnd' });
    // The letters stay bound: two keys, one action.
    expect(remapped).toContainEqual({ keys: 'KeyI', action: 'setCutStart' });
    expect(remapped).toContainEqual({ keys: 'KeyO', action: 'setCutEnd' });
    // The segment walk now only sits on PageUp / PageDown.
    expect(remapped).not.toContainEqual({ keys: 'ArrowUp', action: 'jumpPrevSegment' });
    expect(remapped).not.toContainEqual({ keys: 'ArrowDown', action: 'jumpNextSegment' });
  });

  it('does not take an arrow the user bound to something else', () => {
    const bindings: KeyBinding[] = [
      { keys: 'ArrowUp', action: 'addSegment' },
      { keys: 'ArrowDown', action: 'seekForwards' },
    ];
    expect(remapPatchTransportBindings(bindings)).toStrictEqual([...bindings, ...additions]);
  });

  it('walks the result playlist in the cut-results window', () => {
    const remapped = remapPatchTransportBindings(arrows, 'player');
    expect(remapped).toContainEqual({ keys: 'ArrowUp', action: 'playlistPrev' });
    expect(remapped).toContainEqual({ keys: 'ArrowDown', action: 'playlistNext' });
    // The viewer cannot mark, so the marking action must not survive there.
    expect(remapped).not.toContainEqual({ keys: 'ArrowUp', action: 'setCutStart' });
    expect(remapped).not.toContainEqual({ keys: 'ArrowDown', action: 'setCutEnd' });
  });

  it('walks the chapters in the merged-result window', () => {
    const remapped = remapPatchTransportBindings(arrows, 'merged');
    expect(remapped).toContainEqual({ keys: 'ArrowUp', action: 'jumpPrevSegment' });
    expect(remapped).toContainEqual({ keys: 'ArrowDown', action: 'jumpNextSegment' });
  });
});

describe('the volume and menu keys', () => {
  it('moves the preview volume to - and =, and keeps + free for add segment', () => {
    const defaults: KeyBinding[] = [
      { keys: 'AltLeft+ArrowUp', action: 'increaseVolume' },
      { keys: 'AltLeft+ArrowDown', action: 'decreaseVolume' },
      { keys: 'ShiftLeft+Equal', action: 'addSegment' },
    ];
    const remapped = remapPatchTransportBindings(defaults);

    // Alt+arrows mark the cut in the cutting window...
    expect(remapped).toContainEqual({ keys: 'AltLeft+ArrowUp', action: 'setCutStart' });
    expect(remapped).toContainEqual({ keys: 'AltLeft+ArrowDown', action: 'setCutEnd' });
    // ...and the volume moved to the unshifted keys.
    expect(remapped).toContainEqual({ keys: 'Minus', action: 'decreaseVolume' });
    expect(remapped).toContainEqual({ keys: 'Equal', action: 'increaseVolume' });
    // `+` is Shift+= and still adds a segment, so it never becomes a volume key.
    expect(remapped).toContainEqual({ keys: 'ShiftLeft+Equal', action: 'addSegment' });
  });

  it('shows and hides the app menu bar with Alt+Q in the cutting window only', () => {
    expect(remapPatchTransportBindings([])).toContainEqual({ keys: 'AltLeft+KeyQ', action: 'togglePatchMenuBar' });
    for (const context of ['player', 'merged'] as const) {
      expect(remapPatchTransportBindings([], context)).not.toContainEqual({ keys: 'AltLeft+KeyQ', action: 'togglePatchMenuBar' });
    }
  });

  it('gives the viewer its Alt+arrows volume back', () => {
    for (const context of ['player', 'merged'] as const) {
      const remapped = remapPatchTransportBindings([], context);
      expect(remapped).toContainEqual({ keys: 'AltLeft+ArrowUp', action: 'increaseVolume' });
      expect(remapped).toContainEqual({ keys: 'AltLeft+ArrowDown', action: 'decreaseVolume' });
      expect(remapped).not.toContainEqual({ keys: 'AltLeft+ArrowUp', action: 'setCutStart' });
      expect(remapped).not.toContainEqual({ keys: 'AltLeft+ArrowDown', action: 'setCutEnd' });
    }
  });

  it('does not take a key the user already bound to something else', () => {
    const bindings: KeyBinding[] = [
      { keys: 'Equal', action: 'addSegment' },
      { keys: 'AltLeft+ArrowUp', action: 'addSegment' },
      { keys: 'AltLeft+KeyQ', action: 'addSegment' },
    ];
    const remapped = remapPatchTransportBindings(bindings);

    expect(remapped).toContainEqual({ keys: 'Equal', action: 'addSegment' });
    expect(remapped).toContainEqual({ keys: 'AltLeft+ArrowUp', action: 'addSegment' });
    expect(remapped).toContainEqual({ keys: 'AltLeft+KeyQ', action: 'addSegment' });
    expect(remapped).not.toContainEqual({ keys: 'Equal', action: 'increaseVolume' });
    expect(remapped).not.toContainEqual({ keys: 'AltLeft+ArrowUp', action: 'setCutStart' });
    expect(remapped).not.toContainEqual({ keys: 'AltLeft+KeyQ', action: 'togglePatchMenuBar' });
  });
});

describe('the arrow seeks', () => {
  const defaults: KeyBinding[] = [
    { keys: 'ArrowLeft', action: 'seekBackwards' },
    { keys: 'ArrowRight', action: 'seekForwards' },
    { keys: 'AltLeft+ArrowLeft', action: 'seekBackwardsKeyframe' },
    { keys: 'AltLeft+ArrowRight', action: 'seekForwardsKeyframe' },
  ];

  it('swaps the bare arrows with Alt+arrows', () => {
    const remapped = remapPatchTransportBindings(defaults);
    expect(remapped).toContainEqual({ keys: 'ArrowLeft', action: 'seekBackwardsKeyframe' });
    expect(remapped).toContainEqual({ keys: 'ArrowRight', action: 'seekForwardsKeyframe' });
    expect(remapped).toContainEqual({ keys: 'AltLeft+ArrowLeft', action: 'seekBackwards' });
    expect(remapped).toContainEqual({ keys: 'AltLeft+ArrowRight', action: 'seekForwards' });
  });

  it('swaps whatever hand the modifier comes from', () => {
    const remapped = remapPatchTransportBindings([
      { keys: 'AltRight+ArrowLeft', action: 'seekBackwardsKeyframe' },
      { keys: 'AltRight+ArrowRight', action: 'seekForwardsKeyframe' },
    ]);
    expect(remapped).toContainEqual({ keys: 'AltRight+ArrowLeft', action: 'seekBackwards' });
    expect(remapped).toContainEqual({ keys: 'AltRight+ArrowRight', action: 'seekForwards' });
  });

  it('leaves an arrow the user rebound alone', () => {
    const bindings: KeyBinding[] = [{ keys: 'ArrowLeft', action: 'jumpTimelineStart' }];
    expect(remapPatchTransportBindings(bindings)).toStrictEqual([...bindings, ...additions]);
  });
});

describe('the forced new segment key', () => {
  it('is Alt+/ in the cutting window', () => {
    const remapped = remapPatchTransportBindings([]);
    expect(remapped).toContainEqual({ keys: 'AltLeft+Slash', action: 'toggleNewSegmentMark' });
  });

  it('does not use Ctrl+0, which the View menu already owns', () => {
    // `resetZoom` claims it: a page binding would compete with the menu for the same key.
    expect(remapPatchTransportBindings([]).some(({ keys }) => keys.split('+').includes('Digit0'))).toBe(false);
  });

  it('does not take a key the user already bound to something else', () => {
    const bindings: KeyBinding[] = [{ keys: 'AltLeft+Slash', action: 'addSegment' }];
    expect(remapPatchTransportBindings(bindings)).not.toContainEqual({ keys: 'AltLeft+Slash', action: 'toggleNewSegmentMark' });
  });

  it('is the same combination with the right hand', () => {
    const bindings: KeyBinding[] = [{ keys: 'AltRight+Slash', action: 'addSegment' }];
    expect(remapPatchTransportBindings(bindings)).not.toContainEqual({ keys: 'AltLeft+Slash', action: 'toggleNewSegmentMark' });
  });

  it('is not bound in the results windows, which cannot mark', () => {
    for (const context of ['player', 'merged'] as const) {
      expect(remapPatchTransportBindings([], context)).not.toContainEqual({ keys: 'AltLeft+Slash', action: 'toggleNewSegmentMark' });
    }
  });
});

describe('the patch bindings', () => {
  it('never use a digit key code the browser does not report', () => {
    // `KeyboardEvent.code` spells the digit keys `Digit0` ... `Digit9`, never `Key0`: a wrong code
    // silently binds nothing, because the keyboard hook indexes bindings by `e.code`.
    const bindings: KeyBinding[] = [
      ...patchTransportAdditions,
      ...patchPlayerTransportAdditions,
      ...patchMergedTransportAdditions,
      ...patchPlayerRemovedBindings,
      ...patchTransportOverrides.flatMap(({ from, to }) => [from, to]),
      ...patchPlayerTransportOverrides.flatMap(({ from, to }) => [from, to]),
      ...patchMergedTransportOverrides.flatMap(({ from, to }) => [from, to]),
      patchPlayerMergeBinding.from,
      patchPlayerMergeBinding.to,
    ];
    const invalid = bindings.filter(({ keys }) => keys.split('+').some((part) => /^Key\d$/.test(part)));
    expect(invalid).toStrictEqual([]);
  });
});

describe('the numpad seek key', () => {
  it('opens the seek dialog in every window', () => {
    // The numeric keypad works without leaving the keys: `+` starts a relative seek and needs a
    // value, so the same pad has to be able to open the dialog that takes it.
    for (const context of ['editor', 'player', 'merged'] as const) {
      expect(remapPatchTransportBindings([], context)).toContainEqual({ keys: patchTimecodeToggleKeys, action: 'goToTimecode' });
    }
  });

  it('does not take the key from a user binding', () => {
    const bindings: KeyBinding[] = [{ keys: patchTimecodeToggleKeys, action: 'addSegment' }];
    expect(remapPatchTransportBindings(bindings)).not.toContainEqual({ keys: patchTimecodeToggleKeys, action: 'goToTimecode' });
  });

  it('leaves the main keyboard slash alone', () => {
    // `Shift+/` opens the shortcut list and `Alt+/` arms the new-segment key, so patch mode only
    // claims the numeric keypad key, not `/` on the main keyboard.
    expect(remapPatchTransportBindings([]).some(({ keys }) => keys === 'Slash')).toBe(false);
  });
});

describe('the finish key', () => {
  it('is Shift+E in every window', () => {
    for (const context of ['editor', 'player', 'merged'] as const) {
      expect(remapPatchTransportBindings([], context)).toContainEqual({ keys: 'ShiftLeft+KeyE', action: 'finish' });
    }
  });

  it('is no longer Ctrl+M', () => {
    expect(remapPatchTransportBindings([])).not.toContainEqual({ keys: 'ControlLeft+KeyM', action: 'finish' });
  });

  it('leaves E alone in the merged-result window', () => {
    // Product design: a different operation has to look like a different operation. E exports in the
    // cutting window and merges in the cut-results window; making it finish the job in the merged
    // window would hide which stage the user is in behind the same key.
    const defaults: KeyBinding[] = [{ keys: 'KeyE', action: 'export' }];
    const remapped = remapPatchTransportBindings(defaults, 'merged');
    expect(remapped).toContainEqual({ keys: 'KeyE', action: 'export' });
    expect(remapped).not.toContainEqual({ keys: 'KeyE', action: 'finish' });
  });

  it('does not take Shift+E away from a user who bound it', () => {
    const bindings: KeyBinding[] = [{ keys: 'ShiftLeft+KeyE', action: 'addSegment' }];
    const remapped = remapPatchTransportBindings(bindings);
    expect(remapped).toContainEqual({ keys: 'ShiftLeft+KeyE', action: 'addSegment' });
    expect(remapped.filter((binding) => binding.keys === 'ShiftLeft+KeyE')).toHaveLength(1);
  });
});

describe('the discard key', () => {
  it('is Ctrl+Delete only in the cutting window', () => {
    expect(remapPatchTransportBindings([])).toContainEqual({ keys: 'ControlLeft+Delete', action: 'discardSource' });
    // The results windows play results; discarding a source is a cutting-window job.
    for (const context of ['player', 'merged'] as const) {
      expect(remapPatchTransportBindings([], context)).not.toContainEqual({ keys: 'ControlLeft+Delete', action: 'discardSource' });
    }
  });

  it('does not take Ctrl+Delete away from a user who bound it', () => {
    const bindings: KeyBinding[] = [{ keys: 'ControlLeft+Delete', action: 'addSegment' }];
    const remapped = remapPatchTransportBindings(bindings);
    expect(remapped).toContainEqual({ keys: 'ControlLeft+Delete', action: 'addSegment' });
    expect(remapped.filter((binding) => binding.keys === 'ControlLeft+Delete')).toHaveLength(1);
  });

  it('no longer takes Shift+D', () => {
    expect(remapPatchTransportBindings([]).some(({ keys }) => keys === 'ShiftLeft+KeyD')).toBe(false);
  });
});

describe('the finish-and-keep key', () => {
  it('is Shift+F only in the cutting window', () => {
    expect(remapPatchTransportBindings([])).toContainEqual({ keys: 'ShiftLeft+KeyF', action: 'finishKeepSource' });
    for (const context of ['player', 'merged'] as const) {
      expect(remapPatchTransportBindings([], context)).not.toContainEqual({ keys: 'ShiftLeft+KeyF', action: 'finishKeepSource' });
    }
  });

  it('does not take Shift+F away from a user who bound it', () => {
    const bindings: KeyBinding[] = [{ keys: 'ShiftLeft+KeyF', action: 'addSegment' }];
    const remapped = remapPatchTransportBindings(bindings);
    expect(remapped).toContainEqual({ keys: 'ShiftLeft+KeyF', action: 'addSegment' });
    expect(remapped.filter((binding) => binding.keys === 'ShiftLeft+KeyF')).toHaveLength(1);
  });

  it('no longer takes Shift+G', () => {
    expect(remapPatchTransportBindings([]).some(({ keys }) => keys === 'ShiftLeft+KeyG')).toBe(false);
  });
});

describe('the open-and-play file keys', () => {
  it('open the previous / next source in the cutting window', () => {
    const remapped = remapPatchTransportBindings([]);
    expect(remapped).toContainEqual({ keys: 'ShiftLeft+PageUp', action: 'batchOpenPlayPreviousFile' });
    expect(remapped).toContainEqual({ keys: 'ShiftLeft+PageDown', action: 'batchOpenPlayNextFile' });
  });

  it('leave the neighbours alone: the highlight move and the silent open', () => {
    // Three steps of the same idea, three keys: Shift+Up / Shift+Down only move the highlight
    // (upstream defaults, untouched), Ctrl+Shift+Up / Ctrl+Shift+Down open without playing, and
    // Shift+PageUp / Shift+PageDown open and play.
    const defaults: KeyBinding[] = [
      { keys: 'ShiftLeft+ArrowUp', action: 'batchPreviousFile' },
      { keys: 'ShiftLeft+ArrowDown', action: 'batchNextFile' },
      { keys: 'ControlLeft+ShiftLeft+ArrowUp', action: 'batchOpenPreviousFile' },
      { keys: 'ControlLeft+ShiftLeft+ArrowDown', action: 'batchOpenNextFile' },
    ];
    expect(remapPatchTransportBindings(defaults)).toStrictEqual([...defaults, ...additions]);
  });

  it('are not bound in the results windows, which have no source list', () => {
    for (const context of ['player', 'merged'] as const) {
      const keys = remapPatchTransportBindings([], context).map((binding) => binding.action);
      expect(keys).not.toContain('batchOpenPlayPreviousFile');
      expect(keys).not.toContain('batchOpenPlayNextFile');
    }
  });

  it('do not take a key the user already bound to something else', () => {
    const bindings: KeyBinding[] = [
      { keys: 'ShiftLeft+PageUp', action: 'addSegment' },
      { keys: 'ShiftLeft+PageDown', action: 'addSegment' },
    ];
    const remapped = remapPatchTransportBindings(bindings);
    expect(remapped).toStrictEqual([...bindings, ...additions.filter((binding) => !binding.keys.startsWith('ShiftLeft+Page'))]);
  });

  it('treat the right-hand Shift as the same combination', () => {
    const bindings: KeyBinding[] = [{ keys: 'ShiftRight+PageDown', action: 'addSegment' }];
    expect(remapPatchTransportBindings(bindings)).not.toContainEqual({ keys: 'ShiftLeft+PageDown', action: 'batchOpenPlayNextFile' });
  });
});
