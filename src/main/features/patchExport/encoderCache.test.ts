// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it, vi } from 'vitest';

import { createFfmpegEncoderCache } from './encoderCache.js';

describe('createFfmpegEncoderCache', () => {
  it('probes once per ffmpeg path', async () => {
    const probe = vi.fn(async () => ['libx264']);
    const list = createFfmpegEncoderCache({ getPath: () => 'ffmpeg-a', probe });

    await expect(list()).resolves.toStrictEqual(['libx264']);
    await expect(list()).resolves.toStrictEqual(['libx264']);

    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('probes again when the configured ffmpeg changes', async () => {
    let path = 'ffmpeg-a';
    const probe = vi.fn(async () => [path]);
    const list = createFfmpegEncoderCache({ getPath: () => path, probe });

    await expect(list()).resolves.toStrictEqual(['ffmpeg-a']);
    path = 'ffmpeg-b';
    await expect(list()).resolves.toStrictEqual(['ffmpeg-b']);

    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('keeps a failed probe as undefined instead of retrying on every call', async () => {
    const probe = vi.fn(async () => undefined);
    const list = createFfmpegEncoderCache({ getPath: () => 'ffmpeg-a', probe });

    await expect(list()).resolves.toBeUndefined();
    await expect(list()).resolves.toBeUndefined();

    expect(probe).toHaveBeenCalledTimes(1);
  });
});
