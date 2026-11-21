/**
How a *merged* patch export treats the clips' cut ends (fork-owned, pure).

## Why a merged lossless cut stutters (and plays fast for a moment after a seek)

Two things break the video timeline at a join, and both come from `-c copy`:

1. The cut *end* stops on a packet boundary (DTS). The last decoded unit is a P frame whose
   trailing B frames reference a frame outside the segment, so ffmpeg drops them: the clip ends
   with a hole of two to three frames. Inside one clip nobody notices (it is the end of the
   file); in a merged file that hole is in the middle: a short freeze at the join.
2. The clip *start*. The concat demuxer offsets each clip by its container duration, which is not
   the last displayed frame. A copied first GOP starts ~50 ms after its audio, because the muxer
   has to shift the negative DTS of its first B frames, and an encoded part reports a duration
   that is one frame short. Either way the next clip starts a few frames late (another freeze) or
   a few frames early (two frames on the same timestamp, which the muxer/player drops).

A player follows the audio clock. During normal playback it can hide the error; as soon as the
user seeks, it re-aligns video with audio and covers the accumulated offset by showing frames as
fast as it can: a burst of fast playback, then normal speed. This is a known ffmpeg limitation,
not a player setting: see mifi/lossless-cut#2921 (timestamp jumps at joins, closed as not
planned), mifi/lossless-cut#1202 (`Invalid video timestamp: x -> x`, two frames on one timestamp)
and ffmpeg trac #9893. No combination of `-c copy`, `-shortest`, `-avoid_negative_ts` or
`-fflags +igndts/+genpts` fixes it; those were measured (see `ai-tmp` notes) and either changed
nothing or made it worse.

## What repairs it (`repairJoins`)

Re-encode exactly the parts that a lossless cut cannot end cleanly, and stop guessing durations:

- encode the first GOP of every clip, so the clip's video starts at 0 like its audio and a
  keyframe is the first thing a decoder sees;
- encode the last GOP of every clip, so the clip ends on a frame the encoder flushed (no hole);
- copy everything in between, and give the concat demuxer an explicit `duration` per file: the
  clip's last displayed video frame instead of the container duration.

Measured on the 4K 60 fps H.264 source used for the join fix (6 clips, 5 joins): the copy-only
export had 2-3 missing frames at most joins plus duplicate timestamps; this repair gives exactly
one frame across every join, no holes and no duplicates. The price is up to one GOP at each end of
every clip (2-4 s per cut point on a source with a 4 s GOP); the middle is still copied, and the
picture, audio and the rest of the file are untouched.

## Policies

- `losslessGuard` (A): repair, and keep a few extra frames past every cut end.
- `exactTail` (B): repair, cut exactly where asked.
- `compat` (C): the upstream command line (plain `-c copy`, no re-encode). Fast, but the joins
  keep both defects. This is also what base mode gets, unchanged.

A is the accepted policy, not a work in progress. It is the measured result (no holes, one frame
across every join on the 4K source) and the default users get, so it is the reference every other
policy is compared against. A future change that is not a bug fix belongs in a new policy (for
example a cheaper D: tail-only, or explicit durations without re-encoding), with its own
measurements. Do not edit A to make room for it; a new policy must not change what A produces.

The repair cannot run when another file's track is copied (the smart cut machinery only cuts the
main file), when a subtitle/data track is copied (it would be re-encoded and concatenated with
itself, and its packets are not ours to re-time), for a source codec that does not survive a
re-encoded-plus-copied concat, or for a rotated source (a transcode applies the display rotation
physically, so the encoded parts have swapped dimensions while the copied middle does not). Those
exports fall back to the upstream command line (`repairBlocked`, with the reason so the dialog can
say which rule stopped it). An unknown frame rate blocks it too: smart cut derives the frame
timestamps from it, so the re-encode would fail instead of producing a clip.

Only patch mode may change anything; base mode keeps the upstream command line byte for byte.
Every patch cut result follows the policy, including a single segment, because the results may be
merged later and the repair cannot be added to a clip that was already cut.
*/

/** A/B/C. */
export type MergeBoundaryPolicy = 'losslessGuard' | 'exactTail' | 'compat';

/** How policy A sizes its tail guard. */
export type MergeBoundaryGuard = 'bFrames' | 'fixed';

/** Default: A (the user asked for the smooth result out of the box). */
export const defaultMergeBoundaryPolicy: MergeBoundaryPolicy = 'losslessGuard';

/** Default: derive the guard from the B-frame count. */
export const defaultMergeBoundaryGuard: MergeBoundaryGuard = 'bFrames';

/** Policy A's `fixed` guard: what was measured to be enough on a 60 fps source. */
export const fixedGuardSeconds = 0.1;

/**
Never keep less than this many extra frames in `bFrames` mode.

The trailing group that a lossless cut drops is a P frame plus up to three B frames; six frames
are the measured value that is always past it.
*/
export const minimumGuardFrames = 6;

/** FPS assumed when the frame rate is unknown (the guard is a heuristic, not a timestamp). */
const fallbackFps = 60;

const policies: readonly MergeBoundaryPolicy[] = ['losslessGuard', 'exactTail', 'compat'];
const guards: readonly MergeBoundaryGuard[] = ['bFrames', 'fixed'];

/** Validate a stored policy; anything unknown falls back to the default. */
export function parseMergeBoundaryPolicy(value: unknown): MergeBoundaryPolicy {
  return policies.find((policy) => policy === value) ?? defaultMergeBoundaryPolicy;
}

/** Validate a stored guard mode; anything unknown falls back to the default. */
export function parseMergeBoundaryGuard(value: unknown): MergeBoundaryGuard {
  return guards.find((guard) => guard === value) ?? defaultMergeBoundaryGuard;
}

function getSafeFps(fps: number | undefined) {
  return fps != null && Number.isFinite(fps) && fps > 0 ? fps : fallbackFps;
}

/**
How many extra frames policy A keeps at every cut end.

`bFrames`: `max(6, has_b_frames * 2 + 2)` - a 3-level B-frame source gives 6 frames (0.1 s at
60 fps), a source without B frames still keeps the 6-frame minimum (the trailing decoded unit is
not always a P frame). `fixed`: 0.1 s worth of frames at the current rate.
*/
export function getTailGuardFrames({ guard, hasBFrames, fps }: {
  guard: MergeBoundaryGuard;
  hasBFrames: number | undefined;
  fps: number | undefined;
}) {
  if (guard === 'fixed') return Math.max(1, Math.round(fixedGuardSeconds * getSafeFps(fps)));
  return Math.max(minimumGuardFrames, (hasBFrames ?? 0) * 2 + 2);
}

/** The guard policy A appends to `-t`, in seconds. */
export function getCutTailGuardSeconds({ guard, hasBFrames, fps }: {
  guard: MergeBoundaryGuard;
  hasBFrames: number | undefined;
  fps: number | undefined;
}) {
  // `fixed` is a wall-clock duration on purpose: the user asked for "always 0.1 s".
  if (guard === 'fixed') return fixedGuardSeconds;
  return getTailGuardFrames({ guard, hasBFrames, fps }) / getSafeFps(fps);
}

/** Why the join repair cannot run. */
export type JoinRepairBlockReason = 'streams' | 'codec' | 'rotation' | 'fps';

/**
Source video codecs whose re-encoded boundaries can be concatenated with a copied middle.

Measured with `ai-tmp/join-samples-run.cjs`: an H.264 repair decodes without a single error even
though the copied middle comes from a different encoder. HEVC and AV1 do not: every boundary
decodes as garbage because the slices reference parameter sets of their own part, while the mp4
muxer keeps only the first part's. Until the repair can re-time the whole stream for those codecs
(i.e. re-encode more than the boundaries), they stay on the upstream command line.
*/
const repairableCodecs = new Set(['h264']);

/** What the cut of a single clip has to do. All zero/false means: the upstream command line. */
export interface PatchCutPolicy {
  /**
  Re-encode the first and last GOP of every clip and give the merge an explicit duration per clip
  (A and B). Never for base mode or C; every patch cut result gets it, because it cannot be added
  later, when the results are merged.
  */
  repairJoins: boolean;
  /** Seconds appended to `-t` (policy A). `0` keeps the exact cut. */
  tailGuardSeconds: number;
  /**
  Cut the non audio/video tracks (subtitle, data, attachment) in a second pass and remux, so the
  user's `-shortest` setting cannot end a clip where a subtitle ends.
  */
  splitNonAvStreams: boolean;
  /** The user asked for `-shortest`, but a copied track would end the clip before its video does. */
  shortestBlocked: boolean;
  /** The join repair was skipped: another file's track, a subtitle/data track, an unsupported codec or a rotated source. */
  repairBlocked: boolean;
  /** Which rule stopped the repair (`undefined` when it runs, or when there is nothing to repair). */
  repairBlockReason: JoinRepairBlockReason | undefined;
  /** The policy that is actually applied. */
  effective: MergeBoundaryPolicy;
}

const compatPolicy: PatchCutPolicy = {
  repairJoins: false,
  tailGuardSeconds: 0,
  splitNonAvStreams: false,
  shortestBlocked: false,
  repairBlocked: false,
  repairBlockReason: undefined,
  effective: 'compat',
};

/** Resolve the cut policy for one export. Base mode and C keep the upstream command line. */
export function resolveCutPolicy({
  policy,
  guard,
  patchMode,
  detectedFps,
  hasBFrames,
  shortestRequested = false,
  hasExternalStreams = false,
  hasNonAvStreams = false,
  hasShortAudioStream = false,
  hasAudioStream = false,
  hasVideoStream = true,
  videoCodec,
  rotation,
}: {
  policy: MergeBoundaryPolicy;
  guard: MergeBoundaryGuard;
  patchMode: boolean;
  detectedFps: number | undefined;
  hasBFrames: number | undefined;
  /** The user's global `-shortest` setting. */
  shortestRequested?: boolean;
  /** Streams copied from files other than the source video. */
  hasExternalStreams?: boolean;
  /** Copied subtitle/data/attachment tracks. */
  hasNonAvStreams?: boolean;
  /** A copied audio track that ends clearly before the video. */
  hasShortAudioStream?: boolean;
  /** A copied audio track (without one there is no audio clock to follow). */
  hasAudioStream?: boolean;
  /** The source has a video stream to re-encode (the repair is meaningless for audio-only files). */
  hasVideoStream?: boolean;
  /** The source video codec. Only H.264 survives the re-encode-plus-copy concat (see `repairableCodecs`). */
  videoCodec?: string | undefined;
  /** The rotation the export applies (`undefined` or a multiple of 360 means none). */
  rotation?: number | undefined;
}): PatchCutPolicy {
  // Base mode or C: the upstream command line, unchanged. A single patch result is not special:
  // the user may merge it later, and by then its ends can no longer be re-encoded.
  if (!patchMode || policy === 'compat') return compatPolicy;

  // The repair rewrites the video timeline of the clip, so it only runs while every copied stream is
  // one the smart cut machinery can cut: the main file, no subtitle/data track, a codec and an
  // orientation the boundary re-encode can follow, and a known frame rate to place the cut ends.
  const hasRotation = rotation != null && Number.isFinite(rotation) && rotation % 360 !== 0;
  const hasKnownFps = detectedFps != null && Number.isFinite(detectedFps) && detectedFps > 0;
  let repairBlockReason: JoinRepairBlockReason | undefined;
  // Nothing to repair without a video stream: the export is either audio-only or has no video at
  // all, so there is no join and the dialog must not claim the codec stopped the repair.
  if (!hasVideoStream) repairBlockReason = undefined;
  else if (hasExternalStreams || hasNonAvStreams) repairBlockReason = 'streams';
  else if (!repairableCodecs.has(videoCodec ?? '')) repairBlockReason = 'codec';
  else if (hasRotation) repairBlockReason = 'rotation';
  // Smart cut derives the frame timestamps from the frame rate; without it the re-encode throws.
  else if (!hasKnownFps) repairBlockReason = 'fps';
  const repairBlocked = repairBlockReason != null;
  const repairJoins = !repairBlocked && hasVideoStream;

  // `-shortest` ends the output when *any* stream ends, so a subtitle/data track must move to its own
  // pass for it to stay usable. Only worth doing when the user actually asked for `-shortest`.
  const splitNonAvStreams = shortestRequested && hasNonAvStreams && hasAudioStream && !hasExternalStreams;
  // The split only takes the subtitle/data tracks out of the shortest pass: what is left in it is the
  // video and the audio, so a short audio track still ends the clip early and `-shortest` has to be
  // left out either way (the dialog says so, and the cutter drops the flag).
  const shortestBlocked = shortestRequested
    && (hasExternalStreams || hasShortAudioStream || (hasNonAvStreams && !splitNonAvStreams));

  return {
    repairJoins,
    // A only, and only when the repair can actually make the cut end land on a complete frame.
    tailGuardSeconds: repairJoins && policy === 'losslessGuard'
      ? getCutTailGuardSeconds({ guard, hasBFrames, fps: detectedFps })
      : 0,
    splitNonAvStreams,
    shortestBlocked,
    repairBlocked,
    repairBlockReason,
    effective: policy,
  };
}

/**
The cut-strategy part of a patch export's signature (fork-owned, pure).

The incremental export reuses a clip when its signature still matches. The policy changes the
clip itself (re-encoded ends, a tail guard), so switching from C to A must re-cut an existing
result instead of concatenating the old, still stuttering clip.

`repairVideoEncode` belongs here for the same reason: a clip exported before the repair was turned
on is a lossless copy that keeps the source's damage. Reusing it would keep a clip that stutters in
the middle, and merging it with repaired clips would concatenate streams that were not encoded
alike.
*/
export function getPatchCutSignature({ policy, guard, repairJoins, tailGuardSeconds, repairVideoEncode }: {
  policy: MergeBoundaryPolicy;
  guard: MergeBoundaryGuard;
  repairJoins: boolean;
  tailGuardSeconds: number;
  repairVideoEncode?: boolean | undefined;
}) {
  return {
    policy,
    guard,
    repairJoins,
    tailGuardSeconds,
    // Only present while repairing. A file that is not damaged keeps exactly the signature it had
    // before this feature existed, so turning the app on does not re-cut every existing result.
    ...((repairVideoEncode === true) && { repairVideoEncode: true }),
  };
}
