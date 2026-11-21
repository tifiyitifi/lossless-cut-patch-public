// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { downloadUpdatePackage, fetchUpdateText, UpdateDownloadError } from './download.js';
import type { FetchImpl } from './download.js';

const payload = Buffer.from('a windows x64 package, in spirit');
const digest = createHash('sha256').update(payload).digest('hex');

const asset = (overrides: Partial<{ name: string; url: string; size: number }> = {}) => ({
  name: 'LosslessCut-Patch-win-x64.zip',
  url: 'https://example.test/z',
  size: payload.length,
  ...overrides,
});

// A Response whose body arrives in several chunks, so the streaming path is the one under test.
const streamed = (bytes: Buffer, chunkSize = 7): Response => new Response(new ReadableStream<Uint8Array>({
  start(controller) {
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      controller.enqueue(new Uint8Array(bytes.subarray(offset, offset + chunkSize)));
    }
    controller.close();
  },
}), { status: 200 });

const withTempDir = async (run: (dir: string) => Promise<void>) => {
  const dir = await mkdtemp(join(tmpdir(), 'llc-updater-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

describe('downloadUpdatePackage', () => {
  it('writes the package and keeps nothing else behind', async () => {
    await withTempDir(async (dir) => {
      const result = await downloadUpdatePackage({
        asset: asset(),
        expectedSha256: digest,
        targetDir: dir,
        fetchImpl: async () => streamed(payload),
      });

      expect(result.bytes).toBe(payload.length);
      await expect(readFile(result.path)).resolves.toStrictEqual(payload);
      await expect(readdir(dir)).resolves.toStrictEqual(['LosslessCut-Patch-win-x64.zip']);
    });
  });

  it('reports progress as the bytes arrive', async () => {
    await withTempDir(async (dir) => {
      const seen: number[] = [];
      await downloadUpdatePackage({
        asset: asset(),
        expectedSha256: digest,
        targetDir: dir,
        fetchImpl: async () => streamed(payload),
        onProgress: ({ received, total }) => { seen.push(received / total); },
      });
      expect(seen.length).toBeGreaterThan(1);
      expect(seen.at(-1)).toBe(1);
    });
  });

  it('deletes a package whose digest does not match', async () => {
    await withTempDir(async (dir) => {
      const run = downloadUpdatePackage({
        asset: asset(),
        expectedSha256: 'b'.repeat(64),
        targetDir: dir,
        fetchImpl: async () => streamed(payload),
      });

      await expect(run).rejects.toMatchObject({ reason: 'checksum' });
      await expect(readdir(dir)).resolves.toStrictEqual([]);
    });
  });

  it('refuses a package the release did not publish a digest for', async () => {
    await withTempDir(async (dir) => {
      const run = downloadUpdatePackage({
        asset: asset(),
        targetDir: dir,
        fetchImpl: async () => streamed(payload),
      });
      await expect(run).rejects.toMatchObject({ reason: 'checksum' });
    });
  });

  it('deletes a truncated transfer', async () => {
    await withTempDir(async (dir) => {
      const run = downloadUpdatePackage({
        asset: asset({ size: payload.length + 10 }),
        expectedSha256: digest,
        targetDir: dir,
        fetchImpl: async () => streamed(payload),
      });

      await expect(run).rejects.toMatchObject({ reason: 'size' });
      await expect(readdir(dir)).resolves.toStrictEqual([]);
    });
  });

  it('stops a transfer that outgrows the advertised size', async () => {
    await withTempDir(async (dir) => {
      const run = downloadUpdatePackage({
        asset: asset({ size: 5 }),
        expectedSha256: digest,
        targetDir: dir,
        fetchImpl: async () => streamed(payload),
      });
      await expect(run).rejects.toMatchObject({ reason: 'size' });
    });
  });

  it('reports an HTTP error instead of writing its body', async () => {
    await withTempDir(async (dir) => {
      const run = downloadUpdatePackage({
        asset: asset(),
        expectedSha256: digest,
        targetDir: dir,
        fetchImpl: async () => new Response('nope', { status: 404 }),
      });
      await expect(run).rejects.toMatchObject({ reason: 'http', detail: '404' });
    });
  });

  it('reports an unreachable host', async () => {
    await withTempDir(async (dir) => {
      const run = downloadUpdatePackage({
        asset: asset(),
        expectedSha256: digest,
        targetDir: dir,
        fetchImpl: async () => { throw new TypeError('fetch failed'); },
      });
      await expect(run).rejects.toMatchObject({ reason: 'network' });
    });
  });

  it('reports a user cancel as cancelled, not as a failure', async () => {
    await withTempDir(async (dir) => {
      const controller = new AbortController();
      const run = downloadUpdatePackage({
        asset: asset(),
        expectedSha256: digest,
        targetDir: dir,
        signal: controller.signal,
        fetchImpl: async () => {
          controller.abort();
          throw new DOMException('aborted', 'AbortError');
        },
      });
      await expect(run).rejects.toMatchObject({ reason: 'cancelled' });
    });
  });

  it('refuses an asset name that is not a plain file name', async () => {
    await withTempDir(async (dir) => {
      const run = downloadUpdatePackage({
        asset: asset({ name: '../evil.zip' }),
        expectedSha256: digest,
        targetDir: dir,
        fetchImpl: async () => streamed(payload),
      });
      await expect(run).rejects.toBeInstanceOf(UpdateDownloadError);
      await expect(run).rejects.toMatchObject({ reason: 'name' });
    });
  });
});

describe('fetchUpdateText', () => {
  it('reads the checksum file', async () => {
    const fetchImpl: FetchImpl = async () => new Response(`${digest}  package.zip`);
    await expect(fetchUpdateText({ asset: asset({ name: 'SHA256SUMS.txt' }), fetchImpl }))
      .resolves.toContain(digest);
  });

  it('reports an HTTP error', async () => {
    const fetchImpl: FetchImpl = async () => new Response('nope', { status: 403 });
    await expect(fetchUpdateText({ asset: asset(), fetchImpl })).rejects.toMatchObject({ reason: 'http', detail: '403' });
  });

  it('refuses a body the size of a package', async () => {
    const fetchImpl: FetchImpl = async () => new Response('x'.repeat(1024 * 1024 + 1));
    await expect(fetchUpdateText({ asset: asset(), fetchImpl })).rejects.toMatchObject({ reason: 'http' });
  });
});
