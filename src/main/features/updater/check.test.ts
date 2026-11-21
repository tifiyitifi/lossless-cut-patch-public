// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { checkForUpdate } from './check.js';
import type { FetchImpl } from './check.js';

const payload = {
  tag_name: 'v3.70.2-patch.2',
  html_url: 'https://example.test/releases/tag/v3.70.2-patch.2',
  body: '',
  assets: [
    { name: 'LosslessCut-Patch-win-x64.zip', browser_download_url: 'https://example.test/z', size: 1 },
  ],
};

const response = (status: number, body?: unknown): Response => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
}) as unknown as Response;

const run = (fetchImpl: FetchImpl) => checkForUpdate({ currentVersion: '3.70.2-patch.1', fetchImpl });

describe('checkForUpdate', () => {
  it('reads the newest release and reports an available update', async () => {
    const result = await run(async () => response(200, payload));
    expect(result).toMatchObject({ status: 'available', version: '3.70.2-patch.2' });
  });

  it('treats a 404 as "nothing has been published"', async () => {
    const result = await run(async () => response(404));
    expect(result).toStrictEqual({ status: 'noRelease' });
  });

  it('reports an HTTP failure with its status', async () => {
    const result = await run(async () => response(403));
    expect(result).toStrictEqual({ status: 'failed', reason: 'http', detail: '403' });
  });

  it('reports an unreachable host as a network failure', async () => {
    const result = await run(async () => { throw new TypeError('fetch failed'); });
    expect(result).toMatchObject({ status: 'failed', reason: 'network' });
  });

  it('reports the request deadline as a timeout', async () => {
    const result = await run(async () => {
      throw new DOMException('timed out', 'TimeoutError');
    });
    expect(result).toMatchObject({ status: 'failed', reason: 'timeout' });
  });

  it('reports a body that is not JSON', async () => {
    const result = await run(async () => ({
      status: 200,
      ok: true,
      json: async () => { throw new SyntaxError('unexpected token'); },
    }) as unknown as Response);
    expect(result).toMatchObject({ status: 'failed', reason: 'malformedRelease' });
  });

  it('reports a payload without a tag', async () => {
    const result = await run(async () => response(200, { assets: [] }));
    expect(result).toStrictEqual({ status: 'failed', reason: 'malformedRelease' });
  });

  it('reports a release that only ships the 7z', async () => {
    const result = await run(async () => response(200, {
      ...payload,
      assets: [{ name: 'LosslessCut-Patch-win-x64.7z', browser_download_url: 'a', size: 1 }],
    }));
    expect(result).toStrictEqual({ status: 'failed', reason: 'noAsset' });
  });
});
