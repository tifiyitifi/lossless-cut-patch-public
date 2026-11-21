// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { patchSourceFingerprintChunkBytes, readPatchSourceFingerprint } from './fingerprint.js';

const chunk = patchSourceFingerprintChunkBytes;

/** A fake file that records the ranges read from it. */
function fakeFile(bytes: Buffer) {
  const reads: { start: number, length: number }[] = [];
  return {
    reads,
    deps: {
      stat: async () => ({ size: bytes.length }),
      readRange: async (_path: string, start: number, length: number) => {
        reads.push({ start, length });
        return bytes.subarray(start, Math.min(bytes.length, start + length));
      },
    },
  };
}

describe('readPatchSourceFingerprint', () => {
  it('hashes the size and the two ends of a large file', async () => {
    const file = fakeFile(Buffer.alloc(chunk + 10, 7));
    const fingerprint = await readPatchSourceFingerprint('/v/a.mp4', file.deps);

    expect(fingerprint?.size).toBe(chunk + 10);
    expect(fingerprint?.hash).toMatch(/^[0-9a-f]{64}$/);
    // One megabyte from each end, not the hundreds of megabytes in between.
    expect(file.reads).toStrictEqual([{ start: 0, length: chunk }, { start: 10, length: chunk }]);
  });

  it('reads a short file once and does not ask for a tail', async () => {
    const file = fakeFile(Buffer.alloc(5, 1));
    const fingerprint = await readPatchSourceFingerprint('/v/a.mp4', file.deps);

    expect(fingerprint?.size).toBe(5);
    expect(file.reads).toStrictEqual([{ start: 0, length: 5 }]);
  });

  it('gives the same file the same fingerprint and another size a different one', async () => {
    const same = await readPatchSourceFingerprint('/v/a.mp4', fakeFile(Buffer.alloc(chunk + 10, 7)).deps);
    const copy = await readPatchSourceFingerprint('/v/b.mp4', fakeFile(Buffer.alloc(chunk + 10, 7)).deps);
    const truncated = await readPatchSourceFingerprint('/v/b.mp4', fakeFile(Buffer.alloc(chunk + 11, 7)).deps);

    expect(copy?.hash).toBe(same?.hash);
    expect(truncated?.hash).not.toBe(same?.hash);
  });

  it('has no fingerprint when the file cannot be read', async () => {
    await expect(readPatchSourceFingerprint('/v/a.mp4', {
      stat: async () => { throw Object.assign(new Error('gone'), { code: 'ENOENT' }); },
    })).resolves.toBeUndefined();

    await expect(readPatchSourceFingerprint('/v/a.mp4', {
      stat: async () => ({ size: 10 }),
      readRange: async () => { throw Object.assign(new Error('locked'), { code: 'EBUSY' }); },
    })).resolves.toBeUndefined();
  });
});
