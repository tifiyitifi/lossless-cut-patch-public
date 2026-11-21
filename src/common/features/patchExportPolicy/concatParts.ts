/**
Which concat part broke the stream layout (fork-owned, pure).

The concat demuxer takes its stream list from the **first** file and maps every later file by index,
so the `-map 0:N` arguments of the output refer to that list. A part that lost a track - an encoded
head that produced no frames (see `encodedParts.ts`), a truncated file, a source with no video in
that window - makes the map fail with `Stream map '' matches no streams`, which says nothing about
which part is broken. A part that lists its tracks in another order is worse: the map "succeeds" and
muxes the wrong codecs. Comparing the probed layouts turns both into a message that names the part.
*/

/** The stream properties the concat layout depends on. */
export interface ConcatStreamLayout {
  index: number;
  codec_type: string;
}

/** One file of the concat list and its probed streams. */
export interface ConcatLayoutPart {
  /** The part's path, used in the message. */
  path: string;
  streams: readonly ConcatStreamLayout[];
}

export interface ConcatLayoutMismatch {
  /** The first part that cannot be mapped like `expected`. */
  path: string;
  /** The stream index (in the expected layout) that is missing or has another type. */
  index: number;
  /** The stream type that is expected at that index. */
  expectedCodecType: string;
  /** What the part has at that position instead (`undefined` when it has no such stream). */
  actualCodecType: string | undefined;
  /** The part has no stream of `expectedCodecType` at all (the common case: a track was lost). */
  missing: boolean;
}

/**
The first part whose streams cannot be mapped like `expected`, or `undefined` when every part has
the same layout.

Parts are compared by position in the stream list, not by the `index` value: the concat demuxer
renumbers the streams of the first file, and `-map 0:N` addresses that numbering.
*/
export function findConcatLayoutMismatch({ expected, parts }: {
  expected: readonly ConcatStreamLayout[];
  parts: readonly ConcatLayoutPart[];
}): ConcatLayoutMismatch | undefined {
  for (const part of parts) {
    const streams = [...part.streams].sort((a, b) => a.index - b.index);
    for (const [position, stream] of expected.entries()) {
      const actual = streams[position];
      if (actual?.codec_type === stream.codec_type) continue;
      return {
        path: part.path,
        index: stream.index,
        expectedCodecType: stream.codec_type,
        actualCodecType: actual?.codec_type,
        missing: streams.every((candidate) => candidate.codec_type !== stream.codec_type),
      };
    }
    // A part with *more* streams than the first one is not a mapping problem (the extra streams are
    // simply not mapped), but the concat demuxer then drops them, and the result would miss a track
    // the rest of the clip has. Report it as a mismatch as well.
    if (streams.length > expected.length) {
      const extra = streams[expected.length]!;
      return {
        path: part.path,
        index: extra.index,
        expectedCodecType: extra.codec_type,
        actualCodecType: extra.codec_type,
        missing: false,
      };
    }
  }
  return undefined;
}

/**
The parts to hand to the concat demuxer, without the ones that hold no video.

Every part of an encoded clip is written with the clip's video track, so a part that comes out
without one is an empty fragment. Measured cause: a segment that starts at 0 while the source's own
video track starts two frames later (its edit list moves the first frame there) makes the encoded
head end before that frame. ffmpeg then encodes no video frame at all and still exits 0, and what
the part holds depends on the source's other tracks - which decides how the export fails:

- data track only: the concat demuxer takes the stream list of that part for the whole concat, the
  muxer writes an edit list that points far past the media end (`media_time` 23287 s on an 83 s
  clip, `dts` 0 on every sample, `No start code is found` from the decoder) and the result does not
  play in any player (tested with PotPlayer and the results window);
- audio and data: the map of the part's missing video fails and ffmpeg aborts with
  `Could not write header` (exit -22), leaving a 0 byte file and a "pieces cannot be joined" error.

Dropping such a part loses at most the audio of a window the video cannot cover anyway (measured:
826/826 video packets and 644/644 audio packets, identical sample tables), and the rest of the clip
concats normally.

`expected` is the stream layout of the clip's own part (the copied middle), and `requiredPath` is
that part's path: it is never dropped, whatever it holds, because it is the video of the clip. A
clip without video keeps every part.
*/
export function planConcatParts({ expected, parts, requiredPath }: {
  expected: readonly ConcatStreamLayout[];
  /** The part the clip is built around (its copied middle): never dropped. */
  requiredPath?: string | undefined;
  parts: readonly ConcatLayoutPart[];
}): { parts: ConcatLayoutPart[]; dropped: ConcatLayoutPart[] } {
  const clipHasVideo = expected.some((stream) => stream.codec_type === 'video');
  if (!clipHasVideo) return { parts: [...parts], dropped: [] };

  const hasVideo = (part: ConcatLayoutPart) => part.streams.some((stream) => stream.codec_type === 'video');
  const lacksVideo = (part: ConcatLayoutPart) => part.streams.every((stream) => stream.codec_type !== 'video');

  const kept = parts.filter((part) => hasVideo(part) || part.path === requiredPath);
  // Nothing left holds video: the concat cannot produce a video clip either way, so leave the list
  // alone and let it fail with the message that names the broken part (see `findConcatLayoutMismatch`).
  const clipStillHasVideo = kept.some((part) => hasVideo(part));
  if (!clipStillHasVideo) return { parts: [...parts], dropped: [] };

  return { parts: kept, dropped: parts.filter((part) => lacksVideo(part) && part.path !== requiredPath) };
}

/**
Does ffmpeg stderr say that a `-map` referred to a stream the input does not have?

This is the error a changed concat layout produces (`Stream map '' matches no streams` plus
`Failed to set value '0:1' for option 'map'`), but the same lines appear whenever an output stream
is mapped from an input that lost it, so the answer is about the shape of the failure, not its cause.
*/
export function isConcatStreamMapError(stderr: string) {
  return stderr.includes('matches no streams') || stderr.includes("for option 'map'");
}
