// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { createPatchOverviewCache } from './cache.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('createPatchOverviewCache', () => {
  it('shares one running scan between concurrent requests', async () => {
    const gate = deferred<string>();
    let builds = 0;
    const cache = createPatchOverviewCache(() => { builds += 1; return gate.promise; });

    const first = cache.get(String.raw`C:\work`);
    const second = cache.get(String.raw`C:\work`);
    expect(builds).toBe(1);
    gate.resolve('overview');
    await expect(first).resolves.toBe('overview');
    await expect(second).resolves.toBe('overview');
    expect(builds).toBe(1);
  });

  it('reuses a finished scan inside the ttl and scans again after it', async () => {
    let clock = 1000;
    let builds = 0;
    const cache = createPatchOverviewCache(async () => { builds += 1; return 'overview'; }, { now: () => clock, ttlMs: 3000 });

    await cache.get(String.raw`C:\work`);
    await cache.get(String.raw`C:\work`);
    expect(builds).toBe(1);

    clock += 3000;
    await cache.get(String.raw`C:\work`);
    expect(builds).toBe(2);
  });

  it('scans right away when the caller forces a refresh', async () => {
    let builds = 0;
    const cache = createPatchOverviewCache(async () => { builds += 1; return 'overview'; });
    await cache.get(String.raw`C:\work`);
    await cache.get(String.raw`C:\work`, { force: true });
    expect(builds).toBe(2);
  });

  it('shares a running scan even when the request is forced', async () => {
    const gate = deferred<string>();
    let builds = 0;
    const cache = createPatchOverviewCache(() => { builds += 1; return gate.promise; });
    const first = cache.get(String.raw`C:\work`);
    const second = cache.get(String.raw`C:\work`, { force: true });
    expect(builds).toBe(1);
    gate.resolve('overview');
    await expect(Promise.all([first, second])).resolves.toStrictEqual(['overview', 'overview']);
  });

  it('drops a failed scan so the next request retries', async () => {
    let builds = 0;
    const cache = createPatchOverviewCache(async () => {
      builds += 1;
      if (builds === 1) throw new Error('unreadable');
      return 'overview';
    });

    await expect(cache.get(String.raw`C:\work`)).rejects.toThrow('unreadable');
    await expect(cache.get(String.raw`C:\work`)).resolves.toBe('overview');
    expect(builds).toBe(2);
  });

  it('keeps roots apart and forgets one on invalidate', async () => {
    let builds = 0;
    const cache = createPatchOverviewCache(async (root) => { builds += 1; return root ?? 'none'; });

    await expect(cache.get(String.raw`C:\a`)).resolves.toBe(String.raw`C:\a`);
    await expect(cache.get(String.raw`C:\b`)).resolves.toBe(String.raw`C:\b`);
    expect(builds).toBe(2);

    cache.invalidate(String.raw`C:\a`);
    await cache.get(String.raw`C:\b`);
    expect(builds).toBe(2);
    await expect(cache.get(String.raw`C:\a`)).resolves.toBe(String.raw`C:\a`);
    expect(builds).toBe(3);
  });

  it('treats one work area written in another spelling as the same entry', async () => {
    let builds = 0;
    const cache = createPatchOverviewCache(async () => { builds += 1; return 'overview'; }, { caseInsensitive: true });

    // The same root arrives from the history, from the cutting window and from a stored setting:
    // separators, a trailing separator and the case must not split it into separate scans.
    await cache.get(String.raw`C:\work`);
    await cache.get('c:/work/');
    expect(builds).toBe(1);

    // And a delete that invalidates one spelling must reach the entry the other spelling created.
    cache.invalidate(String.raw`C:\WORK`);
    await cache.get(String.raw`C:\work`);
    expect(builds).toBe(2);
  });

  it('keeps differently cased roots apart on a case-sensitive file system', async () => {
    let builds = 0;
    const cache = createPatchOverviewCache(async () => { builds += 1; return 'overview'; });

    await cache.get(String.raw`C:\work`);
    await cache.get(String.raw`C:\WORK`);
    expect(builds).toBe(2);
  });

  it('caches the no-root scan too', async () => {
    let builds = 0;
    const cache = createPatchOverviewCache(async () => { builds += 1; return 'overview'; });
    await cache.get(undefined);
    await cache.get(undefined);
    expect(builds).toBe(1);
  });
});
