// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it, vi } from 'vitest';

// The real modules pull in electron (the logger) and spawn ffprobe: stub both, the parsing is what
// this test is about (the pure parser has its own test file).
vi.mock('../../ffmpeg.js', () => ({ runFfprobe: vi.fn() }));
vi.mock('../../logger.js', () => ({ default: { warn: vi.fn(), info: vi.fn() } }));

// eslint-disable-next-line import-js/no-extraneous-dependencies
const { runFfprobe } = await import('../../ffmpeg.js');
const { scanPatchSourceHealth } = await import('./scan.js');

const ffprobeMock = vi.mocked(runFfprobe);

/**
The stderr the user's damaged download made ffprobe print while exiting successfully.

A plain `Uint8Array` on purpose: that is what execa returns, and its `toString()` is a list of
byte values, not text (the reason this scanner decodes explicitly).
*/
const damagedStderr = new TextEncoder().encode([
  '[h264 @ 00000231b0de0d00] Invalid NAL unit size (1946157056 > 2349).',
  '[h264 @ 00000231b0de0d00] missing picture in access unit with size 2353',
  '[h264 @ 00000231b0de0d00] Error splitting the input into NAL units.',
].join('\r\n'));

describe('scanPatchSourceHealth', () => {
  it('reports a damaged head GOP from the probe stderr', async () => {
    // @ts-expect-error the real execa result has more fields than the scanner reads
    ffprobeMock.mockResolvedValue({ stderr: damagedStderr, exitCode: 0 });

    await expect(scanPatchSourceHealth('/videos/a.mp4')).resolves.toStrictEqual({
      health: 'damaged-head-gop',
      errorCount: 3,
      detail: '[h264 @ 00000231b0de0d00] Invalid NAL unit size (1946157056 > 2349).',
    });
    expect(ffprobeMock).toHaveBeenCalledWith(
      ['-hide_banner', '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', '/videos/a.mp4'],
      { logCli: false },
    );
  });

  it('reports a healthy file', async () => {
    // @ts-expect-error the real execa result has more fields than the scanner reads
    ffprobeMock.mockResolvedValue({ stderr: new Uint8Array(), exitCode: 0 });
    await expect(scanPatchSourceHealth('/videos/b.mp4')).resolves.toStrictEqual({ health: 'ok', errorCount: 0, detail: undefined });
  });

  it('says nothing when the probe cannot run', async () => {
    ffprobeMock.mockRejectedValue(new Error('ENOENT'));
    await expect(scanPatchSourceHealth('/videos/c.mp4')).resolves.toStrictEqual({ health: 'unknown', errorCount: 0, detail: undefined });
  });
});
