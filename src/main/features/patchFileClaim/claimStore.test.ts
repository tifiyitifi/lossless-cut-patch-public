// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, test } from 'vitest';
import { join } from 'node:path';

import { createPatchClaimStore } from './claimStore.js';
import type { PatchClaimFsDeps } from './claimStore.js';
import { fileClaimFileName } from '../../../common/features/patchFileClaim/index.js';

function eexist() {
  return Object.assign(new Error('exists'), { code: 'EEXIST' });
}

function enoent() {
  return Object.assign(new Error('missing'), { code: 'ENOENT' });
}

function createFakeFs({ initial, alive, now = 1000, pid = 100 }: {
  initial?: Record<string, string>;
  alive?: (holderPid: number) => boolean;
  now?: number;
  pid?: number;
}) {
  const files = new Map(Object.entries(initial ?? {}));
  const deps: PatchClaimFsDeps = {
    mkdir: async () => undefined,
    openExclusive: async (path) => {
      if (files.has(path)) throw eexist();
      files.set(path, '');
      return {
        write: async (text: string) => { files.set(path, text); },
        close: async () => undefined,
      };
    },
    readFile: async (path) => {
      const value = files.get(path);
      if (value == null) throw enoent();
      return value;
    },
    readdir: async (dir) => {
      const normalizedDir = dir.replaceAll('\\', '/').replace(/\/+$/, '');
      return [...files.keys()]
        .map((path) => path.replaceAll('\\', '/'))
        .filter((path) => path.startsWith(`${normalizedDir}/`))
        .map((path) => path.slice(normalizedDir.length + 1));
    },
    unlink: async (path) => {
      if (!files.delete(path)) throw enoent();
    },
    isPidAlive: (holderPid) => (alive ?? (() => true))(holderPid),
    now: () => now,
    pid,
  };
  return { files, deps };
}

const claimsDir = 'C:/config/open-sources';
const videoA = 'C:/Videos/A.mp4';
const claimPathFor = (path: string, prefix = 'source') => join(claimsDir, fileClaimFileName({ path, caseInsensitive: true, prefix }));

describe('claim', () => {
  test('claims a video for this window', async () => {
    const { files, deps } = createFakeFs({ pid: 100, now: 500 });
    const store = createPatchClaimStore({ prefix: 'source', deps });

    await expect(store.claim({ path: videoA, claimsDir, caseInsensitive: true })).resolves.toStrictEqual({ ok: true });
    expect(store.heldPaths()).toStrictEqual(['c:/videos/a.mp4']);
    expect(JSON.parse(files.get(claimPathFor(videoA))!)).toStrictEqual({ pid: 100, startedAt: 500, path: 'c:/videos/a.mp4' });
  });

  test('refuses a video another live window has open', async () => {
    const initial = { [claimPathFor(videoA)]: JSON.stringify({ pid: 7, startedAt: 900, path: 'c:/videos/a.mp4' }) };
    const store = createPatchClaimStore({ prefix: 'source', deps: createFakeFs({ initial, alive: () => true }).deps });

    await expect(store.claim({ path: videoA, claimsDir, caseInsensitive: true })).resolves.toStrictEqual({
      ok: false, reason: 'busy', holder: { path: 'c:/videos/a.mp4', pid: 7 },
    });
    expect(store.heldPaths()).toStrictEqual([]);
  });

  test('takes over the claim of a dead window', async () => {
    const initial = { [claimPathFor(videoA)]: JSON.stringify({ pid: 7, startedAt: 900, path: 'c:/videos/a.mp4' }) };
    const store = createPatchClaimStore({ prefix: 'source', deps: createFakeFs({ initial, alive: () => false, pid: 100 }).deps });

    await expect(store.claim({ path: videoA, claimsDir, caseInsensitive: true })).resolves.toStrictEqual({ ok: true });
  });

  test('the same window may reopen its video', async () => {
    const store = createPatchClaimStore({ prefix: 'source', deps: createFakeFs({ pid: 100 }).deps });
    await store.claim({ path: videoA, claimsDir, caseInsensitive: true });

    await expect(store.claim({ path: videoA, claimsDir, caseInsensitive: true })).resolves.toStrictEqual({ ok: true });
    expect(store.heldPaths()).toStrictEqual(['c:/videos/a.mp4']);
  });

  test('claiming another video releases the previous claim (one file per window)', async () => {
    const { files, deps } = createFakeFs({ pid: 100 });
    const store = createPatchClaimStore({ prefix: 'source', deps });
    const videoB = 'C:/Videos/B.mp4';
    await store.claim({ path: videoA, claimsDir, caseInsensitive: true });
    await store.claim({ path: videoB, claimsDir, caseInsensitive: true });

    expect(store.heldPaths()).toStrictEqual(['c:/videos/b.mp4']);
    expect(files.has(claimPathFor(videoA))).toBe(false);
    expect(files.has(claimPathFor(videoB))).toBe(true);
  });

  test('serializes two claims so the last one wins', async () => {
    const videoB = 'C:/Videos/B.mp4';
    const { files, deps } = createFakeFs({ pid: 100 });
    // Hold the older claim inside the file system, so the newer one would finish first without the
    // queue - and the older one would then release the newer claim's file.
    let openA: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { openA = resolve; });
    const slowDeps: PatchClaimFsDeps = {
      ...deps,
      openExclusive: async (path) => {
        if (path === claimPathFor(videoA)) await gate;
        return deps.openExclusive(path);
      },
    };
    const store = createPatchClaimStore({ prefix: 'source', deps: slowDeps });

    const first = store.claim({ path: videoA, claimsDir, caseInsensitive: true });
    const second = store.claim({ path: videoB, claimsDir, caseInsensitive: true });
    openA();
    await Promise.all([first, second]);

    expect(store.heldPaths()).toStrictEqual(['c:/videos/b.mp4']);
    expect(files.has(claimPathFor(videoA))).toBe(false);
  });

  test('an unreadable claim file does not block the open', async () => {
    const initial = { [claimPathFor(videoA)]: 'garbage' };
    const store = createPatchClaimStore({ prefix: 'source', deps: createFakeFs({ initial, pid: 100 }).deps });

    await expect(store.claim({ path: videoA, claimsDir, caseInsensitive: true })).resolves.toStrictEqual({ ok: true });
  });

  test('reports a file system error instead of claiming', async () => {
    const { deps } = createFakeFs({});
    const store = createPatchClaimStore({
      prefix: 'source',
      deps: { ...deps, mkdir: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } },
    });

    await expect(store.claim({ path: videoA, claimsDir, caseInsensitive: true })).resolves.toStrictEqual({
      ok: false, reason: 'error', message: 'denied',
    });
  });
});

describe('release', () => {
  test('releases the claims of this window', async () => {
    const { files, deps } = createFakeFs({ pid: 100 });
    const store = createPatchClaimStore({ prefix: 'source', deps });
    await store.claim({ path: videoA, claimsDir, caseInsensitive: true });

    await store.release();

    expect(store.heldPaths()).toStrictEqual([]);
    expect(files.size).toBe(0);
  });

  test('two stores do not release each other’s claims', async () => {
    // The app runs two of them: a window holds one source and one playing result.
    const { files, deps } = createFakeFs({ pid: 100 });
    const sources = createPatchClaimStore({ prefix: 'source', deps });
    const results = createPatchClaimStore({ prefix: 'result', deps });
    await sources.claim({ path: videoA, claimsDir, caseInsensitive: true });
    await results.claim({ path: videoA, claimsDir, caseInsensitive: true });

    await results.release();

    expect(sources.heldPaths()).toStrictEqual(['c:/videos/a.mp4']);
    expect(files.has(claimPathFor(videoA, 'source'))).toBe(true);
    expect(files.has(claimPathFor(videoA, 'result'))).toBe(false);
  });

  test('leaves a claim file another window took over', async () => {
    const { files, deps } = createFakeFs({ pid: 100 });
    const store = createPatchClaimStore({ prefix: 'source', deps });
    await store.claim({ path: videoA, claimsDir, caseInsensitive: true });

    // The other window read this pid as dead and claimed the same file itself.
    files.set(claimPathFor(videoA, 'source'), JSON.stringify({ pid: 7, startedAt: 2000, path: 'c:/videos/a.mp4' }));

    await store.release();

    expect(store.heldPaths()).toStrictEqual([]);
    expect(files.has(claimPathFor(videoA, 'source'))).toBe(true);
  });
});

describe('sweep', () => {
  test('removes the claims of dead windows and keeps the live ones', async () => {
    const live = claimPathFor('C:/Videos/Live.mp4');
    const dead = claimPathFor('C:/Videos/Dead.mp4');
    const { files, deps } = createFakeFs({
      initial: {
        [live]: JSON.stringify({ pid: 5, startedAt: 900, path: 'c:/videos/live.mp4' }),
        [dead]: JSON.stringify({ pid: 6, startedAt: 900, path: 'c:/videos/dead.mp4' }),
        'C:/config/open-sources/notes.txt': 'not a claim',
      },
      alive: (holderPid) => holderPid === 5,
    });
    const store = createPatchClaimStore({ prefix: 'source', deps });

    await expect(store.sweep({ claimsDir })).resolves.toBe(1);
    expect(files.has(live)).toBe(true);
    expect(files.has(dead)).toBe(false);
    expect(files.has('C:/config/open-sources/notes.txt')).toBe(true);
  });

  test('does nothing when the claims directory does not exist', async () => {
    const { deps } = createFakeFs({});
    const store = createPatchClaimStore({
      prefix: 'source',
      deps: { ...deps, readdir: async () => { throw enoent(); } },
    });

    await expect(store.sweep({ claimsDir: 'C:/missing' })).resolves.toBe(0);
  });
});

describe('findClaimedElsewhere', () => {
  const claimedBy = (path: string, pid: number) => JSON.stringify({ pid, startedAt: 900, path });

  test('reports a file another live window plays', async () => {
    const initial = { [claimPathFor('C:/clips/a.mp4', 'result')]: claimedBy('c:/clips/a.mp4', 7) };
    const store = createPatchClaimStore({ prefix: 'result', deps: createFakeFs({ initial, alive: () => true, pid: 100 }).deps });

    await expect(store.findClaimedElsewhere({ claimsDir, paths: ['C:/clips/a.mp4'], caseInsensitive: true })).resolves.toStrictEqual(['C:/clips/a.mp4']);
  });

  test('ignores this window’s own playback', async () => {
    const initial = { [claimPathFor('C:/clips/a.mp4', 'result')]: claimedBy('c:/clips/a.mp4', 100) };
    const store = createPatchClaimStore({ prefix: 'result', deps: createFakeFs({ initial, alive: () => true, pid: 100 }).deps });

    await expect(store.findClaimedElsewhere({ claimsDir, paths: ['C:/clips/a.mp4'], caseInsensitive: true })).resolves.toStrictEqual([]);
  });

  test('ignores a dead window, a missing claim and another path', async () => {
    const initial = {
      [claimPathFor('C:/clips/dead.mp4', 'result')]: claimedBy('c:/clips/dead.mp4', 7),
      [claimPathFor('C:/clips/other.mp4', 'result')]: claimedBy('c:/clips/other.mp4', 8),
    };
    const store = createPatchClaimStore({ prefix: 'result', deps: createFakeFs({ initial, alive: (pid) => pid === 8, pid: 100 }).deps });

    await expect(store.findClaimedElsewhere({
      claimsDir,
      paths: ['C:/clips/dead.mp4', 'C:/clips/free.mp4'],
      caseInsensitive: true,
    })).resolves.toStrictEqual([]);
  });

  test('does not read claims of the other kind', async () => {
    const initial = { [claimPathFor('C:/clips/a.mp4', 'source')]: claimedBy('c:/clips/a.mp4', 7) };
    const store = createPatchClaimStore({ prefix: 'result', deps: createFakeFs({ initial, alive: () => true, pid: 100 }).deps });

    await expect(store.findClaimedElsewhere({ claimsDir, paths: ['C:/clips/a.mp4'], caseInsensitive: true })).resolves.toStrictEqual([]);
  });
});
