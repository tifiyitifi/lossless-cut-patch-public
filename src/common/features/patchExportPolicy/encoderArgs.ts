/**
The extra encoder arguments for a join-repair fragment (fork-owned, pure).

The repair re-encodes the first and last GOP of every clip and copies the middle. All three parts
end up in one stream, so every property the copied middle keeps from the source has to be kept by
the encoded parts too; otherwise the stream changes property in the middle of a clip.

- `-pix_fmt <source>`: without it, an encoder that does not support the source's pixel format
  silently converts it (a 10-bit source can come out 8-bit) while the copied middle stays 10-bit:
  one stream with two pixel formats, which players render as garbage. Passing it turns a silent
  conversion into an ffmpeg error.
- colour tags through the `setparams` filter: ffmpeg's `-color_primaries`/`-color_trc` codec
  options do not reach the encoder on ffmpeg 8/9 (measured: the output still said `unknown`),
  while `setparams` sets the frame properties and works with every encoder. Only tags that the
  source actually carries are passed; `unknown`/`reserved` are ffprobe's way of saying "not set".
- `-flags +ildct+ilme`: libx264 and friends encode progressive by default. An interlaced source
  would come back progressive in the repaired fragments while the copied middle stays interlaced:
  combing and field-order judder at every cut. The flag makes the encoder keep the field structure.
  x264 always codes top-field-first unless told otherwise (it ignores `-field_order`), so a
  bottom-field-first source also needs its private `bff=1` option.

Profile and level are deliberately not passed: one H.264 stream may contain several SPS with
different profile/level (the copied middle keeps its own), a wrong profile name or a level lower
than the encoder's minimum fails the whole export (`level 4.2 is too low for the bitrate`), and the
pixel format already decides the profile (10-bit is High 10, 4:2:2 is High 4:2:2).
*/

export interface RepairSourceVideo {
  pixFmt?: string | undefined;
  /** `tt`/`bb`/`tb`/`bt` when the source is interlaced, `progressive` otherwise. */
  fieldOrder?: string | undefined;
  colorRange?: string | undefined;
  colorSpace?: string | undefined;
  colorTransfer?: string | undefined;
  colorPrimaries?: string | undefined;
}

const interlacedFieldOrders = new Set(['tt', 'bb', 'tb', 'bt']);
const bottomFirstFieldOrders = new Set(['bb', 'bt']);

function isKnown(value: string | undefined): value is string {
  return value != null && value !== '' && value !== 'unknown' && value !== 'reserved';
}

/**
The arguments to append after `-c:v`/`-b:v` of a repair fragment.

`encoder` is the `-c:v` value that is actually used: the bottom-field-first workaround is an x264
private option, so it is only passed when the pinned encoder is in use. A fragment with no
properties to follow yields `[]`, so an ordinary 8-bit progressive source takes the same code path
with the fewest arguments.
*/
export function buildRepairVideoArgs(source: RepairSourceVideo, encoder: string): string[] {
  const args: string[] = [];

  if (isKnown(source.pixFmt)) args.push('-pix_fmt', source.pixFmt);

  const setParams: string[] = [];
  if (isKnown(source.colorRange)) setParams.push(`range=${source.colorRange}`);
  if (isKnown(source.colorPrimaries)) setParams.push(`color_primaries=${source.colorPrimaries}`);
  if (isKnown(source.colorTransfer)) setParams.push(`color_trc=${source.colorTransfer}`);
  if (isKnown(source.colorSpace)) setParams.push(`colorspace=${source.colorSpace}`);
  if (setParams.length > 0) args.push('-vf', `setparams=${setParams.join(':')}`);

  if (source.fieldOrder != null && interlacedFieldOrders.has(source.fieldOrder)) {
    const { fieldOrder } = source;
    args.push('-flags', '+ildct+ilme');
    if (encoder === 'libx264' && bottomFirstFieldOrders.has(fieldOrder)) {
      args.push('-x264-params', 'bff=1');
    }
  }

  return args;
}

/**
The encoders whose quality this repair pins itself with `-preset`/`-crf` (see
`buildDamageRepairEncodeArgs`).

Any other encoder must not be handed `-b:v 0`: with no `-crf` of its own that value means "the
encoder's default quality" (libx265 answers CRF 28, far below the `-crf 18` of the measured path),
so the repaired clips would silently look worse than the ones rewritten above.
*/
export function isDamageRepairQualityTargeted(encoder: string | undefined) {
  return encoder === 'libx264';
}

/**
The `-b:v` value of a damaged source's repair encode.

`0` hands the rate control to the pinned `-crf`; every other encoder keeps the bitrate the source
has. A repair encode has no bitrate the user chose for it: its switch is on/off, and the export
dialog hides the bitrate field while `isEncoding` is false - which is exactly the repaired case.
*/
export function getDamageRepairVideoBitrate({ encoder, sourceBitrate }: {
  encoder: string | undefined;
  /** The source's own video bitrate (bit/s), already resolved by `getCodecParams`. */
  sourceBitrate: number;
}) {
  if (isDamageRepairQualityTargeted(encoder)) return 0;
  return sourceBitrate;
}

/**
The encoder arguments a *damaged* source's whole-video encode needs (fork-owned, pure).

The damage this repairs is reordering without the timestamps that describe it, so the output has to
be free of reordering: with `-bf 0` the encoder emits frames in display order and the muxer can
write correct timing by construction, which is exactly the shape of a source that never had the
defect. This holds whatever picked the encoder, so it is not part of the join-repair args above
(which are only used when the encoder is pinned).

`lossy` means the user chose lossy mode, which brings its own encoder and bitrate: its quality
options must not be overridden here, but the frame order still may not be.
*/
export function buildDamageRepairEncodeArgs({ encoder, lossy }: {
  /** The `-c:v` value that will be used (`undefined` when it is not known yet). */
  encoder: string | undefined;
  /** Lossy mode chose the encoder and the bitrate. */
  lossy: boolean;
}): string[] {
  const args = ['-bf', '0'];
  // Only the measured encoder gets the quality target: another one may not know these options at all.
  if (!lossy && isDamageRepairQualityTargeted(encoder)) args.unshift('-preset', 'veryfast', '-crf', '18');
  return args;
}
