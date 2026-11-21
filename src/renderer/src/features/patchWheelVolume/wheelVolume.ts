export interface WheelModifiers {
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/**
The preview-volume step a bare wheel over the video makes in patch mode (fork-owned, pure).

Patch mode puts the preview volume on the wheel while the modifier wheels keep their base
behavior (Ctrl zoom, Alt frame seek, Shift keyframe seek). So only a wheel with no modifier at all
becomes a volume step; every other wheel returns `undefined` and the caller hands it back to the
timeline wheel handler.
*/
export function planPatchWheelVolume({
  modifiers,
  deltaY,
  step = 0.07,
}: {
  modifiers: WheelModifiers;
  /** Normalized vertical wheel delta: negative is a wheel-up (see `normalizeWheel`). */
  deltaY: number;
  step?: number;
}): number | undefined {
  const { ctrlKey, shiftKey, altKey, metaKey } = modifiers;
  // Chromium sends a trackpad pinch as ctrl+wheel, so the modifier check covers that too.
  if (ctrlKey || shiftKey || altKey || metaKey) return undefined;
  // A horizontal-only gesture has no vertical delta: leave it to the base handler.
  if (deltaY === 0) return undefined;
  // Wheel up (negative delta) turns the volume up, like the increase-volume key.
  return deltaY < 0 ? step : -step;
}
