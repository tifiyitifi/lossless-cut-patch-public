/**
The cut window of the encoded pieces of a clip (fork-owned, pure).

A lossless cut cannot start on a non-keyframe, so the join repair encodes the small piece between
the requested cut start and the next keyframe, and copies everything after the keyframe (see
`policy.ts`). That head is usually a few frames long. When the cut starts less than one frame
before a keyframe there is no frame in between, and `getSmartCutHeadEnd` keeps one frame anyway
(the copy can only start on the keyframe, so this frame is the only way to keep the requested
start).

The one-frame guarantee only holds if the frame at the end of the window is really encoded.
ffmpeg's `-t` is an open interval: a frame whose timestamp is at or past the limit is dropped, and
the single frame of a one-frame window lands exactly on the limit (measured: cut start
551.009034, keyframe 551.040, 25 fps gives `-t 0.04` and a first frame timestamp of 0.040000).
The encoded part then contains audio only - and ffmpeg still exits 0. The concat demuxer takes its
stream list from that (first) part, so the map of the next track fails with
`Stream map '' matches no streams`, and the whole export aborts. `getEncodedFragmentDuration`
keeps such a boundary frame.

A head window can also hold no frame at all (the segment starts before the source's first frame, see
`planConcatParts` in `concatParts.ts`): then no epsilon can save it, and the concat drops the empty
part instead of aborting or writing a file no player can read.
*/

/**
How much of a frame the end of a concatenated piece is extended by.

The next frame starts a whole frame later, so this can never pull it in; it only stops ffmpeg from
dropping a frame that starts exactly at the nominal end.
*/
const endEpsilonOfFrame = 1 / 1000;

/**
The end of the encoded head.

The copy starts on `nextKeyframe`, so the head ends one frame earlier to leave no duplicate. The
`max` keeps at least one frame for the case where the cut starts inside the last frame before that
keyframe.
*/
export function getSmartCutHeadEnd({ cutFrom, nextKeyframe, frameDuration }: {
  cutFrom: number;
  nextKeyframe: number;
  frameDuration: number;
}) {
  return Math.max(cutFrom + frameDuration, nextKeyframe - frameDuration);
}

/**
The `-t` of an encoded piece that is concatenated with the rest of the clip.

Extends the nominal length by a sub-frame epsilon, so a frame that starts exactly at the end is
included instead of dropped. A piece that encodes the whole clip keeps its exact length: there the
frame that starts at the cut end is what the user cut away, and nothing is concatenated after it.
*/
export function getEncodedFragmentDuration({ cutFrom, cutTo, frameDuration }: {
  cutFrom: number;
  cutTo: number;
  frameDuration: number;
}) {
  const duration = cutTo - cutFrom;
  if (!Number.isFinite(duration) || duration <= 0) return Math.max(duration, 0);
  if (!Number.isFinite(frameDuration) || frameDuration <= 0) return duration;
  return duration + (frameDuration * endEpsilonOfFrame);
}
