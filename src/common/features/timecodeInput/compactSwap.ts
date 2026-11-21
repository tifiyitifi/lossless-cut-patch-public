/* eslint-disable import/prefer-default-export */
/**
The swap between the two input forms of the timecode dialog (fork-owned, pure).

The backend parses `..1234` as a compact time and `1234` as the active timecode format. The
dialog carries a switch that puts the common case first: with it on, a plain value is the compact
time and the `..` prefix asks for the timecode format. The swap is a text move, so nothing about
the parsers changes and a value still means the same time on both sides of the switch.

A leading `+`/`-` belongs to the relative seek, not to the marker, so it stays in front
(`+1234` becomes `+..1234`).
*/

const relativePrefixRegex = /^[+-]/;

export function applyCompactSwap(text: string, swapped: boolean): string {
  if (!swapped) return text;

  const relativePrefix = relativePrefixRegex.exec(text)?.[0] ?? '';
  const body = text.slice(relativePrefix.length);

  const swappedBody = body.startsWith('..') ? body.slice(2) : `..${body}`;
  return `${relativePrefix}${swappedBody}`;
}
