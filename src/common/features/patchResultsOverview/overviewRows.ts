/**
Selecting a row in the results overview (fork-owned, pure).

The overview lists group headers, sources, results and missing files in one scroll area. Only the
rows that lead somewhere (a file to show in the file manager) can be selected, so Up/Down must skip
the others - the same rule the work-folder list follows.
*/

/**
The next selectable row index.

`from` may point at a header or a missing file (the first render starts at 0); the search then
starts at the nearest selectable row after it, falling back to the last one. Returns `-1` when no
row is selectable.
*/
export function moveOverviewSelection(selectable: readonly boolean[], from: number, delta: number): number {
  const enabled = selectable.flatMap((value, index) => (value ? [index] : []));
  const first = enabled[0];
  const last = enabled.at(-1);
  if (first == null || last == null) return -1;

  const current = selectable[from] === true ? from : (enabled.find((index) => index >= from) ?? last);
  const position = enabled.indexOf(current);
  const target = Math.min(Math.max(position + delta, 0), enabled.length - 1);
  return enabled[target] ?? first;
}
