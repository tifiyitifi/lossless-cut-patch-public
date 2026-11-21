/**
Which encoder the join repair uses (fork-owned, pure).

Upstream's smart cut passes the *codec name* as `-c:v` (`h264`), and ffmpeg then takes whichever
encoder it registered first for that codec: `libx264`, `h264_nvenc`, `h264_mf`, `h264_qsv`, ...
The log only shows `-c:0 h264`, so two exports can be encoded by different hardware without
anything saying so, with different quality, speed and pixel format support. The join repair pins
the software encoder so the result of an export is reproducible and does not depend on the
machine's GPU.

Only H.264 is pinned *and* only H.264 gets the repair at all. A repair clip is three parts
joined with `-c copy`: an encoded head, a copied middle and an encoded tail. H.264 decoders
tolerate the parameter sets that each part brings (measured on the 4K source: the merged file
decodes without a single error), but HEVC and AV1 do not: the merged file decodes as garbage at
every boundary because the second part's slices reference parameter sets that the muxer dropped
(measured on `ai-tmp` samples). Smart cut does not re-encode the middle, so it cannot fix that,
and an export that silently produces an undecodable file is worse than a stuttering join. Codecs
without a measured encoder stay on the upstream command line (policy C), see `policy.ts`.

A custom or trimmed ffmpeg build may not have `libx264` at all (`Unknown encoder 'libx264'` used
to fail the whole export). When the encoder list is available and the pinned encoder is missing,
the repair falls back to the codec name (today's behaviour: ffmpeg picks an encoder) and the
caller logs a warning. A failed listing does not downgrade anything: the pinned name is used, so
a broken `-encoders` probe cannot silently change an export that would have worked.

Profile and level are deliberately not passed: see `encoderArgs.ts`.
*/

const pinnedEncoders: Readonly<Record<string, string>> = {
  h264: 'libx264',
};

/** The `-c:v` value the join repair should pass for a detected source codec. */
export function getJoinRepairEncoder(detectedCodec: string) {
  return pinnedEncoders[detectedCodec] ?? detectedCodec;
}

/**
Names in the output of `ffmpeg -hide_banner -encoders`.

Each line is `<6 flags> <name> <description>`, e.g. ` V....D libx264   libx264 H.264 ...`; the
legend at the bottom (` V..... = Video`) is not an encoder and must not end up in the set.
*/
export function parseFfmpegEncoders(stdout: string) {
  const encoders = new Set<string>();
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^\s*[VAS][A-Z.]{5}\s+(\S+)/.exec(line);
    const name = match?.[1];
    if (name != null && !name.startsWith('=')) encoders.add(name);
  }
  return encoders;
}

/**
The encoder to use, and whether the build lacks the pinned one.

`available == null` means the listing failed: keep the pinned encoder instead of guessing.
A codec without a pin is returned as-is without a warning (there is nothing to fall back from).
*/
export function resolveJoinRepairEncoder({ detectedCodec, available }: {
  detectedCodec: string;
  available: ReadonlySet<string> | undefined;
}): { encoder: string; fellBack: boolean } {
  const preferred = getJoinRepairEncoder(detectedCodec);
  if (preferred === detectedCodec) return { encoder: detectedCodec, fellBack: false };
  if (available == null || available.has(preferred)) return { encoder: preferred, fellBack: false };
  return { encoder: detectedCodec, fellBack: true };
}
