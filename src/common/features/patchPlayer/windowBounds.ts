/**
Where the player window opens (pure).

The player reviews the cut results of the cutting window, so it opens at that window's size. It
is cascaded a little so the cutting window stays reachable, and everything is clamped to the
display work area: a maximized or partly off-screen cutting window cannot push the player
off-screen.
*/

export interface PatchWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How far the player window is offset from the cutting window (px). */
export const patchPlayerCascadeOffset = 40;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

/**
The bounds for the player window: the cutting window's size, cascaded and clamped to the display
work area, never smaller than the player window's minimum size.
*/
export function getPlayerWindowBounds({ mainBounds, workArea, minWidth = 320, minHeight = 240 }: {
  /** The cutting window's current bounds (the maximized bounds when it is maximized). */
  mainBounds: PatchWindowBounds;
  /** The work area of the display the cutting window is on. */
  workArea: PatchWindowBounds;
  minWidth?: number;
  minHeight?: number;
}): PatchWindowBounds {
  const width = Math.max(minWidth, Math.min(mainBounds.width, workArea.width));
  const height = Math.max(minHeight, Math.min(mainBounds.height, workArea.height));

  return {
    width,
    height,
    x: clamp(mainBounds.x + patchPlayerCascadeOffset, workArea.x, workArea.x + workArea.width - width),
    y: clamp(mainBounds.y + patchPlayerCascadeOffset, workArea.y, workArea.y + workArea.height - height),
  };
}
