// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import {
  defaultMergeBoundaryGuard, defaultMergeBoundaryPolicy, fixedGuardSeconds, getCutTailGuardSeconds, getPatchCutSignature, getTailGuardFrames,
  parseMergeBoundaryGuard, parseMergeBoundaryPolicy, resolveCutPolicy,
} from './policy.js';

const merged = {
  patchMode: true,
  detectedFps: 60,
  hasBFrames: 2,
  videoCodec: 'h264',
} as const;

describe('merge boundary policy defaults', () => {
  it('defaults to A (lossless guard) with the B-frame guard', () => {
    expect(defaultMergeBoundaryPolicy).toBe('losslessGuard');
    expect(defaultMergeBoundaryGuard).toBe('bFrames');
  });

  it('parses known values and falls back on anything else', () => {
    expect(parseMergeBoundaryPolicy('compat')).toBe('compat');
    expect(parseMergeBoundaryPolicy('exactTail')).toBe('exactTail');
    expect(parseMergeBoundaryPolicy('losslessGuard')).toBe('losslessGuard');
    expect(parseMergeBoundaryPolicy(undefined)).toBe(defaultMergeBoundaryPolicy);
    expect(parseMergeBoundaryPolicy('B')).toBe(defaultMergeBoundaryPolicy);
    expect(parseMergeBoundaryPolicy(3)).toBe(defaultMergeBoundaryPolicy);

    expect(parseMergeBoundaryGuard('fixed')).toBe('fixed');
    expect(parseMergeBoundaryGuard('bFrames')).toBe('bFrames');
    expect(parseMergeBoundaryGuard(null)).toBe(defaultMergeBoundaryGuard);
  });
});

describe('getTailGuardFrames', () => {
  it('derives the frame count from the B-frame depth', () => {
    expect(getTailGuardFrames({ guard: 'bFrames', hasBFrames: 2, fps: 60 })).toBe(6);
    expect(getTailGuardFrames({ guard: 'bFrames', hasBFrames: 3, fps: 60 })).toBe(8);
    expect(getTailGuardFrames({ guard: 'bFrames', hasBFrames: 1, fps: 60 })).toBe(6);
    expect(getTailGuardFrames({ guard: 'bFrames', hasBFrames: 0, fps: 60 })).toBe(6);
    expect(getTailGuardFrames({ guard: 'bFrames', hasBFrames: undefined, fps: 60 })).toBe(6);
  });

  it('keeps 0.1 s worth of frames in fixed mode', () => {
    expect(getTailGuardFrames({ guard: 'fixed', hasBFrames: 2, fps: 60 })).toBe(6);
    expect(getTailGuardFrames({ guard: 'fixed', hasBFrames: 2, fps: 30 })).toBe(3);
    expect(getTailGuardFrames({ guard: 'fixed', hasBFrames: 2, fps: undefined })).toBe(6);
  });
});

describe('getCutTailGuardSeconds', () => {
  it('converts the B-frame guard to seconds', () => {
    expect(getCutTailGuardSeconds({ guard: 'bFrames', hasBFrames: 2, fps: 60 })).toBeCloseTo(0.1, 6);
    expect(getCutTailGuardSeconds({ guard: 'bFrames', hasBFrames: 2, fps: 30 })).toBeCloseTo(0.2, 6);
  });

  it('is always 0.1 s in fixed mode, whatever the frame rate', () => {
    expect(getCutTailGuardSeconds({ guard: 'fixed', hasBFrames: 2, fps: 60 })).toBe(fixedGuardSeconds);
    expect(getCutTailGuardSeconds({ guard: 'fixed', hasBFrames: 2, fps: 23.976 })).toBe(fixedGuardSeconds);
  });

  it('assumes 60 fps when the frame rate is unknown', () => {
    expect(getCutTailGuardSeconds({ guard: 'bFrames', hasBFrames: 2, fps: undefined })).toBeCloseTo(0.1, 6);
    expect(getCutTailGuardSeconds({ guard: 'bFrames', hasBFrames: 2, fps: 0 })).toBeCloseTo(0.1, 6);
    expect(getCutTailGuardSeconds({ guard: 'bFrames', hasBFrames: 2, fps: NaN })).toBeCloseTo(0.1, 6);
  });
});

describe('resolveCutPolicy', () => {
  it('never changes anything for C', () => {
    expect(resolveCutPolicy({ ...merged, policy: 'compat', guard: 'bFrames' })).toStrictEqual({
      repairJoins: false,
      tailGuardSeconds: 0,
      splitNonAvStreams: false,
      shortestBlocked: false,
      repairBlocked: false,
      repairBlockReason: undefined,
      effective: 'compat',
    });
  });

  it('never changes anything in base mode, even for A or B', () => {
    for (const policy of ['losslessGuard', 'exactTail'] as const) {
      const resolved = resolveCutPolicy({ ...merged, policy, guard: 'bFrames', patchMode: false });
      expect(resolved.effective).toBe('compat');
      expect(resolved.repairJoins).toBe(false);
      expect(resolved.tailGuardSeconds).toBe(0);
    }
  });

  it('repairs a single patch result too, because it may be merged later', () => {
    // `resolveCutPolicy` no longer knows whether this export also merges: a result that is exported on
    // its own must get the same cut, or the repair could never be added after the fact.
    for (const policy of ['losslessGuard', 'exactTail'] as const) {
      const resolved = resolveCutPolicy({ ...merged, policy, guard: 'bFrames' });
      expect(resolved.effective).toBe(policy);
      expect(resolved.repairJoins).toBe(true);
    }
  });

  it('repairs the joins and keeps the guard for A', () => {
    expect(resolveCutPolicy({ ...merged, policy: 'losslessGuard', guard: 'bFrames' })).toStrictEqual({
      repairJoins: true,
      tailGuardSeconds: 0.1,
      splitNonAvStreams: false,
      shortestBlocked: false,
      repairBlocked: false,
      repairBlockReason: undefined,
      effective: 'losslessGuard',
    });
  });

  it('uses the fixed guard for A when asked', () => {
    expect(resolveCutPolicy({ ...merged, policy: 'losslessGuard', guard: 'fixed', detectedFps: 30 }).tailGuardSeconds).toBe(fixedGuardSeconds);
  });

  it('repairs the joins without a guard for B', () => {
    expect(resolveCutPolicy({ ...merged, policy: 'exactTail', guard: 'bFrames' })).toStrictEqual({
      repairJoins: true,
      tailGuardSeconds: 0,
      splitNonAvStreams: false,
      shortestBlocked: false,
      repairBlocked: false,
      repairBlockReason: undefined,
      effective: 'exactTail',
    });
  });

  it('never repairs an audio-only export (there is no video timeline to fix)', () => {
    const resolved = resolveCutPolicy({ ...merged, policy: 'losslessGuard', guard: 'bFrames', hasVideoStream: false });
    expect(resolved.repairJoins).toBe(false);
    expect(resolved.repairBlocked).toBe(false);
    expect(resolved.tailGuardSeconds).toBe(0);
  });

  it('does not repair joins when another file\'s track is copied (smart cut only cuts the main file)', () => {
    for (const policy of ['losslessGuard', 'exactTail'] as const) {
      const resolved = resolveCutPolicy({ ...merged, policy, guard: 'bFrames', hasExternalStreams: true });
      expect(resolved.repairJoins).toBe(false);
      expect(resolved.repairBlocked).toBe(true);
      // A guard without the repair would only add content the user did not ask for.
      expect(resolved.tailGuardSeconds).toBe(0);
    }
  });

  it('does not repair joins when a subtitle or data track is copied', () => {
    for (const policy of ['losslessGuard', 'exactTail'] as const) {
      const resolved = resolveCutPolicy({ ...merged, policy, guard: 'bFrames', hasNonAvStreams: true });
      expect(resolved.repairJoins).toBe(false);
      expect(resolved.repairBlocked).toBe(true);
    }
  });

  it('does not repair joins for a codec whose re-encoded boundaries break the copied middle', () => {
    for (const policy of ['losslessGuard', 'exactTail'] as const) {
      for (const videoCodec of ['hevc', 'av1', 'vp9', undefined]) {
        const resolved = resolveCutPolicy({ ...merged, policy, guard: 'bFrames', videoCodec });
        expect(resolved.repairJoins).toBe(false);
        expect(resolved.repairBlocked).toBe(true);
        expect(resolved.repairBlockReason).toBe('codec');
        expect(resolved.tailGuardSeconds).toBe(0);
      }
    }
  });

  it('does not repair joins for a rotated source (the re-encode would rotate only one part)', () => {
    for (const rotation of [90, 270, -90]) {
      const resolved = resolveCutPolicy({ ...merged, policy: 'losslessGuard', guard: 'bFrames', rotation });
      expect(resolved.repairJoins).toBe(false);
      expect(resolved.repairBlocked).toBe(true);
      expect(resolved.repairBlockReason).toBe('rotation');
    }
    // 0 and full turns are not a rotation, and undefined is the common case.
    for (const rotation of [0, 360, -360, undefined]) {
      expect(resolveCutPolicy({ ...merged, policy: 'losslessGuard', guard: 'bFrames', rotation }).repairJoins).toBe(true);
    }
  });

  it('does not repair joins when the frame rate is unknown (the re-encode needs it)', () => {
    for (const detectedFps of [undefined, 0, NaN, Infinity]) {
      const resolved = resolveCutPolicy({ ...merged, policy: 'losslessGuard', guard: 'bFrames', detectedFps });
      expect(resolved.repairJoins).toBe(false);
      expect(resolved.repairBlocked).toBe(true);
      expect(resolved.repairBlockReason).toBe('fps');
      // A guard without the repair would only add content the user did not ask for.
      expect(resolved.tailGuardSeconds).toBe(0);
    }
    // Any positive rate is enough: the repair is not tied to a specific frame rate.
    for (const detectedFps of [23.976, 25, 60]) {
      expect(resolveCutPolicy({ ...merged, policy: 'losslessGuard', guard: 'bFrames', detectedFps }).repairJoins).toBe(true);
    }
  });

  it('reports the copied-stream rule before the codec and rotation rules', () => {
    const resolved = resolveCutPolicy({ ...merged, policy: 'losslessGuard', guard: 'bFrames', hasNonAvStreams: true, videoCodec: 'hevc', rotation: 90 });
    expect(resolved.repairBlockReason).toBe('streams');
  });

  it('reports the codec rule before rotation and the frame rate', () => {
    const resolved = resolveCutPolicy({ ...merged, policy: 'losslessGuard', guard: 'bFrames', videoCodec: 'hevc', rotation: 90, detectedFps: undefined });
    expect(resolved.repairBlockReason).toBe('codec');
  });

  it('reports the rotation rule before the frame rate', () => {
    const resolved = resolveCutPolicy({ ...merged, policy: 'losslessGuard', guard: 'bFrames', rotation: 90, detectedFps: undefined });
    expect(resolved.repairBlockReason).toBe('rotation');
  });

  it('blames no rule for an audio-only file: there is no video join to repair', () => {
    const resolved = resolveCutPolicy({ ...merged, policy: 'losslessGuard', guard: 'bFrames', hasVideoStream: false, videoCodec: undefined });
    expect(resolved.repairJoins).toBe(false);
    expect(resolved.repairBlocked).toBe(false);
    expect(resolved.repairBlockReason).toBeUndefined();
  });

  it('repairs the joins when the audio is short: the repair does not use -shortest', () => {
    const resolved = resolveCutPolicy({ ...merged, policy: 'losslessGuard', guard: 'bFrames', hasShortAudioStream: true });
    expect(resolved.repairJoins).toBe(true);
    expect(resolved.repairBlocked).toBe(false);
  });

  it('cuts the subtitle/data tracks in a separate pass only when -shortest is requested', () => {
    const withShortest = resolveCutPolicy({ ...merged, policy: 'losslessGuard', guard: 'bFrames', hasNonAvStreams: true, hasAudioStream: true, shortestRequested: true });
    expect(withShortest.splitNonAvStreams).toBe(true);
    expect(withShortest.shortestBlocked).toBe(false);

    const withoutShortest = resolveCutPolicy({ ...merged, policy: 'losslessGuard', guard: 'bFrames', hasNonAvStreams: true, hasAudioStream: true });
    expect(withoutShortest.splitNonAvStreams).toBe(false);
  });

  it('reports a blocked -shortest for a short audio track even when the other tracks are split out', () => {
    // The split only moves the subtitle/data tracks away. The video/audio pass is still cut with
    // `-shortest`, so a short audio track would end it before the video does.
    const resolved = resolveCutPolicy({ ...merged, policy: 'losslessGuard', guard: 'bFrames', hasNonAvStreams: true, hasAudioStream: true, hasShortAudioStream: true, shortestRequested: true });
    expect(resolved.splitNonAvStreams).toBe(true);
    expect(resolved.shortestBlocked).toBe(true);
  });

  it('cannot split when there is no audio track to end the video/audio pass', () => {
    const resolved = resolveCutPolicy({ ...merged, policy: 'losslessGuard', guard: 'bFrames', hasNonAvStreams: true, hasAudioStream: false, shortestRequested: true });
    expect(resolved.splitNonAvStreams).toBe(false);
    expect(resolved.shortestBlocked).toBe(true);
  });

  it('does not split when a track comes from another file', () => {
    const resolved = resolveCutPolicy({ ...merged, policy: 'losslessGuard', guard: 'bFrames', hasNonAvStreams: true, hasAudioStream: true, hasExternalStreams: true, shortestRequested: true });
    expect(resolved.splitNonAvStreams).toBe(false);
    expect(resolved.shortestBlocked).toBe(true);
  });

  it('reports a blocked -shortest for a short audio track', () => {
    const resolved = resolveCutPolicy({ ...merged, policy: 'losslessGuard', guard: 'bFrames', hasShortAudioStream: true, shortestRequested: true });
    expect(resolved.shortestBlocked).toBe(true);
  });

  it('never splits without a non audio/video track', () => {
    const resolved = resolveCutPolicy({ ...merged, policy: 'losslessGuard', guard: 'bFrames', hasAudioStream: true, shortestRequested: true });
    expect(resolved.splitNonAvStreams).toBe(false);
    expect(resolved.shortestBlocked).toBe(false);
  });
});

describe('getPatchCutSignature', () => {
  const base = { policy: 'losslessGuard', guard: 'bFrames', repairJoins: true, tailGuardSeconds: 0.1 } as const;

  it('is stable for the same cut', () => {
    expect(getPatchCutSignature(base)).toStrictEqual(getPatchCutSignature({ ...base }));
  });

  it('changes when any field of the cut changes', () => {
    const signature = JSON.stringify(getPatchCutSignature(base));
    const variants = [
      { ...base, policy: 'exactTail' },
      { ...base, policy: 'compat' },
      { ...base, guard: 'fixed' },
      { ...base, repairJoins: false },
      { ...base, tailGuardSeconds: 0 },
    ] as const;
    for (const variant of variants) {
      expect(JSON.stringify(getPatchCutSignature(variant))).not.toBe(signature);
    }
  });

  it('changes when the damaged source starts being repaired', () => {
    // A clip exported before the repair is a lossless copy that still stutters, so it must not be
    // reused for an export that now repairs the video.
    const signature = JSON.stringify(getPatchCutSignature(base));
    expect(JSON.stringify(getPatchCutSignature({ ...base, repairVideoEncode: true }))).not.toBe(signature);
  });

  it('treats a missing repair flag as not repairing', () => {
    expect(getPatchCutSignature(base)).toStrictEqual(getPatchCutSignature({ ...base, repairVideoEncode: false }));
  });
});
