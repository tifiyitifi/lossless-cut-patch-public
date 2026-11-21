import type { WheelEventHandler } from 'react';
import { useCallback } from 'react';

import normalizeWheel from '../../hooks/normalizeWheel';

import { planPatchWheelVolume } from './wheelVolume';

/**
The video area's wheel handler in patch mode (fork-owned).

A bare wheel steps the preview volume; every other wheel (a modifier is held, or a trackpad pinch,
which Chromium sends as ctrl+wheel) is handed to the base timeline-wheel handler, so zoom and seek
keep working. When `enabled` is false the base handler is returned unchanged, which keeps base mode
byte-identical.
*/
export default function usePatchWheelVolume({
  enabled,
  baseWheel,
  onVolumeStep,
}: {
  enabled: boolean;
  baseWheel: WheelEventHandler;
  onVolumeStep: (delta: number) => void;
}): WheelEventHandler {
  const patchWheel = useCallback<WheelEventHandler>((wheelEvent) => {
    const { pixelY } = normalizeWheel(wheelEvent);
    const delta = planPatchWheelVolume({ modifiers: wheelEvent, deltaY: pixelY });
    if (delta == null) {
      baseWheel(wheelEvent);
      return;
    }
    onVolumeStep(delta);
  }, [baseWheel, onVolumeStep]);

  return enabled ? patchWheel : baseWheel;
}
