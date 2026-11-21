import type { PatchDetachOrigin } from '../patchPlayer/playlistOrigin.js';
import type { PatchOverviewResultFolder, PatchOverviewResultRef } from '../patchResultsOverview/groupResults.js';

import type { PatchDetachableSourceReason } from './deletable.js';
import type { PatchDetachableReport, PatchDetachableSourceRow } from './rows.js';

/**
The video cards of the deletion check (fork-owned, pure).

The panel is a grid of one row per source: the source itself and every result it produced. That
structure is what the selection needs too, so it is built here instead of inside the component:

- `buildPatchDetachGrid` turns the report into rows of items (source first, then clips, merged and
  parked results, in that order);
- `flattenPatchDetachGrid` is the visual order of all items, which is the order a Shift+click range
  follows;
- the view presets and the group layout live here as well, so the panel and the settings agree on the
  four densities, on how many source groups a row holds and on how wide a group's source column may
  become.

A "group" is one source and its results. A row holds `g` equal groups (`repeat(g, 1fr)`, so with two
groups the second one starts exactly at half the page) with a wide gap between them. Inside a group
the source column and the results column are separated by a wide gutter that carries a rule, and the
user can drag that boundary freely: the source column never gets narrower than one card and otherwise
follows the pointer, while the source card itself keeps the view's card width - so a wider source
column is breathing room, not a bigger card. The group count is a saved maximum clamped to what the
window can show, so a narrow window shows fewer groups without forgetting the setting.

A result the ledger records but the disk does not have is not an item: it is not a file, so it can be
neither selected nor played. The row keeps those paths apart (`missing`) for the dashed strips.
*/

export type PatchDetachGridItemKind = 'source' | 'result';

export interface PatchDetachGridItem {
  /** `source:<path>` / `result:<path>` - unique even when a source and a result share a path. */
  key: string;
  path: string;
  kind: PatchDetachGridItemKind;
  /** The folder the file sits in; the check player shows it as a badge. */
  origin: PatchDetachOrigin;
  /** The source this item belongs to (the source itself for a source item). */
  sourcePath: string;
  /** Only a detached source with a kept result on disk; used for deletion, nothing else. */
  deletable: boolean;
  /**
  A source that is deletable only because the user allowed its reason in the deletion settings
  (not because a kept result proves the app finished it). "Delete all" leaves these out unless the
  user also allowed that.
  */
  extraDeletable?: boolean | undefined;
  /** Missing rows never become items; this stays in the type so `selection.ts` can filter generally. */
  selectable: boolean;
  /** Result items: which folder (the type line of the card). */
  resultFolder?: PatchOverviewResultFolder | undefined;
  /** Source items: why it may (not) be deleted (the state line of the card). */
  reason?: PatchDetachableSourceReason | undefined;
  /** Result items: the result itself. */
  result?: PatchOverviewResultRef | undefined;
}

export interface PatchDetachGridRow {
  source: PatchDetachableSourceRow;
  /** The source first, then its clips, merged and parked results. */
  items: PatchDetachGridItem[];
  /** Results the ledger knows but that are not on disk; dashed strips, not cards. */
  missing: string[];
}

function sourceItem(row: PatchDetachableSourceRow): PatchDetachGridItem {
  return {
    key: `source:${row.path}`,
    path: row.path,
    kind: 'source',
    origin: 'detachedSrc',
    sourcePath: row.path,
    deletable: row.deletable,
    extraDeletable: row.deletable && row.reason !== 'deletable',
    selectable: true,
    reason: row.reason,
  };
}

function resultItem(sourcePath: string, result: PatchOverviewResultRef): PatchDetachGridItem {
  return {
    key: `result:${result.path}`,
    path: result.path,
    kind: 'result',
    origin: result.folder,
    sourcePath,
    deletable: false,
    selectable: true,
    resultFolder: result.folder,
    result,
  };
}

/** The rows of the grid, in the report's order. */
export function buildPatchDetachGrid(report: PatchDetachableReport | undefined): PatchDetachGridRow[] {
  return (report?.rows ?? []).map((row) => ({
    source: row,
    items: [
      sourceItem(row),
      ...[...row.clips, ...row.merged, ...row.parked].map((result) => resultItem(row.path, result)),
    ],
    missing: [...row.missing],
  }));
}

/** Every item in visual order: row by row, the source before its results. */
export function flattenPatchDetachGrid(rows: readonly PatchDetachGridRow[]): PatchDetachGridItem[] {
  return rows.flatMap((row) => row.items);
}

// ---------------------------------------------------------------------------------------------
// View density

export type PatchDetachGridView = 'list' | 'compact' | 'standard' | 'large';

/** The presets of the toolbar, in display order. */
export const patchDetachGridViews = ['list', 'compact', 'standard', 'large'] as const satisfies readonly PatchDetachGridView[];

export const patchDetachGridDefaultView: PatchDetachGridView = 'standard';

/** Card widths of the tile presets; the list preset lays the cards out horizontally instead. */
export const patchDetachTileWidths: Record<Exclude<PatchDetachGridView, 'list'>, number> = {
  compact: 140,
  standard: 200,
  large: 300,
};

// ---------------------------------------------------------------------------------------------
// Group layout

/** The gap between two result cards (and between the cards of the list preset), in pixels. */
export const patchDetachCardGap = 8;

/** The space between a group's source card and the rule that splits its two columns, in pixels. */
export const patchDetachColumnRuleGap = 11;

/** The width of that rule, in pixels. */
export const patchDetachColumnRuleWidth = 2;

/** The space between the rule and the first result card, in pixels. */
export const patchDetachResultsInset = 11;

/**
The whole gap between a group's source card and its results, in pixels.

Wider than the gap between two result cards, so a group reads as two columns and not as one strip of
cards next to another. The rule sits in the middle of it, with the same breathing room on either side.
*/
export const patchDetachGroupInnerGap = patchDetachColumnRuleGap + patchDetachColumnRuleWidth + patchDetachResultsInset;

/** The gap between two group panels of one row; deliberately much wider than the inner gap. */
export const patchDetachGroupGap = 36;

/** The padding inside a group panel, in pixels. */
export const patchDetachGroupPadding = 8;

/** The horizontal padding of the header and of each row, on one side, in pixels. */
export const patchDetachGridPaddingX = 12;

/** Source groups per row: 2 (the page split in half) unless the user picks another count. */
export const patchDetachGroupsPerRowDefault = 2;
export const patchDetachGroupsPerRowMin = 1;
export const patchDetachGroupsPerRowMax = 6;

/** The counts the toolbar offers. */
export const patchDetachGroupOptions: readonly number[] = Array.from(
  { length: patchDetachGroupsPerRowMax - patchDetachGroupsPerRowMin + 1 },
  (_, index) => patchDetachGroupsPerRowMin + index,
);

/** A stored view value, or the default when the config holds anything else. */
export function parsePatchDetachGridView(value: unknown): PatchDetachGridView {
  return typeof value === 'string' && (patchDetachGridViews as readonly string[]).includes(value)
    ? value as PatchDetachGridView
    : patchDetachGridDefaultView;
}

/** A stored group count, or the default. A hand-edited config is clamped, never rejected. */
export function parsePatchDetachGroupsPerRow(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return patchDetachGroupsPerRowDefault;
  return Math.min(patchDetachGroupsPerRowMax, Math.max(patchDetachGroupsPerRowMin, Math.round(value)));
}

/**
The stored source column widths, one per group position, in pixels.

`0` means "not set": that group uses one card, the narrowest a source column may get. The values are
clamped to what the window can show when the layout is computed, so the parser only rejects values
that are not positive numbers.
*/
export function parsePatchDetachSourceColumnWidths(value: unknown, groups: unknown): number[] {
  const count = parsePatchDetachGroupsPerRow(groups);
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: count }, (_, index) => {
    const width = source[index];
    return typeof width === 'number' && Number.isFinite(width) && width > 0 ? Math.round(width) : 0;
  });
}

/** The narrowest a group panel may become: one source card, one result card, its padding and border. */
export function getPatchDetachGroupMinWidth(tileWidth: number): number {
  const tile = Math.max(1, tileWidth);
  return tile + patchDetachGroupInnerGap + tile + 2 * patchDetachGroupPadding + 2;
}

/** Where the rule between a group's two columns and its drag handle sit, in pixels. */
export interface PatchDetachColumnRule {
  /** The left edge of the rule, measured from the group's inner grid. */
  left: number;
  width: number;
  /** The invisible hit area, centered on the rule (a 2 px line alone is hard to grab). */
  handleLeft: number;
  handleWidth: number;
}

/**
The column rule of one group.

The rule is the only thing that tells the source column and the results column apart, and dragging it
is how a group's source column is resized, so both the line and its hit area are computed here instead
of in the panel: the handle is centered on the line, so grabbing what you see is enough.
*/
export function getPatchDetachColumnRule(sourceWidth: number): PatchDetachColumnRule {
  const handleWidth = 8;
  const left = Math.max(0, sourceWidth) + patchDetachColumnRuleGap;
  return {
    left,
    width: patchDetachColumnRuleWidth,
    handleLeft: left + patchDetachColumnRuleWidth / 2 - handleWidth / 2,
    handleWidth,
  };
}

export interface PatchDetachGroupLayout {
  /** How many groups the row shows right now (never more than the saved count). */
  groups: number;
  /** The equal track width of one group, in pixels (gap between the groups not included). */
  groupWidth: number;
  /** The source column width of each shown group, in pixels. */
  sourceWidths: number[];
  /** The narrowest a source column may get: one card. */
  minSourceWidth: number;
  /** The widest a source column may become here and still leave one result card. */
  maxSourceWidth: number;
}

/**
What a row actually shows in the current window.

The saved group count is a maximum: the row shows as many equal groups as fit next to each other,
and each group's saved source column is clamped so that it is at least one card wide and leaves at
least one result card. The saved settings are not touched - a wider window shows them again.
`availableWidth` is the content width inside the row padding; `tileWidth` is the current view's card
width.
*/
export function computePatchDetachGroupLayout({ availableWidth, tileWidth, savedGroups, savedSourceWidths }: {
  availableWidth: number;
  tileWidth: number;
  savedGroups: unknown;
  savedSourceWidths: unknown;
}): PatchDetachGroupLayout {
  const tile = Math.max(1, tileWidth);
  const saved = parsePatchDetachGroupsPerRow(savedGroups);
  const savedWidths = parsePatchDetachSourceColumnWidths(savedSourceWidths, saved);
  const width = Math.max(0, availableWidth);
  const minGroupWidth = getPatchDetachGroupMinWidth(tile);
  const fits = Math.floor((width + patchDetachGroupGap) / (minGroupWidth + patchDetachGroupGap));
  const groups = Math.max(1, Math.min(saved, fits));
  const groupWidth = Math.max(0, (width - (groups - 1) * patchDetachGroupGap) / groups);
  // Inside the panel: the source column, the inner gap and at least one result card.
  const innerWidth = Math.max(0, groupWidth - 2 * (patchDetachGroupPadding + 1));
  const minSourceWidth = tile;
  const maxSourceWidth = Math.max(minSourceWidth, innerWidth - patchDetachGroupInnerGap - tile);
  return {
    groups,
    groupWidth,
    sourceWidths: Array.from({ length: groups }, (_, index) => {
      const stored = savedWidths[index] ?? 0;
      return Math.min(maxSourceWidth, Math.max(minSourceWidth, stored > 0 ? stored : minSourceWidth));
    }),
    minSourceWidth,
    maxSourceWidth,
  };
}

/** The card width of a view; `undefined` for the list preset, whose cards fill their line. */
export function getPatchDetachTileWidth(view: PatchDetachGridView): number | undefined {
  return view === 'list' ? undefined : patchDetachTileWidths[view];
}
