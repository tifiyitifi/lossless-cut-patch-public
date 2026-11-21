// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { getDeepCheckArgs, parseDeepCheckProgressLine, runPatchDeepCheck, summarizeDeepCheckFailure } from './deepCheck.js';

describe('getDeepCheckArgs', () => {
  it('decodes the whole file to the null muxer and stops at the first error', () => {
    const args = getDeepCheckArgs('C:/work/.losslesscut_work/detached_src_media/a.mp4');

    expect(args).toContain('-xerror');
    expect(args.slice(-3)).toStrictEqual(['-f', 'null', '-']);
    // Only what a player uses: a broken subtitle must not fail the check.
    expect(args).toContain('0:v:0?');
    expect(args).toContain('0:a?');
    expect(args).toContain('C:/work/.losslesscut_work/detached_src_media/a.mp4');
  });
});

describe('parseDeepCheckProgressLine', () => {
  it('reads the decoded position', () => {
    expect(parseDeepCheckProgressLine('out_time_us=2500000', 10)).toStrictEqual({ seconds: 2.5, ratio: 0.25 });
  });

  it('reports the position without a ratio when the duration is unknown', () => {
    expect(parseDeepCheckProgressLine('out_time_us=2500000', undefined)).toStrictEqual({ seconds: 2.5 });
    expect(parseDeepCheckProgressLine('out_time_us=2500000', 0)).toStrictEqual({ seconds: 2.5 });
  });

  it('never reports more than all of the file', () => {
    expect(parseDeepCheckProgressLine('out_time_us=12000000', 10)).toStrictEqual({ seconds: 12, ratio: 1 });
  });

  it('ignores every other line', () => {
    expect(parseDeepCheckProgressLine('progress=continue', 10)).toBeUndefined();
    expect(parseDeepCheckProgressLine('frame=12', 10)).toBeUndefined();
    expect(parseDeepCheckProgressLine('out_time_us=N/A', 10)).toBeUndefined();
  });
});

describe('summarizeDeepCheckFailure', () => {
  it('drops the component prefix and keeps the message', () => {
    expect(summarizeDeepCheckFailure('[mov,mp4,m4a,3gp,3g2,mj2 @ 000001c2] moov atom not found\n')).toBe('moov atom not found');
  });

  it('takes the first non-empty line', () => {
    expect(summarizeDeepCheckFailure('\n\na.mp4: Invalid data found when processing input\n[decoder] more\n')).toBe('a.mp4: Invalid data found when processing input');
  });

  it('cuts a message that is too long to read', () => {
    const summary = summarizeDeepCheckFailure('x'.repeat(400));
    expect(summary).toHaveLength(201);
    expect(summary?.endsWith('…')).toBe(true);
  });

  it('returns nothing for empty output', () => {
    expect(summarizeDeepCheckFailure('  \n\n')).toBeUndefined();
  });
});

describe('runPatchDeepCheck', () => {
  it('passes the progress of the run on and reports a clean decode', async () => {
    const progress: number[] = [];
    const result = await runPatchDeepCheck({ path: 'a.mp4', durationSeconds: 10, onProgress: (value) => { if (value.ratio != null) progress.push(value.ratio); } }, {
      run: async (_args, { onLine }) => {
        onLine('out_time_us=5000000');
        onLine('out_time_us=10000000');
        return { exitCode: 0, stderr: '', canceled: false };
      },
    });

    expect(result).toStrictEqual({ status: 'ok' });
    expect(progress).toStrictEqual([0.5, 1]);
  });

  it('reports where a damaged file stopped', async () => {
    const result = await runPatchDeepCheck({ path: 'a.mp4', durationSeconds: 10 }, {
      run: async (_args, { onLine }) => {
        onLine('out_time_us=3000000');
        return { exitCode: 1, stderr: '[h264 @ 1] error while decoding MB 12 34\n', canceled: false };
      },
    });

    expect(result).toStrictEqual({ status: 'failed', message: 'error while decoding MB 12 34', atSeconds: 3 });
  });

  it('reports a cancelled run instead of a failure', async () => {
    const result = await runPatchDeepCheck({ path: 'a.mp4', durationSeconds: 10 }, {
      run: async () => ({ exitCode: 1, stderr: 'SIGKILL', canceled: true }),
    });

    expect(result).toStrictEqual({ status: 'canceled' });
  });

  it('reports a run that could not start as unavailable', async () => {
    const result = await runPatchDeepCheck({ path: 'a.mp4', durationSeconds: 10 }, {
      run: async () => { throw new Error('ffmpeg not found'); },
    });

    expect(result).toStrictEqual({ status: 'unavailable', message: 'ffmpeg not found' });
  });
});
