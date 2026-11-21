/**
A machine-independent string order (fork-owned).

Some of these orders are written to disk or hashed into an export signature (the merge order of
equal-start clips, the flattened `ParamsByFile`), so they must not depend on the collation data of
the runtime: `localeCompare` follows the bundled ICU version, and it returns 0 for canonically
equivalent strings (which then falls back to insertion order). Comparing by code point is a total
order on the strings themselves.
*/
export default function compareStrings(left: string, right: string) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
