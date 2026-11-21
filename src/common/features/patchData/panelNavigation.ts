/**
Spatial panel navigation (pure, so it can be tested).

Alt+Arrow moves the keyboard focus to the visually adjacent panel: left/right cross the
columns, up/down walk within a column. At the edges there is no neighbour (a no-op).

The map mirrors the default three-column layout:

```
workDir  | player  | segments
videoList|         | mergePreview
keyGuide | console |
```
*/

import type { PatchLayoutPanelId } from './layout.js';

export type PatchPanelDirection = 'up' | 'down' | 'left' | 'right';

const panelNeighbors: Record<PatchLayoutPanelId, Partial<Record<PatchPanelDirection, PatchLayoutPanelId>>> = {
  player: { down: 'console', left: 'videoList', right: 'segments' },
  workDir: { down: 'videoList', right: 'player' },
  segments: { down: 'mergePreview', left: 'player' },
  videoList: { up: 'workDir', down: 'keyGuide', right: 'player' },
  // The bottom band (keyGuide / console / mergePreview) navigates horizontally.
  keyGuide: { up: 'videoList', right: 'console' },
  console: { up: 'player', left: 'keyGuide', right: 'mergePreview' },
  mergePreview: { up: 'segments', left: 'console' },
};

/** The panel adjacent to `current` in `direction`, or `undefined` at the edges. */
export function getAdjacentPanel(current: PatchLayoutPanelId, direction: PatchPanelDirection): PatchLayoutPanelId | undefined {
  return panelNeighbors[current]?.[direction];
}
