/**
Does a source video have a damaged head GOP? (pure, fork-owned)

A download can lose a packet at the start of the file. The H.264 parser then reports

```
Invalid NAL unit size (1946157056 > 2349).
missing picture in access unit with size 2353
Error splitting the input into NAL units.
```

Those frames cannot be decoded by any player, and a lossless cut cannot repair them (it only
copies the broken packets along). The only fixes are a new download or re-encoding that spot.

The probe only reads the file header, so this detects damage *at the beginning* of the file: a
defect further in is not seen here.
*/

/** What a probe's stderr says about the file. */
export interface SourceHealthParse {
  /** Any parser complaint that means some frames cannot be decoded. */
  damaged: boolean;
  /** `Invalid NAL unit size (...)` - a NAL unit header that cannot be parsed. */
  invalidNalUnit: boolean;
  /** `missing picture in access unit` - a frame the decoder cannot build. */
  missingPicture: boolean;
  /** `Error splitting the input into NAL units` - the demuxer gave up on a packet. */
  splitFailed: boolean;
  /** How many damage lines were seen (the same three patterns). */
  errorCount: number;
}

const damagePatterns: readonly { pattern: RegExp, field: 'invalidNalUnit' | 'missingPicture' | 'splitFailed' }[] = [
  { pattern: /Invalid NAL unit size\b/g, field: 'invalidNalUnit' },
  { pattern: /missing picture in access unit\b/g, field: 'missingPicture' },
  { pattern: /Error splitting the input into NAL units\b/g, field: 'splitFailed' },
];

/** Read a probe's stderr. Anything that does not match the patterns is not damage. */
export function parseSourceHealth(stderr: string): SourceHealthParse {
  const result: SourceHealthParse = {
    damaged: false,
    invalidNalUnit: false,
    missingPicture: false,
    splitFailed: false,
    errorCount: 0,
  };

  for (const { pattern, field } of damagePatterns) {
    const count = stderr.match(pattern)?.length ?? 0;
    if (!(count > 0)) {
      continue;
    }

    result[field] = true;
    result.errorCount += count;
  }
  result.damaged = result.errorCount > 0;
  return result;
}

/** The user-facing verdict of a scan. */
export type PatchSourceHealth = 'ok' | 'damaged-head-gop';

/** Collapse the parse into the one value the UI cares about. */
export function summarizeSourceHealth(parsed: Pick<SourceHealthParse, 'damaged'>): PatchSourceHealth {
  return parsed.damaged ? 'damaged-head-gop' : 'ok';
}
