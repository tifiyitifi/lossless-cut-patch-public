import type { PatchDetachGridItemKind } from './grid.js';

/**
Which files a column-header action runs on (fork-owned, pure).

The panel fires a deep check for a whole column, not just for the cards the user clicked one by one.
The rule is the same for both columns:

1. if the column has selected items, the action runs on exactly those (in visual order);
2. if it does not, the action falls back to the scope the user picked in the dialog: all sources, all
   results, or everything.

`missing` results are not items, so they can never become a target; a target appears once, in the
order the grid shows it.
*/

export type PatchDetachAnalyzeScope = 'sources' | 'results' | 'everything';

/** The fallback the dialog opens with: the column whose button was clicked. */
export function patchDetachAnalyzeScopeForKind(kind: PatchDetachGridItemKind): PatchDetachAnalyzeScope {
  return kind === 'source' ? 'sources' : 'results';
}

/**
The paths a column's deep check runs on.

`items` is the flattened grid (see `flattenPatchDetachGrid`); `selection` stores item keys. Only a
selected item of the clicked column counts as "the user picked files" - a selection in the other
column leaves the question open.
*/
export function buildPatchDetachAnalysisTargets({ items, selection, kind, scope }: {
  items: readonly { key: string; path: string; kind: PatchDetachGridItemKind; selectable: boolean }[];
  selection: { readonly selected: ReadonlySet<string> };
  kind: PatchDetachGridItemKind;
  scope: PatchDetachAnalyzeScope;
}): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  const add = (item: { path: string }) => {
    if (seen.has(item.path)) return;
    seen.add(item.path);
    paths.push(item.path);
  };

  const selectedOfKind = items.filter((item) => item.kind === kind && item.selectable && selection.selected.has(item.key));
  if (selectedOfKind.length > 0) {
    for (const item of selectedOfKind) add(item);
    return paths;
  }

  for (const item of items) {
    if (!item.selectable) continue;
    if (scope === 'sources' && item.kind !== 'source') continue;
    if (scope === 'results' && item.kind !== 'result') continue;
    add(item);
  }
  return paths;
}
