/**
Default patch-mode layout, expressed as fractions of the window.

The viewer column is deliberately dominant (75%): like the monitor area of a video editor (Adobe
Premiere's "Editing" workspace keeps the viewer grouping in the middle and the bins / inspectors in
narrow columns either side). The right (segment list) column is given slightly more room than the
left (file list) one, because a segment row shows an index plus two full timecodes.

Vertically the left column is almost all file list (the work-dir header is just a path + buttons),
the viewer keeps the vast majority of its column (the console is a one-line log, not a timeline),
and the right column favours the segment list over the merge preview.

Fractions are converted to pixels for the actual window size (`computePatchLayoutSizes`), so the
same proportions apply on any screen.
*/

export interface PatchLayoutFractions {
  /** Column widths, left to right (1 = work dir/list/guide, 2 = player/console, 3 = segments/merge). */
  columns: readonly number[];
  /** Row heights per column, top to bottom. */
  rows: readonly (readonly number[])[];
}

export const defaultPatchLayoutFractions: PatchLayoutFractions = {
  columns: [0.1, 0.75, 0.15],
  rows: [
    // workDir / videoList / keyGuide
    [0.15, 0.55, 0.3],
    // player / console
    [0.84, 0.16],
    // segments / mergePreview
    [0.6, 0.4],
  ],
};

/**
Keep the side columns usable on small windows. Below ~2000px of window width the 10% column
would fall under this, in which case the side columns are widened and the viewer column absorbs
the difference (so the proportions only hold exactly on wider windows).
*/
export const patchMinColumnWidth = 200;
/** Keep a single row (e.g. the console) usable on small windows. */
export const patchMinRowHeight = 110;

/**
Split `total` pixels according to `fractions`, never below `min`, and make the result add up to
`total` exactly (the rounding remainder goes to the largest slice) so dockview does not have to
guess the leftover.
*/
export function distributeSpace(total: number, fractions: readonly number[], min: number): number[] {
  const raw = fractions.map((fraction) => Math.max(min, Math.round(fraction * total)));

  let largestIndex = 0;
  for (let index = 1; index < raw.length; index += 1) {
    if ((raw[index] ?? 0) > (raw[largestIndex] ?? 0)) largestIndex = index;
  }

  const sum = raw.reduce((acc, size) => acc + size, 0);
  const remainder = total - sum;

  return raw.map((size, index) => (index === largestIndex ? Math.max(min, size + remainder) : size));
}

export interface PatchLayoutSizes {
  /** Width of each column in pixels. */
  columns: number[];
  /** Height of each row within each column, in pixels. */
  rows: number[][];
}

/** Convert the fractional layout into exact pixel sizes for a window of `width` x `height`. */
export function computePatchLayoutSizes(
  width: number,
  height: number,
  fractions: PatchLayoutFractions = defaultPatchLayoutFractions,
): PatchLayoutSizes {
  return {
    columns: distributeSpace(width, fractions.columns, patchMinColumnWidth),
    rows: fractions.rows.map((rowFractions) => distributeSpace(height, rowFractions, patchMinRowHeight)),
  };
}

/**
Translate row heights into the `initialHeight` values dockview needs.

dockview gives a newly added row its `initialHeight` and shrinks the *reference* row. Adding rows
top-to-bottom therefore means the row that will still get rows below it must reserve their space:
the k-th added row is given the sum of its own height and every following row's height.

Example (heights 120 / 600 / 280): the first added row reserves 880, the second 280, leaving 120
for the first row of the column.
*/
export function toDockviewInitialHeights(rowHeights: readonly number[]): number[] {
  return rowHeights.slice(1).map((_, index) => {
    const from = index + 1;
    return rowHeights.slice(from).reduce((acc, size) => acc + size, 0);
  });
}

/** Panel ids of the default layout, in creation order. */
export type PatchLayoutPanelId = | 'player' | 'workDir' | 'segments' | 'videoList' | 'keyGuide' | 'console' | 'mergePreview';

export interface PatchLayoutPanelSpec {
  id: PatchLayoutPanelId;
  /** Omitted for the very first panel: it fills the window and dockview ignores its size. */
  position?: { referencePanel: PatchLayoutPanelId, direction: 'left' | 'right' | 'above' | 'below' } | undefined;
  initialWidth?: number | undefined;
  initialHeight?: number | undefined;
}

/**
Ordered plan for the default layout — pure so the dockview ordering rules can be tested.

dockview only honours `initialWidth` / `initialHeight` when a panel is added *relative to another*
one (with a `position`); the very first panel always fills the container and, when a later panel
is added to it without an explicit size, dockview distributes the space evenly. The layout is
therefore built as: the viewer column first (it absorbs the leftover width), then the two narrow
side columns with explicit widths, then the rows inside each column.

A new row also takes its `initialHeight` *from the reference row*, hence
`toDockviewInitialHeights` (a row that will still get rows below it must reserve their space).
*/
export function planDefaultLayout(
  width: number,
  height: number,
  fractions: PatchLayoutFractions = defaultPatchLayoutFractions,
): PatchLayoutPanelSpec[] {
  const sizes = computePatchLayoutSizes(width, height, fractions);
  const [leftWidth, , rightWidth] = sizes.columns;
  const [col1First, col1Second] = toDockviewInitialHeights(sizes.rows[0] ?? []);
  const [col2First] = toDockviewInitialHeights(sizes.rows[1] ?? []);
  const [col3First] = toDockviewInitialHeights(sizes.rows[2] ?? []);

  return [
    // Step 1: columns. The viewer comes first so that it ends up with the remaining width.
    { id: 'player' },
    { id: 'workDir', position: { referencePanel: 'player', direction: 'left' }, initialWidth: leftWidth },
    { id: 'segments', position: { referencePanel: 'player', direction: 'right' }, initialWidth: rightWidth },
    // Step 2: rows inside each column.
    { id: 'videoList', position: { referencePanel: 'workDir', direction: 'below' }, initialHeight: col1First },
    { id: 'keyGuide', position: { referencePanel: 'videoList', direction: 'below' }, initialHeight: col1Second },
    { id: 'console', position: { referencePanel: 'player', direction: 'below' }, initialHeight: col2First },
    { id: 'mergePreview', position: { referencePanel: 'segments', direction: 'below' }, initialHeight: col3First },
  ];
}
