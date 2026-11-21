import type { KeyBinding } from '../../types.js';

/**
Patch-mode transport conventions (pure data + logic).

Patch mode follows a PotPlayer-style transport:
- the play/pause key leaves the playback speed alone, and the "K" slot resets the speed to 1x;
- Backspace jumps to the very start of the video, while Delete removes the current cut point;
- PageUp / PageDown walk the cut segments (and move the playhead there), while Ctrl+PageUp /
  Ctrl+PageDown jump to the first / last one;
- Shift+PageUp / Shift+PageDown switch to the previous / next source video and start playing it;
- the arrows carry the cutting: Up / Down mark the in / out point, Alt+Up / Down do the same, and
  the bare Left / Right step keyframes while Alt+Left / Right seek (upstream has both pairs the
  other way round);
- the preview volume is on M (mute, unchanged), `-` and `=` (down / up): upstream put it on
  Alt+Up / Down, which patch mode needs for the cut marking;
- `Alt+Q` shows or hides the app menu bar. Patch mode keeps the bar hidden so a bare Alt cannot
  take the focus away from the cutting keys; open it only when a menu entry is needed;
- `Alt+/` arms "the next in point starts a new segment" (used up by that press, cancelled by
  pressing it again; `O` and the other keys leave it armed);
- Shift+Right stops a lead-in before the segment end instead of jumping to the end, and Enter
  toggles full screen (the segment label moves to N);
- X / Z / C drive the playback speed (slow down / toggle 1x and the last chosen speed / speed up) and D / F step one frame
  (D back, F forward), the PotPlayer layout under the left hand;
- Ctrl+E captures a snapshot, so the bare C is free for the speed.

Upstream binds these differently, so patch mode re-purposes the *untouched upstream defaults*
before they reach the keyboard hook. If the user rebound a key, their choice wins.
*/
export const patchTransportOverrides: readonly { from: KeyBinding, to: KeyBinding }[] = [
  { from: { keys: 'Space', action: 'togglePlayResetSpeed' }, to: { keys: 'Space', action: 'togglePlayNoResetSpeed' } },
  { from: { keys: 'KeyK', action: 'togglePlayNoResetSpeed' }, to: { keys: 'KeyK', action: 'resetPlaybackRate' } },
  { from: { keys: 'Backspace', action: 'removeCurrentCutpoint' }, to: { keys: 'Backspace', action: 'jumpTimelineStart' } },
  { from: { keys: 'PageUp', action: 'jumpFirstSegment' }, to: { keys: 'PageUp', action: 'jumpSeekPrevSegment' } },
  { from: { keys: 'PageDown', action: 'jumpLastSegment' }, to: { keys: 'PageDown', action: 'jumpSeekNextSegment' } },
  // The arrows mark the cut instead of walking the segments: the segment walk sits on PageUp /
  // PageDown above, so Up / Down are free for the in / out point (`I` / `O` keep their own
  // bindings, so both keys work).
  { from: { keys: 'ArrowUp', action: 'jumpPrevSegment' }, to: { keys: 'ArrowUp', action: 'setCutStart' } },
  { from: { keys: 'ArrowDown', action: 'jumpNextSegment' }, to: { keys: 'ArrowDown', action: 'setCutEnd' } },
  // The preview volume moves off Alt+Up / Down (M / - / = take it, see the additions below), so the
  // same Alt hand that seeks can mark the cut without letting go.
  { from: { keys: 'AltLeft+ArrowUp', action: 'increaseVolume' }, to: { keys: 'AltLeft+ArrowUp', action: 'setCutStart' } },
  { from: { keys: 'AltLeft+ArrowDown', action: 'decreaseVolume' }, to: { keys: 'AltLeft+ArrowDown', action: 'setCutEnd' } },
  // Bare arrows step keyframes, Alt+arrows seek: the two upstream pairs, swapped.
  { from: { keys: 'ArrowLeft', action: 'seekBackwards' }, to: { keys: 'ArrowLeft', action: 'seekBackwardsKeyframe' } },
  { from: { keys: 'AltLeft+ArrowLeft', action: 'seekBackwardsKeyframe' }, to: { keys: 'AltLeft+ArrowLeft', action: 'seekBackwards' } },
  { from: { keys: 'ArrowRight', action: 'seekForwards' }, to: { keys: 'ArrowRight', action: 'seekForwardsKeyframe' } },
  { from: { keys: 'AltLeft+ArrowRight', action: 'seekForwardsKeyframe' }, to: { keys: 'AltLeft+ArrowRight', action: 'seekForwards' } },
  { from: { keys: 'ShiftLeft+ArrowRight', action: 'jumpCutEnd' }, to: { keys: 'ShiftLeft+ArrowRight', action: 'jumpSegmentEndPreview' } },
  { from: { keys: 'Enter', action: 'labelCurrentSegment' }, to: { keys: 'Enter', action: 'toggleFullscreenVideo' } },
  // `Z` toggles between 1x and the last speed the user chose (PotPlayer-style); the plain
  // reset stays on `K` above. The upstream J / L speed keys and the comma / period frame keys
  // keep working: two keys, one action.
  { from: { keys: 'KeyZ', action: 'timelineToggleComfortZoom' }, to: { keys: 'KeyZ', action: 'togglePlaybackRate' } },
  { from: { keys: 'KeyC', action: 'captureSnapshot' }, to: { keys: 'KeyC', action: 'increasePlaybackRate' } },
  // D / F step one frame: D back, F forward (the same direction as the arrows next to them).
  // The snapshot moved to Ctrl+E, and full screen keeps Enter, so neither upstream action
  // is lost.
  { from: { keys: 'KeyD', action: 'cleanupFilesDialog' }, to: { keys: 'KeyD', action: 'seekPreviousFrame' } },
  { from: { keys: 'KeyF', action: 'toggleFullscreenVideo' }, to: { keys: 'KeyF', action: 'seekNextFrame' } },
];

/**
The numeric keypad's `/`: opens the seek dialog, and closes it again while it is open.

Shared so the transport binding and the dialog's own close listener cannot drift apart: a key that
opens a dialog and a listener that watches a different key would leave the dialog unclosable from
the keyboard.
*/
export const patchTimecodeToggleKeys = 'NumpadDivide';

/** Bindings patch mode adds, but only when the key is not used by anything else. */
export const patchTransportAdditions: readonly KeyBinding[] = [
  { keys: 'Delete', action: 'removeCurrentCutpoint' },
  { keys: 'KeyN', action: 'labelCurrentSegment' },
  { keys: 'ControlLeft+KeyD', action: 'duplicateCurrentSegment' },
  // The forced new segment: `Alt+/` arms "the next in point adds a segment" (fork-owned, see
  // features/patchCutMark). Not `Ctrl+0`: the View menu's `resetZoom` role owns that accelerator,
  // so the two would compete for the same key.
  //
  // `Slash` is the physical `/` key, and one binding covers both Alt keys: the matching compares
  // the modifier *set*, not the side, so the right hand reaches it too.
  { keys: 'AltLeft+Slash', action: 'toggleNewSegmentMark' },
  { keys: 'ControlLeft+PageUp', action: 'jumpSeekFirstSegment' },
  { keys: 'ControlLeft+PageDown', action: 'jumpSeekLastSegment' },
  // The macOS variants of Ctrl+PageUp / Ctrl+PageDown (upstream binds both modifiers elsewhere).
  { keys: 'MetaLeft+PageUp', action: 'jumpSeekFirstSegment' },
  { keys: 'MetaLeft+PageDown', action: 'jumpSeekLastSegment' },
  // The finish flow's one key (fork-owned): `Shift+E` continues the `E` family (E exports in the
  // cutting window, E merges in the results window), so the whole workflow runs on one letter.
  //
  // Product design: a different operation has to *look* like a different operation. `E` is
  // deliberately not the finish key in the merged-result window either - it would mean "export" in
  // the cutting window, "merge" in the cut-results window and "finish" in the merged window, so the
  // same key would hide which stage the user is in. The job key is always its own key.
  //
  // Not Ctrl+M: on macOS Cmd+M is the system "Minimize" menu item.
  { keys: 'ShiftLeft+KeyE', action: 'finish' },
  // Discard the video: the source moves to the waiting-for-deletion folder together with its
  // results (deleted or moved aside, as chosen). `Ctrl+Delete` continues the `Delete` family:
  // `Delete` drops the current cut point, `Ctrl+Delete` drops the video from the session by setting
  // it aside. (`Shift+D` used to hold this key; it is free again.)
  { keys: 'ControlLeft+Delete', action: 'discardSource' },
  // Finish and keep: the same finish dialog as `Shift+E`, but it opens with the source going to
  // `finished_skip_src` instead of the waiting-for-deletion folder. So the two keys split the end
  // of a job the way `Delete` / `Ctrl+Delete` split the files: put the result away, or keep it.
  //
  // `F` (with Shift) continues the "finish" letter the cutting window already owns; plain `F`
  // steps one frame forward, so the letter had no other claim on it. (`Shift+G` held this key
  // before; a v6 config migration renames it, or keeps it when the user bound `Shift+F` already.)
  { keys: 'ShiftLeft+KeyF', action: 'finishKeepSource' },
  // The numeric keypad opens the seek dialog too, so a numpad-only setup can seek (`+` starts a
  // relative seek, which needs this dialog for its value). Every binding of this action also closes
  // the dialog again while it is open (see `features/timecodeInput/promptPatchTimecode`), so the
  // key toggles from the keyboard.
  //
  // `NumpadDivide`, not `Slash`: the main keyboard `/` is taken by `Shift+/` (shortcut list) and
  // `Alt+/` (the new-segment key above).
  { keys: patchTimecodeToggleKeys, action: 'goToTimecode' },
  // Walk the batch in one press: open the previous / next source and start playing it. Three steps
  // of the same idea, three keys: `Shift+Up` / `Shift+Down` only move the highlight, `Ctrl+Shift+Up`
  // / `Ctrl+Shift+Down` open without playing, and these open and play.
  { keys: 'ShiftLeft+PageUp', action: 'batchOpenPlayPreviousFile' },
  { keys: 'ShiftLeft+PageDown', action: 'batchOpenPlayNextFile' },
  // The snapshot: `C` is the speed key now, so a frame is captured with Ctrl+E. `E` alone keeps
  // exporting; Ctrl+E is a different combination, so the two do not collide.
  { keys: 'ControlLeft+KeyE', action: 'captureSnapshot' },
  // Slow down next to Z / C: the three speed keys read X, Z, C from left to right.
  { keys: 'KeyX', action: 'reducePlaybackRate' },
  // The preview volume: M stays the mute default in the base table; these two unshifted keys step
  // it. `Equal` is the physical `=` key - `Shift+Equal` (`+`) is still "add segment", so the volume
  // does not take the cut key away, and Ctrl+= (zoom) is a different combination.
  { keys: 'Minus', action: 'decreaseVolume' },
  { keys: 'Equal', action: 'increaseVolume' },
  // Patch mode hides the app menu bar, so a bare Alt can no longer take the focus away from the
  // cutting keys. `Alt+Q` shows or hides the bar when a menu entry is needed.
  { keys: 'AltLeft+KeyQ', action: 'togglePatchMenuBar' },
  // Comfort zoom keeps a key in patch mode: `Z` itself became the speed toggle, and its upstream
  // modifier neighbour `Shift+Z` is already "make cursor time zero". `Alt+Z` stays on the same key,
  // needs one hand and shadows nothing, so no other action loses a key to it.
  { keys: 'AltLeft+KeyZ', action: 'timelineToggleComfortZoom' },
];

/**
Which window the bindings are for.

The player window is the cut-results viewer: the same walk is there, but PageUp / PageDown and
the bare arrows move through the result playlist instead of the cut segments, and N renames the
result instead of labelling a segment.

`merged` is the merged-result window: the same viewer keys, but no merge key (it only plays one
file, there is nothing to merge there).
*/
export type PatchTransportContext = 'editor' | 'player' | 'merged';

/** Applied after the editor overrides: they match what the editor remap produced. */
export const patchPlayerTransportOverrides: readonly { from: KeyBinding, to: KeyBinding }[] = [
  { from: { keys: 'PageUp', action: 'jumpSeekPrevSegment' }, to: { keys: 'PageUp', action: 'playlistPrev' } },
  { from: { keys: 'PageDown', action: 'jumpSeekNextSegment' }, to: { keys: 'PageDown', action: 'playlistNext' } },
  { from: { keys: 'ControlLeft+PageUp', action: 'jumpSeekFirstSegment' }, to: { keys: 'ControlLeft+PageUp', action: 'playlistFirst' } },
  { from: { keys: 'ControlLeft+PageDown', action: 'jumpSeekLastSegment' }, to: { keys: 'ControlLeft+PageDown', action: 'playlistLast' } },
  { from: { keys: 'MetaLeft+PageUp', action: 'jumpSeekFirstSegment' }, to: { keys: 'MetaLeft+PageUp', action: 'playlistFirst' } },
  { from: { keys: 'MetaLeft+PageDown', action: 'jumpSeekLastSegment' }, to: { keys: 'MetaLeft+PageDown', action: 'playlistLast' } },
  // The upstream editor defaults: the viewer walks the result playlist instead.
  { from: { keys: 'ShiftLeft+AltLeft+PageUp', action: 'jumpSeekFirstSegment' }, to: { keys: 'ShiftLeft+AltLeft+PageUp', action: 'playlistFirst' } },
  { from: { keys: 'ShiftLeft+AltLeft+PageDown', action: 'jumpSeekLastSegment' }, to: { keys: 'ShiftLeft+AltLeft+PageDown', action: 'playlistLast' } },
  // The bare arrows walk the results too, so the segment card is not opened by keys that cannot
  // move the playhead in the viewer (there are no cut segments there). The editor remap already
  // moved Up / Down onto the cut marking, which the viewer disables: they walk the playlist instead.
  { from: { keys: 'ArrowUp', action: 'setCutStart' }, to: { keys: 'ArrowUp', action: 'playlistPrev' } },
  { from: { keys: 'ArrowDown', action: 'setCutEnd' }, to: { keys: 'ArrowDown', action: 'playlistNext' } },
  { from: { keys: 'ShiftLeft+AltLeft+ArrowUp', action: 'jumpSeekPrevSegment' }, to: { keys: 'ShiftLeft+AltLeft+ArrowUp', action: 'playlistPrev' } },
  { from: { keys: 'ShiftLeft+AltLeft+ArrowDown', action: 'jumpSeekNextSegment' }, to: { keys: 'ShiftLeft+AltLeft+ArrowDown', action: 'playlistNext' } },
  { from: { keys: 'KeyN', action: 'labelCurrentSegment' }, to: { keys: 'KeyN', action: 'renameResultLabel' } },
];

/**
The merged-result window keeps the *editor* segment walk (fork-owned).

Its timeline is a fixed list of read-only chapters - one per clip - so PageUp / PageDown and the
arrows move through those chapters exactly like the cutting window walks its segments. Only the
playlist remap is left out, plus `N` renames the merged file (its chapters have no source label
to rename).
*/
export const patchMergedTransportOverrides: readonly { from: KeyBinding, to: KeyBinding }[] = [
  // The merged window cannot mark cut points, so the arrows keep walking its chapters (the editor
  // remap moved them onto the cut marking; undo that here).
  { from: { keys: 'ArrowUp', action: 'setCutStart' }, to: { keys: 'ArrowUp', action: 'jumpPrevSegment' } },
  { from: { keys: 'ArrowDown', action: 'setCutEnd' }, to: { keys: 'ArrowDown', action: 'jumpNextSegment' } },
  { from: { keys: 'KeyN', action: 'labelCurrentSegment' }, to: { keys: 'KeyN', action: 'renameResultLabel' } },
];

/**
Editor bindings the viewer drops instead of re-purposing.

`Ctrl+D` duplicates a segment, which the viewer has no use for.

`Shift+Right` is *not* dropped: the viewer plays one clip (a cut result), so the key previews the
tail of that clip there (see `segmentEndPreview.ts`). Only the exact editor binding is removed, so
a user who rebound the key keeps their own binding.

The cut-marking alternatives go as well: the viewer disables `setCutStart` / `setCutEnd` (see
playerMode), so `Alt+Up` / `Down` would be dead keys there. The latter go back to the preview
volume in the viewer (see the additions below).

`Alt+Q` goes too: the application menu's items act on the cutting window, so opening it from a
viewer would operate on another window.
*/
export const patchPlayerRemovedBindings: readonly KeyBinding[] = [
  { keys: 'ControlLeft+KeyD', action: 'duplicateCurrentSegment' },
  // The viewer disables `removeCurrentCutpoint` (see playerMode): do not advertise a dead key.
  { keys: 'Delete', action: 'removeCurrentCutpoint' },
  { keys: 'AltLeft+ArrowUp', action: 'setCutStart' },
  { keys: 'AltLeft+ArrowDown', action: 'setCutEnd' },
  { keys: 'AltLeft+KeyQ', action: 'togglePatchMenuBar' },
  // The viewer cannot mark, so arming the next in point would do nothing there.
  { keys: 'AltLeft+Slash', action: 'toggleNewSegmentMark' },
  // The viewer plays results; discarding or archiving a source is a cutting-window job.
  { keys: 'ControlLeft+Delete', action: 'discardSource' },
  { keys: 'ShiftLeft+KeyF', action: 'finishKeepSource' },
  // The results windows show the cut-results playlist instead of the upstream source list, so there
  // is no source to switch to: PageUp / PageDown already walk the results there.
  { keys: 'ShiftLeft+PageUp', action: 'batchOpenPlayPreviousFile' },
  { keys: 'ShiftLeft+PageDown', action: 'batchOpenPlayNextFile' },
];

/** Player-only bindings (free keys), added after the player overrides. */
export const patchPlayerTransportAdditions: readonly KeyBinding[] = [
  { keys: 'ShiftLeft+KeyN', action: 'renameResultFull' },
  // The viewer cannot mark, so its Alt+arrows go back to the preview volume (the base behaviour the
  // editor override shadows). The unshifted `-` / `=` stay bound in every window.
  { keys: 'AltLeft+ArrowUp', action: 'increaseVolume' },
  { keys: 'AltLeft+ArrowDown', action: 'decreaseVolume' },
];

/**
Merged-result-only bindings (free keys), added after the merged overrides (fork-owned).

The merged window shows a real segment list (its read-only chapters), so it also gets the two
selection keys the cutting window has no default for: toggle the current chapter's selection and
select only it. They never modify a chapter.
*/
export const patchMergedTransportAdditions: readonly KeyBinding[] = [
  { keys: 'KeyS', action: 'toggleCurrentSegmentSelected' },
  { keys: 'ShiftLeft+KeyS', action: 'selectOnlyCurrentSegment' },
];

/**
The cut-results window's merge key: `E` merges all cut results of the source into one file.

Only the player context gets it: the cutting window keeps `E` for exporting, and the merged-result
window is a viewer without a merge key.

There is deliberately no option dialog here. Everything that decides the result — the join repair,
the cut ends (A/B/C), the format, the track selection — was chosen at the cut step, when `E` in the
cutting window opened the export options, and it is already baked into the clips on disk. Merging
is only the concatenation, so asking again would suggest a choice that cannot be applied without
re-cutting every clip.
*/
export const patchPlayerMergeBinding: { from: KeyBinding, to: KeyBinding } = {
  from: { keys: 'KeyE', action: 'export' },
  to: { keys: 'KeyE', action: 'mergeCutResults' },
};

/**
The key combination of a binding, without the side of the modifiers.

The keyboard hook matches a binding by the key that was pressed and by the modifiers that were
held, so `ShiftRight+ArrowRight` is the same combination as `ShiftLeft+ArrowRight`. The remap
must compare the combinations the same way: a user who bound a key with the other hand gets the
same patch-mode behaviour (otherwise the right hand would keep the upstream behaviour, and the
results windows would keep a key that opens a segment card they cannot use).
*/
export function keyCombination(keys: string) {
  return keys.split('+').map((part) => {
    if (part === 'ShiftRight') return 'ShiftLeft';
    if (part === 'ControlRight') return 'ControlLeft';
    if (part === 'AltRight') return 'AltLeft';
    if (part === 'MetaRight') return 'MetaLeft';
    return part;
  }).sort().join('+');
}

function applyOverrides(bindings: readonly KeyBinding[], overrides: readonly { from: KeyBinding, to: KeyBinding }[]) {
  return bindings.map((binding) => {
    const override = overrides.find((candidate) => (
      keyCombination(candidate.from.keys) === keyCombination(binding.keys) && candidate.from.action === binding.action
    ));
    // Only the action changes: the user's own spelling of the key is kept.
    return override != null ? { keys: binding.keys, action: override.to.action } : binding;
  });
}

/**
The cutting window's bindings: the upstream defaults are re-purposed and the patch-only keys are
appended when their key is free.

This is the legacy path, kept for the raw-stored-list callers and the remap tests. The live path is
`resolveKeyBindings` in `features/patchKeys`, which works from the explicit scope table; the two are
held together by a consistency test.
*/
export function remapPatchEditorBindings(bindings: readonly KeyBinding[]): KeyBinding[] {
  const editorRemapped = applyOverrides(bindings, patchTransportOverrides);
  const editorUsedKeys = new Set(editorRemapped.map((binding) => keyCombination(binding.keys)));
  return [...editorRemapped, ...patchTransportAdditions.filter((binding) => !editorUsedKeys.has(keyCombination(binding.keys)))];
}

/**
Only the results-window differences, applied to an already editor-resolved list.

The cutting window keeps its list untouched. The viewer re-purposes the walk keys, drops what it
cannot do (marking, discarding) and adds its own keys when free.
*/
export function applyWindowBindings(bindings: readonly KeyBinding[], context: PatchTransportContext): KeyBinding[] {
  if (context === 'editor') return [...bindings];

  const playerOverrides = context === 'player'
    ? [...patchPlayerTransportOverrides, patchPlayerMergeBinding]
    : patchMergedTransportOverrides;
  const playerRemapped = applyOverrides(bindings, playerOverrides);
  const playerFiltered = playerRemapped.filter((binding) => patchPlayerRemovedBindings.every(
    (removed) => !(keyCombination(removed.keys) === keyCombination(binding.keys) && removed.action === binding.action),
  ));

  const playerUsedKeys = new Set(playerFiltered.map((binding) => keyCombination(binding.keys)));
  // The merged window additionally gets the two selection keys (free keys only).
  return [
    ...playerFiltered,
    ...patchPlayerTransportAdditions.filter((binding) => !playerUsedKeys.has(keyCombination(binding.keys))),
    ...(context === 'merged'
      ? patchMergedTransportAdditions.filter((binding) => !playerUsedKeys.has(keyCombination(binding.keys)))
      : []),
  ];
}

/**
The bindings as patch mode runs them from a raw stored list.

Known defaults are replaced, and the extra bindings are appended only when their key is free, so
patch mode never steals a key the user chose for something else. The player window applies the
editor remap first, then its own overrides, then drops the segment-only bindings.
*/
export function remapPatchTransportBindings(keyBindings: readonly KeyBinding[], context: PatchTransportContext = 'editor'): KeyBinding[] {
  return applyWindowBindings(remapPatchEditorBindings(keyBindings), context);
}
