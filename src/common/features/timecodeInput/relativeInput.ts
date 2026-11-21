/* eslint-disable import/prefer-default-export */
/**
Split the value of a timecode dialog into the text to parse and the relative direction its prefix
asks for (fork-owned, pure).

The dialog accepts a leading `+`/`-` for "seek from here" (see `useTimecode`), and the parsers
themselves do not trim: a pasted `" +..1.2.3"` would keep the sign *and* the space, so the sign
would not be recognised and the compact parser would reject a value it otherwise accepts. The
whitespace is trimmed first, so the prefix means the same thing wherever it sits.
*/
export function splitRelativeTimecodeInput({ value, allowRelative }: {
  value: string;
  /** Does this dialog turn a leading sign into a relative seek at all? */
  allowRelative: boolean;
}): { text: string; relDirection: number | undefined } {
  const trimmed = value.trim();
  if (!allowRelative) return { text: trimmed, relDirection: undefined };
  if (trimmed.startsWith('-')) return { text: trimmed.slice(1), relDirection: -1 };
  if (trimmed.startsWith('+')) return { text: trimmed.slice(1), relDirection: 1 };
  return { text: trimmed, relDirection: undefined };
}
