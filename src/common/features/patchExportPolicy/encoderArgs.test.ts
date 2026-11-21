// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { buildDamageRepairEncodeArgs, buildRepairVideoArgs, getDamageRepairVideoBitrate } from './encoderArgs.js';

describe('buildRepairVideoArgs', () => {
  it('passes only the pixel format for an ordinary 8-bit progressive source', () => {
    expect(buildRepairVideoArgs({ pixFmt: 'yuv420p', fieldOrder: 'progressive' }, 'libx264'))
      .toStrictEqual(['-pix_fmt', 'yuv420p']);
  });

  it('follows a 10-bit HDR source: pixel format and all four colour tags', () => {
    expect(buildRepairVideoArgs({
      pixFmt: 'yuv420p10le',
      fieldOrder: 'progressive',
      colorRange: 'tv',
      colorSpace: 'bt2020nc',
      colorTransfer: 'smpte2084',
      colorPrimaries: 'bt2020',
    }, 'libx264')).toStrictEqual([
      '-pix_fmt', 'yuv420p10le',
      '-vf', 'setparams=range=tv:color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc',
    ]);
  });

  it('keeps an interlaced source interlaced', () => {
    expect(buildRepairVideoArgs({ pixFmt: 'yuv420p', fieldOrder: 'tt' }, 'libx264'))
      .toStrictEqual(['-pix_fmt', 'yuv420p', '-flags', '+ildct+ilme']);
  });

  it('sets the x264 bottom-field-first option for a bff source', () => {
    expect(buildRepairVideoArgs({ pixFmt: 'yuv420p', fieldOrder: 'bb' }, 'libx264'))
      .toStrictEqual(['-pix_fmt', 'yuv420p', '-flags', '+ildct+ilme', '-x264-params', 'bff=1']);
  });

  it('does not pass x264 private options to another encoder', () => {
    expect(buildRepairVideoArgs({ pixFmt: 'yuv420p', fieldOrder: 'bb' }, 'h264'))
      .toStrictEqual(['-pix_fmt', 'yuv420p', '-flags', '+ildct+ilme']);
  });

  it('skips colour tags the source does not set', () => {
    expect(buildRepairVideoArgs({
      pixFmt: 'yuv420p',
      colorRange: 'unknown',
      colorSpace: 'unknown',
      colorTransfer: 'reserved',
      colorPrimaries: undefined,
    }, 'libx264')).toStrictEqual(['-pix_fmt', 'yuv420p']);
  });

  it('yields no arguments when the source has nothing to follow', () => {
    expect(buildRepairVideoArgs({}, 'libx264')).toStrictEqual([]);
  });
});

describe('buildDamageRepairEncodeArgs', () => {
  it('targets a quality encode and forbids reordering for the pinned x264 encoder', () => {
    expect(buildDamageRepairEncodeArgs({ encoder: 'libx264', lossy: false }))
      .toStrictEqual(['-preset', 'veryfast', '-crf', '18', '-bf', '0']);
  });

  it('still forbids reordering when lossy mode picked the encoder and the bitrate', () => {
    expect(buildDamageRepairEncodeArgs({ encoder: 'libx264', lossy: true })).toStrictEqual(['-bf', '0']);
    expect(buildDamageRepairEncodeArgs({ encoder: 'libx265', lossy: true })).toStrictEqual(['-bf', '0']);
  });

  it('does not pass the x264 quality options to another encoder', () => {
    expect(buildDamageRepairEncodeArgs({ encoder: 'h264', lossy: false })).toStrictEqual(['-bf', '0']);
    expect(buildDamageRepairEncodeArgs({ encoder: undefined, lossy: false })).toStrictEqual(['-bf', '0']);
  });
});

describe('getDamageRepairVideoBitrate', () => {
  it('hands the rate control to -crf for the pinned encoder', () => {
    expect(getDamageRepairVideoBitrate({ encoder: 'libx264', sourceBitrate: 8_000_000 })).toBe(0);
  });

  it('keeps the source bitrate for an encoder without the measured -crf path', () => {
    // `-b:v 0` would mean "the encoder's default quality" (libx265: CRF 28), so the video would come
    // back visibly worse than the pinned path without anything saying so.
    expect(getDamageRepairVideoBitrate({ encoder: 'hevc', sourceBitrate: 8_000_000 })).toBe(8_000_000);
    expect(getDamageRepairVideoBitrate({ encoder: undefined, sourceBitrate: 8_000_000 })).toBe(8_000_000);
  });
});
