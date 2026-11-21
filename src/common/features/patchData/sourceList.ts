/**
The source file list's layout and row details (patch, fork-owned).

The panel is the fork's own furniture: upstream draws a single line per file (a number and the
name), while patch mode shows a badge, the name, and a second line with the details a file manager
shows - duration, size, modification time. That second line is what makes the sort keys visible, so
the numbers here are part of the fork's UI contract and not upstream.

Kept in `common` because the values are plain data: the width is persisted in `PatchSettings`, and
the formatters are used for the list and for the sort menu's captions. Nothing here reads a file or
touches React, so every rule is unit tested.
*/

/** Where the panel starts when the user has never dragged it. Wider than the upstream sidebar: a row now has two lines. */
export const defaultSourceListWidth = 320;

/** Narrower than this and the detail line is one ellipsis; the badge would take the room the name needs. */
export const minSourceListWidth = 200;

/** Half a 1080p window: the video keeps the larger part, however wide the user drags. */
export const maxSourceListWidth = 520;

/**
The width to use, from a stored value that may be missing, hand-edited or from an older build.

A stored value is never trusted as-is: `patch-config.json` is a text file the user can edit, and a
width of `0` or `NaN` would leave an invisible panel that no menu entry can bring back (the list is
still "shown", just empty-looking). Clamped and rounded, so the stored number is always usable.
*/
export function clampSourceListWidth(width: number | undefined): number {
  if (width == null || !Number.isFinite(width)) return defaultSourceListWidth;
  return Math.min(maxSourceListWidth, Math.max(minSourceListWidth, Math.round(width)));
}

const sizeUnits = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
A file size for the detail line: `0 B`, `998 KB`, `1.2 GB`.

Hand-written rather than `pretty-bytes` (which the segment list uses): the list shows the same
number next to the same file on every render, so the output must not depend on the system locale or
on the library's default fraction rules. One decimal below 100 units above bytes (`1.5 KB`,
`12.5 MB`), none for whole bytes and for three-digit values (`128 MB`, not `128.0 MB`).
*/
export function formatFileSize(bytes: number | undefined): string | undefined {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return undefined;

  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < sizeUnits.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const fractionDigits = unitIndex === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(fractionDigits)} ${sizeUnits[unitIndex]!}`;
}

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

/**
The modification time as `YYYY-MM-DD HH:mm`, in the machine's local time.

Not `toLocaleString`: the list must not change shape with the OS locale, and a locale that writes
`11/15/2026, 2:03 PM` is both longer and harder to compare down a column. Seconds are left out on
purpose - a sort by time never needs them, and the line is already the widest of the three.
*/
export function formatCompactModifiedTime(mtimeMs: number | undefined): string | undefined {
  if (mtimeMs == null || !Number.isFinite(mtimeMs) || mtimeMs <= 0) return undefined;

  const date = new Date(mtimeMs);
  if (Number.isNaN(date.getTime())) return undefined;

  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}
