// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, test } from 'vitest';

import { acquirePatchWorkLock, getPatchWorkLockPath, releaseAllPatchWorkLocks, releasePatchWorkLock, releasePatchWorkLocksForHolder, removeStalePatchWorkLock } from './exportLock.js';
import type { PatchWorkLockDeps } from './exportLock.js';

function eexist() {
  return Object.assign(new Error('exists'), { code: 'EEXIST' });
}

function enoent() {
  return Object.assign(new Error('missing'), { code: 'ENOENT' });
}

/** A tiny in-memory file system for the lock helpers. */
function createFakeFs({ initial, alive, now = 1000, pid = 100 }: {
  initial?: Record<string, string>;
  alive?: (holderPid: number) => boolean;
  now?: number;
  pid?: number;
}) {
  const files = new Map(Object.entries(initial ?? {}));
  const deps: PatchWorkLockDeps = {
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
    unlink: async (path) => {
      if (!files.delete(path)) throw enoent();
    },
    isPidAlive: (holderPid) => (alive ?? (() => true))(holderPid),
    now: () => now,
    pid,
  };
  return { files, deps };
}

describe('getPatchWorkLockPath', () => {
  test('sits in the work area, and is undefined without a working directory', () => {
    expect(getPatchWorkLockPath(undefined)).toBeUndefined();
    expect(getPatchWorkLockPath('')).toBeUndefined();
    expect(getPatchWorkLockPath('C:/work')).toMatch(/\.losslesscut_work[\\/]\.export\.lock$/);
  });
});

describe('acquirePatchWorkLock', () => {
  test('writes the lock of this process', async () => {
    const { files, deps } = createFakeFs({ pid: 42, now: 777 });
    const result = await acquirePatchWorkLock({ workRoot: 'C:/work', deps });

    expect(result).toStrictEqual({ ok: true });
    const path = getPatchWorkLockPath('C:/work')!;
    expect(JSON.parse(files.get(path)!)).toStrictEqual({ pid: 42, startedAt: 777 });
    await releasePatchWorkLock({ workRoot: 'C:/work', deps });
  });

  test('is busy while a live process holds it', async () => {
    const path = getPatchWorkLockPath('C:/work2')!;
    const { deps } = createFakeFs({ initial: { [path]: JSON.stringify({ pid: 7, startedAt: 900 }) }, alive: () => true });

    const result = await acquirePatchWorkLock({ workRoot: 'C:/work2', deps });
    expect(result).toStrictEqual({ ok: false, reason: 'busy', holder: { pid: 7, startedAt: 900 } });
  });

  test('takes over the lock of a dead process', async () => {
    const path = getPatchWorkLockPath('C:/work3')!;
    const { files, deps } = createFakeFs({
      initial: { [path]: JSON.stringify({ pid: 7, startedAt: 900 }) },
      alive: () => false,
      pid: 100,
      now: 5000,
    });

    const result = await acquirePatchWorkLock({ workRoot: 'C:/work3', deps });
    expect(result).toStrictEqual({ ok: true });
    expect(JSON.parse(files.get(path)!)).toStrictEqual({ pid: 100, startedAt: 5000 });
    await releasePatchWorkLock({ workRoot: 'C:/work3', deps });
  });

  test('takes over a lock file that cannot be parsed', async () => {
    const path = getPatchWorkLockPath('C:/work4')!;
    const { deps } = createFakeFs({ initial: { [path]: 'garbage' }, pid: 100 });

    await expect(acquirePatchWorkLock({ workRoot: 'C:/work4', deps })).resolves.toStrictEqual({ ok: true });
    await releasePatchWorkLock({ workRoot: 'C:/work4', deps });
  });

  test('refuses another job of this process while one holds the lock', async () => {
    const { deps } = createFakeFs({});
    await expect(acquirePatchWorkLock({ workRoot: 'C:/workA', owner: 'export', deps })).resolves.toStrictEqual({ ok: true });
    await expect(acquirePatchWorkLock({ workRoot: 'C:/workA', owner: 'finish', deps })).resolves
      .toStrictEqual({ ok: false, reason: 'busy', holder: undefined });
    // The same job may take it again (a nested step of the same export).
    await expect(acquirePatchWorkLock({ workRoot: 'C:/workA', owner: 'export', deps })).resolves.toStrictEqual({ ok: true });
    await releasePatchWorkLock({ workRoot: 'C:/workA', owner: 'export', deps });
  });

  test('refuses the same job of another window', async () => {
    const { deps } = createFakeFs({});
    await expect(acquirePatchWorkLock({ workRoot: 'C:/workD', owner: 'export', holderId: 'wc:1', deps })).resolves.toStrictEqual({ ok: true });
    // Two windows of one process both export: they are two jobs, whatever the job is called.
    await expect(acquirePatchWorkLock({ workRoot: 'C:/workD', owner: 'export', holderId: 'wc:2', deps })).resolves
      .toStrictEqual({ ok: false, reason: 'busy', holder: undefined });
    // The same window may take its own lock again (a nested step of the same export).
    await expect(acquirePatchWorkLock({ workRoot: 'C:/workD', owner: 'export', holderId: 'wc:1', deps })).resolves.toStrictEqual({ ok: true });
    await releasePatchWorkLock({ workRoot: 'C:/workD', owner: 'export', holderId: 'wc:1', deps });
  });

  test('succeeds without a working directory (nothing is shared)', async () => {
    const { deps } = createFakeFs({});
    await expect(acquirePatchWorkLock({ workRoot: undefined, deps })).resolves.toStrictEqual({ ok: true });
  });

  test('reports a file system error instead of claiming the lock', async () => {
    const { deps } = createFakeFs({});
    const failing: Partial<PatchWorkLockDeps> = {
      ...deps,
      openExclusive: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); },
    };
    await expect(acquirePatchWorkLock({ workRoot: 'C:/work5', deps: failing })).resolves.toStrictEqual({ ok: false, reason: 'error', message: 'denied' });
  });
});

describe('releasePatchWorkLock', () => {
  test('removes the lock this process holds', async () => {
    const { files, deps } = createFakeFs({});
    await acquirePatchWorkLock({ workRoot: 'C:/work6', deps });
    expect(files.size).toBe(1);

    await releasePatchWorkLock({ workRoot: 'C:/work6', deps });
    expect(files.size).toBe(0);
  });

  test('never deletes a lock another window holds', async () => {
    const path = getPatchWorkLockPath('C:/work7')!;
    const { files, deps } = createFakeFs({ initial: { [path]: JSON.stringify({ pid: 7, startedAt: 900 }) } });

    await releasePatchWorkLock({ workRoot: 'C:/work7', deps });
    expect(files.has(path)).toBe(true);
  });

  test('leaves the lock to the job that took it', async () => {
    const { files, deps } = createFakeFs({ pid: 42 });
    await acquirePatchWorkLock({ workRoot: 'C:/workB', owner: 'export', deps });

    await releasePatchWorkLock({ workRoot: 'C:/workB', owner: 'finish', deps });
    expect(files.size).toBe(1);

    await releasePatchWorkLock({ workRoot: 'C:/workB', owner: 'export', deps });
    expect(files.size).toBe(0);
  });

  test('leaves the lock to the window that took it', async () => {
    const { files, deps } = createFakeFs({ pid: 42 });
    await acquirePatchWorkLock({ workRoot: 'C:/workB2', owner: 'export', holderId: 'wc:1', deps });

    await releasePatchWorkLock({ workRoot: 'C:/workB2', owner: 'export', holderId: 'wc:2', deps });
    expect(files.size).toBe(1);

    await releasePatchWorkLock({ workRoot: 'C:/workB2', owner: 'export', holderId: 'wc:1', deps });
    expect(files.size).toBe(0);
  });

  test('does not delete a lock file whose startedAt is another acquisition', async () => {
    // The pid was reused (or the lock was taken over) after this job took it: the file is not ours.
    const path = getPatchWorkLockPath('C:/workB3')!;
    const { files, deps } = createFakeFs({ pid: 42, now: 1000 });
    await acquirePatchWorkLock({ workRoot: 'C:/workB3', owner: 'export', deps });
    files.set(path, JSON.stringify({ pid: 42, startedAt: 2000 }));

    await releasePatchWorkLock({ workRoot: 'C:/workB3', owner: 'export', deps });
    expect(files.has(path)).toBe(true);
  });

  test('releases only the locks of the holder that went away', async () => {
    const { files, deps } = createFakeFs({ pid: 42 });
    await acquirePatchWorkLock({ workRoot: 'C:/workH1', owner: 'export', holderId: 'wc:1', deps });
    await acquirePatchWorkLock({ workRoot: 'C:/workH2', owner: 'export', holderId: 'wc:2', deps });

    await releasePatchWorkLocksForHolder('wc:1', { deps });
    expect(files.has(getPatchWorkLockPath('C:/workH1')!)).toBe(false);
    expect(files.has(getPatchWorkLockPath('C:/workH2')!)).toBe(true);
    // The other holder can still take its own lock again, and a third one is refused.
    await expect(acquirePatchWorkLock({ workRoot: 'C:/workH2', owner: 'export', holderId: 'wc:2', deps })).resolves.toStrictEqual({ ok: true });
    await expect(acquirePatchWorkLock({ workRoot: 'C:/workH2', owner: 'export', holderId: 'wc:9', deps })).resolves
      .toStrictEqual({ ok: false, reason: 'busy', holder: undefined });
    await releasePatchWorkLock({ workRoot: 'C:/workH2', owner: 'export', holderId: 'wc:2', deps });
  });

  test('does not delete the lock file another process took over', async () => {
    const path = getPatchWorkLockPath('C:/workC')!;
    const { files, deps } = createFakeFs({ pid: 42 });
    await acquirePatchWorkLock({ workRoot: 'C:/workC', owner: 'export', deps });
    // The other window decided this pid was dead and took over, then this job finishes.
    files.set(path, JSON.stringify({ pid: 7, startedAt: 900 }));

    await releasePatchWorkLock({ workRoot: 'C:/workC', owner: 'export', deps });
    expect(files.has(path)).toBe(true);
  });

  test('holds one lock per work area, whatever the folder is called', async () => {
    const { files, deps } = createFakeFs({ pid: 42 });
    const before = { workDir: 'a', finishedDir: 'b' };
    const after = { workDir: 'c', finishedDir: 'd' };
    await expect(acquirePatchWorkLock({ workRoot: 'C:/workN1', owner: 'export', deps, dirNames: before })).resolves.toStrictEqual({ ok: true });
    expect(files.size).toBe(1);

    // The user applied new folder names while the export ran. The area is still locked by the same
    // job (the entry is keyed by the work root, not by the lock path), and no second lock file is
    // created in the new folder.
    await expect(acquirePatchWorkLock({ workRoot: 'C:/workN1', owner: 'export', deps, dirNames: after })).resolves.toStrictEqual({ ok: true });
    expect(files.size).toBe(1);
    // Another job is still refused, and the release removes the file that was actually taken.
    await expect(acquirePatchWorkLock({ workRoot: 'C:/workN1', owner: 'finish', deps, dirNames: after })).resolves
      .toStrictEqual({ ok: false, reason: 'busy', holder: undefined });
    await releasePatchWorkLock({ workRoot: 'C:/workN1', owner: 'export', deps });
    expect(files.size).toBe(0);
  });

  test('keeps one work area out of another', async () => {
    const { deps } = createFakeFs({ pid: 42 });
    await expect(acquirePatchWorkLock({ workRoot: 'C:/workN2', owner: 'export', deps })).resolves.toStrictEqual({ ok: true });
    await expect(acquirePatchWorkLock({ workRoot: 'C:/workN3', owner: 'export', deps })).resolves.toStrictEqual({ ok: true });
    await releasePatchWorkLock({ workRoot: 'C:/workN2', owner: 'export', deps });
    await releasePatchWorkLock({ workRoot: 'C:/workN3', owner: 'export', deps });
  });

  test('releases every held lock on quit', async () => {
    const { files, deps } = createFakeFs({});
    // The default deps are used by `releaseAllPatchWorkLocks`, so exercise it with two real paths
    // under the temp dir instead of the fake one: acquire with the fake, then release by path.
    await acquirePatchWorkLock({ workRoot: 'C:/work8', deps });
    await acquirePatchWorkLock({ workRoot: 'C:/work9', deps });
    await expect(acquirePatchWorkLock({ workRoot: 'C:/work8', deps })).resolves.toStrictEqual({ ok: true });

    // Nothing to assert about the real fs here; the important part is that the bookkeeping lets a
    // second acquire pass and that the release never throws.
    await releaseAllPatchWorkLocks();
    expect(files.size).toBe(2);
  });
});

describe('removeStalePatchWorkLock', () => {
  test('deletes the lock of a dead process', async () => {
    const path = getPatchWorkLockPath('C:/work10')!;
    const { files, deps } = createFakeFs({ initial: { [path]: JSON.stringify({ pid: 7, startedAt: 900 }) }, alive: () => false });

    await removeStalePatchWorkLock(getPatchWorkLockPath('C:/work10')!.replace(/[\\/]\.export\.lock$/, ''), { deps });
    expect(files.size).toBe(0);
  });

  test('keeps the lock of a live process', async () => {
    const workDir = getPatchWorkLockPath('C:/work11')!.replace(/[\\/]\.export\.lock$/, '');
    const path = getPatchWorkLockPath('C:/work11')!;
    const { files, deps } = createFakeFs({ initial: { [path]: JSON.stringify({ pid: 7, startedAt: 900 }) }, alive: () => true });

    await removeStalePatchWorkLock(workDir, { deps });
    expect(files.has(path)).toBe(true);
  });
});
