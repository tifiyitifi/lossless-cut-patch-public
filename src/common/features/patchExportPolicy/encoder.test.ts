// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { getJoinRepairEncoder, parseFfmpegEncoders, resolveJoinRepairEncoder } from './encoder.js';

describe('getJoinRepairEncoder', () => {
  it('pins h264 to the software encoder instead of letting ffmpeg pick one', () => {
    expect(getJoinRepairEncoder('h264')).toBe('libx264');
  });

  it('leaves a codec it has no pin for alone', () => {
    expect(getJoinRepairEncoder('hevc')).toBe('hevc');
    expect(getJoinRepairEncoder('libsvtav1')).toBe('libsvtav1');
    expect(getJoinRepairEncoder('vp9')).toBe('vp9');
  });
});

describe('parseFfmpegEncoders', () => {
  it('reads encoder names out of a real -encoders listing and ignores the legend', () => {
    const stdout = `
Encoders:
 V..... = Video
 A..... = Audio
 S..... = Subtitle
 .F.... = Frame-level multithreading
 ..S... = Slice-level multithreading
 ...X.. = Codec is experimental
 ....B. = Supports draw_horiz_band
 .....D = Supports direct rendering method 1
 ------
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 V....D libx264rgb           libx264rgb H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 RGB (codec h264)
 V....D h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)
 V..... libsvtav1            SVT-AV1(Scalable Video Technology for AV1) encoder (codec av1)
 A....D aac                  AAC (Advanced Audio Coding)
`;
    const encoders = parseFfmpegEncoders(stdout);
    expect(encoders).toStrictEqual(new Set(['libx264', 'libx264rgb', 'h264_nvenc', 'libsvtav1', 'aac']));
  });

  it('returns an empty set for output without encoders', () => {
    expect(parseFfmpegEncoders('')).toStrictEqual(new Set());
    expect(parseFfmpegEncoders('Unknown encoder whatever')).toStrictEqual(new Set());
  });
});

describe('resolveJoinRepairEncoder', () => {
  const libx264Available = new Set(['libx264', 'aac']);

  it('uses the pinned encoder when the build has it', () => {
    expect(resolveJoinRepairEncoder({ detectedCodec: 'h264', available: libx264Available }))
      .toStrictEqual({ encoder: 'libx264', fellBack: false });
  });

  it('falls back to the codec name when the build has no libx264', () => {
    expect(resolveJoinRepairEncoder({ detectedCodec: 'h264', available: new Set(['aac']) }))
      .toStrictEqual({ encoder: 'h264', fellBack: true });
  });

  it('keeps the pinned encoder when the listing failed, instead of guessing', () => {
    expect(resolveJoinRepairEncoder({ detectedCodec: 'h264', available: undefined }))
      .toStrictEqual({ encoder: 'libx264', fellBack: false });
  });

  it('does not report a fallback for a codec that has no pin', () => {
    expect(resolveJoinRepairEncoder({ detectedCodec: 'hevc', available: new Set(['aac']) }))
      .toStrictEqual({ encoder: 'hevc', fellBack: false });
  });
});
