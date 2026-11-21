/* eslint-disable import/prefer-default-export */
/**
Read the packet timestamps of a damage probe sample (pure).

The sample comes from `ffprobe -show_entries packet=pts,dts -of csv=p=0`: one `pts,dts` line per
packet. `N/A` is what ffprobe writes for a timestamp the file does not store, and a timestamp is
written in the stream's timebase (an integer), so "the same value" is all this asks about.

A packet whose timestamps could not be read is **not** evidence either way: a raw elementary
stream prints `N/A,N/A`, and comparing those strings would make a healthy file look like the
damage this probe exists to find.
*/

function toTimestamp(value: string | undefined): number | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === 'N/A') return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
Does every packet with readable timestamps present and decode at the same time?

`undefined` when the sample holds no packet with two readable timestamps, which means the file
stores no timing this can judge (the caller treats that as "no damage").
*/
export function parseFirstGopPtsEqualsDts(csv: string): boolean | undefined {
  const rows = csv
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const [pts, dts] = line.split(',', 2);
      return { pts: toTimestamp(pts), dts: toTimestamp(dts) };
    })
    .filter((row): row is { pts: number, dts: number } => row.pts != null && row.dts != null);

  if (rows.length === 0) return undefined;
  return rows.every(({ pts, dts }) => pts === dts);
}
