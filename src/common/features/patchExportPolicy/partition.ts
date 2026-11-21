/**
Splitting the copied streams of one clip into two passes (fork-owned, pure).

A lossless cut only stops the trailing hole at a join when `-shortest` is used, and `-shortest`
ends the output at the *shortest* stream. A subtitle or data track normally ends long before the
video, so it cannot be in that pass. Cutting it separately and remuxing keeps both properties:
the video/audio pass keeps `-shortest`, the other tracks keep their own length.

The split is only worth it when both passes are non-empty, which is what the callers check.
*/

/** A file and the stream indexes copied from it (the same shape as the renderer's copy list). */
export interface CopiedFileStreams {
  path: string;
  streamIds: number[];
}

const audioVideoTypes = new Set(['audio', 'video']);

/** The stream types the renderer needs; anything else is "other". */
export interface StreamTypeLookup {
  index: number;
  codec_type: string;
}

/**
Split the copied streams into the video/audio pass and the "everything else" pass.

A stream that is not in the lookup is treated as audio/video: it keeps the pass complete, and an
empty "other" pass makes the caller fall back to a single cut, which never loses a track.
*/
export function partitionCopiedStreams({ copyFileStreams, streamsByPath }: {
  copyFileStreams: readonly CopiedFileStreams[];
  streamsByPath: Readonly<Record<string, readonly StreamTypeLookup[] | undefined>>;
}): { av: CopiedFileStreams[], other: CopiedFileStreams[] } {
  const av: CopiedFileStreams[] = [];
  const other: CopiedFileStreams[] = [];

  copyFileStreams.forEach(({ path, streamIds }) => {
    const streams = streamsByPath[path];
    const avIds: number[] = [];
    const otherIds: number[] = [];

    streamIds.forEach((streamId) => {
      const stream = streams?.find((candidate) => candidate.index === streamId);
      if (stream != null && !audioVideoTypes.has(stream.codec_type)) otherIds.push(streamId);
      else avIds.push(streamId);
    });

    if (avIds.length > 0) av.push({ path, streamIds: avIds });
    if (otherIds.length > 0) other.push({ path, streamIds: otherIds });
  });

  return { av, other };
}
