/**
Parsing / formatting of the legacy `src_*.txt` time tokens.

Legacy rules (see the original PowerShell `ConvertToTimeFormat`):
- 6-9 digits are interpreted as `HHMMSSfff` (right padded with zeros).
- `HH:MM:SS` with an optional `.f`/`.ff`/`.fff` fraction (halfwidth `:` or fullwidth `：`).
*/

const colonTimeRegex = /^(\d{2})[:：](\d{2})[:：](\d{2})(?:\.(\d{1,3}))?$/;
const digitsTimeRegex = /^\d{6,9}$/;

/** Parse a legacy time token into seconds, or `undefined` when it is not a valid time. */
export function parseLegacyTime(raw: string): number | undefined {
  const value = raw.trim();

  const colon = colonTimeRegex.exec(value);
  if (colon != null) {
    const hh = Number(colon[1]);
    const mm = Number(colon[2]);
    const ss = Number(colon[3]);
    const frac = colon[4];
    const ms = frac != null ? Number(frac.padEnd(3, '0')) : 0;
    return (hh * 3600) + (mm * 60) + ss + (ms / 1000);
  }

  if (digitsTimeRegex.test(value)) {
    const padded = value.padEnd(9, '0');
    const hh = Number(padded.slice(0, 2));
    const mm = Number(padded.slice(2, 4));
    const ss = Number(padded.slice(4, 6));
    const ms = Number(padded.slice(6, 9));
    return (hh * 3600) + (mm * 60) + ss + (ms / 1000);
  }

  return undefined;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Format seconds as the canonical legacy time string `HH:MM:SS.fff`. */
export function formatLegacyTime(totalSeconds: number): string {
  const totalMs = Math.max(0, Math.round(totalSeconds * 1000));
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const ss = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const mm = totalMin % 60;
  const hh = Math.floor(totalMin / 60);
  return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}.${String(ms).padStart(3, '0')}`;
}
