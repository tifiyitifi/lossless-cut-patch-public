// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { maxBatchDurationPaths, readBatchDurations } from './readBatchDurations.js';

const aMp4 = String.raw`C:\work\inbox\a.mp4`;
const aTs = String.raw`C:\work\inbox\a.ts`;
const bMkv = String.raw`C:\work\inbox\b.mkv`;
const bMp4 = String.raw`C:\work\inbox\b.mp4`;
const cMp4 = String.raw`C:\work\inbox\c.mp4`;

const never = async () => undefined;

describe('readBatchDurations', () => {
  it('prefers the cheap container read and does not start a probe for it', async () => {
    const probed: string[] = [];
    const result = await readBatchDurations([aMp4, bMkv], {
      shallow: async (path) => (path.endsWith('.mp4') ? 12 : 7),
      probe: async (path) => {
        probed.push(path);
        return 99;
      },
    });

    expect(result).toStrictEqual({ [aMp4]: 12, [bMkv]: 7 });
    expect(probed).toStrictEqual([]);
  });

  it('falls back to the probe for the files the container read declines', async () => {
    const result = await readBatchDurations([aTs, bMp4], {
      shallow: async (path) => (path.endsWith('.mp4') ? 12 : undefined),
      probe: async (path) => (path.endsWith('.ts') ? 30 : undefined),
    });

    expect(result).toStrictEqual({ [aTs]: 30, [bMp4]: 12 });
  });

  it('reports an unreadable file as null instead of failing the batch', async () => {
    const result = await readBatchDurations([aMp4], { shallow: never, probe: never });
    expect(result).toStrictEqual({ [aMp4]: null });
  });

  it('treats a zero or non-finite duration as unreadable', async () => {
    const result = await readBatchDurations([aMp4, bMp4, cMp4], {
      shallow: async (path) => {
        if (path.endsWith('a.mp4')) return 0;
        if (path.endsWith('b.mp4')) return NaN;
        return 5;
      },
      probe: never,
    });

    expect(result).toStrictEqual({ [aMp4]: null, [bMp4]: null, [cMp4]: 5 });
  });

  it('survives a source that throws', async () => {
    const result = await readBatchDurations([aMp4], {
      shallow: async () => { throw new Error('header read failed'); },
      probe: async () => 4,
    });
    expect(result).toStrictEqual({ [aMp4]: 4 });
  });

  it('refuses an unbounded request instead of starting thousands of probes', async () => {
    const paths = Array.from({ length: maxBatchDurationPaths + 3 }, (_, index) => String.raw`C:\work\inbox\f${index}.mp4`);
    const result = await readBatchDurations(paths, { shallow: async () => 1, probe: never, concurrency: 50 });
    expect(Object.keys(result)).toHaveLength(maxBatchDurationPaths);
  });

  it('keeps one entry per path', async () => {
    const result = await readBatchDurations([aMp4, aMp4], { shallow: async () => 3, probe: never });
    expect(result).toStrictEqual({ [aMp4]: 3 });
  });

  it('reads with at least one worker, so a zero concurrency cannot report everything unreadable', async () => {
    const result = await readBatchDurations([aMp4, bMp4], { shallow: async () => 4, probe: never, concurrency: 0 });
    expect(result).toStrictEqual({ [aMp4]: 4, [bMp4]: 4 });
  });
});
