// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { parseSourceHealth, summarizeSourceHealth } from './parse.js';

/** The lines ffmpeg printed for the user's 4K download that lost one packet at the start. */
const realStderr = [
  '[h264 @ 000001c3ea7e7cc0] Invalid NAL unit size (1946157056 > 2349).',
  '[h264 @ 000001c3ea7e7cc0] missing picture in access unit with size 2353',
  '[h264 @ 000001c3ea7e7cc0] Invalid NAL unit size (1946157056 > 2349).',
  '[h264 @ 000001c3ea7e7cc0] Error splitting the input into NAL units.',
].join('\n');

describe('parseSourceHealth', () => {
  it('recognises the damage a dropped packet at the file head leaves behind', () => {
    expect(parseSourceHealth(realStderr)).toStrictEqual({
      damaged: true,
      invalidNalUnit: true,
      missingPicture: true,
      splitFailed: true,
      errorCount: 4,
    });
  });

  it('recognises a single invalid NAL unit line', () => {
    expect(parseSourceHealth('[h264 @ 0x1] Invalid NAL unit size (12 > 3).')).toStrictEqual({
      damaged: true,
      invalidNalUnit: true,
      missingPicture: false,
      splitFailed: false,
      errorCount: 1,
    });
  });

  it('does not report a healthy file', () => {
    expect(parseSourceHealth('')).toStrictEqual({
      damaged: false,
      invalidNalUnit: false,
      missingPicture: false,
      splitFailed: false,
      errorCount: 0,
    });
    const healthy = [
      '[mov,mp4,m4a,3gp,3g2,mj2 @ 0x1] moov atom not found',
      '[h264 @ 0x2] Reinit context to 3840x2160, pix_fmt: yuv420p',
    ].join('\n');
    expect(parseSourceHealth(healthy).damaged).toBe(false);
  });

  it('does not mistake the message of another codec for NAL damage', () => {
    expect(parseSourceHealth('[hevc @ 0x1] Could not find ref with POC 12').damaged).toBe(false);
  });

  it('summarises into the value the UI uses', () => {
    expect(summarizeSourceHealth(parseSourceHealth(realStderr))).toBe('damaged-head-gop');
    expect(summarizeSourceHealth(parseSourceHealth(''))).toBe('ok');
  });
});
