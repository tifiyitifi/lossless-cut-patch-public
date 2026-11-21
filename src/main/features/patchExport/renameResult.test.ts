// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it, vi } from 'vitest';

import { renameResult, renameResultLocked, resolveRenameWorkRoot } from './renameResult.js';
import type { PatchRenameDeps, PatchRenameLockDeps } from './renameResult.js';

function lockError() {
  return Object.assign(new Error('locked'), { code: 'EPERM' });
}

function deps(overrides: Partial<PatchRenameDeps> = {}): PatchRenameDeps {
  return {
    renameFile: async () => undefined,
    fileExists: async () => false,
    updateManifest: async () => ({ updated: true }),
    getConfiguredWorkRoot: () => undefined,
    delay: async () => undefined,
    logWarning: () => undefined,
    ...overrides,
  };
}

describe('renameResult', () => {
  it('renames the file and follows it in the manifest', async () => {
    const renameFile = vi.fn<(from: string, to: string) => Promise<void>>(async () => undefined);
    const updateManifest = vi.fn(async () => ({ updated: true }));

    const outcome = await renameResult({ from: '/clips/a.mp4', to: '/clips/a-renamed.mp4', sourcePath: '/source.mp4' }, deps({ renameFile, updateManifest }));

    expect(outcome).toStrictEqual({ ok: true, manifestUpdated: true });
    expect(renameFile).toHaveBeenCalledWith('/clips/a.mp4', '/clips/a-renamed.mp4');
    // The manifest update is one atomic call (read-modify-write in the manifest queue). The source
    // is part of it: only the record of that source follows the rename.
    expect(updateManifest).toHaveBeenCalledWith('/', { from: '/clips/a.mp4', to: '/clips/a-renamed.mp4', label: undefined, sourcePath: '/source.mp4' });
  });

  it('updates the manifest of the area the result is in, not the configured work root', async () => {
    const updateManifest = vi.fn(async () => ({ updated: true }));

    const outcome = await renameResult(
      { from: 'C:/old/losslesscut_finished/finished_clips/a.mp4', to: 'C:/old/losslesscut_finished/finished_clips/b.mp4' },
      deps({ updateManifest, getConfiguredWorkRoot: () => 'C:/current' }),
    );

    expect(outcome).toStrictEqual({ ok: true, manifestUpdated: true });
    expect(updateManifest).toHaveBeenCalledWith('C:/old', {
      from: 'C:/old/losslesscut_finished/finished_clips/a.mp4',
      to: 'C:/old/losslesscut_finished/finished_clips/b.mp4',
      label: undefined,
      sourcePath: undefined,
    });
  });

  it('passes the new label to the manifest', async () => {
    const updateManifest = vi.fn(async () => ({ updated: true }));

    const outcome = await renameResult({ from: '/clips/a.mp4', to: '/clips/opening.mp4', sourcePath: '/source.mp4', label: 'opening' }, deps({ updateManifest }));

    expect(outcome).toStrictEqual({ ok: true, manifestUpdated: true });
    expect(updateManifest).toHaveBeenCalledWith('/', { from: '/clips/a.mp4', to: '/clips/opening.mp4', label: 'opening', sourcePath: '/source.mp4' });
  });

  it('succeeds even when the manifest does not know the file', async () => {
    const renameFile = vi.fn(async () => undefined);
    const updateManifest = vi.fn(async () => ({ updated: false }));

    const outcome = await renameResult({ from: '/clips/foreign.mp4', to: '/clips/other.mp4', sourcePath: '/source.mp4' }, deps({ renameFile, updateManifest }));

    expect(outcome).toStrictEqual({ ok: true, manifestUpdated: false });
    expect(renameFile).toHaveBeenCalledTimes(1);
  });

  it('refuses to overwrite an existing file', async () => {
    const renameFile = vi.fn(async () => undefined);

    const outcome = await renameResult({ from: '/clips/a.mp4', to: '/clips/taken.mp4' }, deps({
      renameFile,
      fileExists: async (path) => path === '/clips/taken.mp4',
    }));

    expect(outcome).toStrictEqual({ ok: false, reason: 'exists', manifestUpdated: false });
    expect(renameFile).not.toHaveBeenCalled();
  });

  it('renames a path that only differs in case on a case-insensitive file system', async () => {
    const renameFile = vi.fn(async () => undefined);
    const fileExists = vi.fn(async () => true);
    const updateManifest = vi.fn(async () => ({ updated: true }));

    const outcome = await renameResult({ from: '/clips/a.mp4', to: '/clips/A.mp4', sourcePath: '/source.mp4' }, deps({
      renameFile,
      fileExists,
      updateManifest,
      caseInsensitiveFs: true,
    }));

    expect(outcome).toStrictEqual({ ok: true, manifestUpdated: true });
    expect(renameFile).toHaveBeenCalledWith('/clips/a.mp4', '/clips/A.mp4');
    expect(fileExists).not.toHaveBeenCalled();
  });

  it('does nothing when only the separators differ', async () => {
    const renameFile = vi.fn<(from: string, to: string) => Promise<void>>(async () => undefined);
    const fileExists = vi.fn(async () => true);
    const updateManifest = vi.fn(async () => ({ updated: true }));

    // The same file, spelled with other separators: it does not have to move. A rename would
    // touch the file (and fail when it is open).
    const outcome = await renameResult({ from: String.raw`C:\clips\a.mp4`, to: 'C:/clips/a.mp4', sourcePath: '/source.mp4' }, deps({
      renameFile,
      fileExists,
      updateManifest,
      caseInsensitiveFs: true,
      backslashIsSeparator: true,
    }));

    expect(outcome).toStrictEqual({ ok: true, manifestUpdated: true });
    expect(renameFile).not.toHaveBeenCalled();
    expect(fileExists).not.toHaveBeenCalled();
    // The manifest learns the spelling the user asked for (it is the same file).
    expect(updateManifest).toHaveBeenCalledWith('/', { from: String.raw`C:\clips\a.mp4`, to: 'C:/clips/a.mp4', label: undefined, sourcePath: '/source.mp4' });
  });

  it('passes the new label to the manifest when only the separators differ', async () => {
    const updateManifest = vi.fn(async () => ({ updated: true }));

    const outcome = await renameResult({ from: String.raw`C:\clips\a.mp4`, to: 'C:/clips/a.mp4', sourcePath: '/source.mp4', label: 'opening' }, deps({
      updateManifest,
      caseInsensitiveFs: true,
      backslashIsSeparator: true,
    }));

    expect(outcome).toStrictEqual({ ok: true, manifestUpdated: true });
    expect(updateManifest).toHaveBeenCalledWith('/', { from: String.raw`C:\clips\a.mp4`, to: 'C:/clips/a.mp4', label: 'opening', sourcePath: '/source.mp4' });
  });

  it('keeps the rename when only the separators differ and the manifest cannot be updated', async () => {
    const updateManifest = vi.fn(async () => { throw new Error('disk full'); });

    // Nothing moved, so there is nothing to undo: the manifest keeps the old spelling of the same
    // file, which the next export still finds.
    const outcome = await renameResult({ from: String.raw`C:\clips\a.mp4`, to: 'C:/clips/a.mp4', sourcePath: '/source.mp4' }, deps({
      updateManifest,
      caseInsensitiveFs: true,
      backslashIsSeparator: true,
    }));

    expect(outcome).toStrictEqual({ ok: true, manifestUpdated: false });
  });

  it('renames a path that only differs in its separators when the backslash is an ordinary character', async () => {
    const renameFile = vi.fn<(from: string, to: string) => Promise<void>>(async () => undefined);

    // On macOS and Linux a backslash is part of the file name: `a\b` and `a/b` are two files.
    const outcome = await renameResult({ from: String.raw`/clips/a\b.mp4`, to: '/clips/a/b.mp4', sourcePath: '/source.mp4' }, deps({
      renameFile,
      caseInsensitiveFs: true,
      backslashIsSeparator: false,
    }));

    expect(outcome.ok).toBe(true);
    expect(renameFile).toHaveBeenCalledWith(String.raw`/clips/a\b.mp4`, '/clips/a/b.mp4');
  });

  it('still refuses an existing target for a case-only change on a case-sensitive file system', async () => {
    const renameFile = vi.fn(async () => undefined);

    const outcome = await renameResult({ from: '/clips/a.mp4', to: '/clips/A.mp4' }, deps({
      renameFile,
      fileExists: async () => true,
      caseInsensitiveFs: false,
    }));

    expect(outcome).toStrictEqual({ ok: false, reason: 'exists', manifestUpdated: false });
    expect(renameFile).not.toHaveBeenCalled();
  });

  it('retries while Windows still holds the file', async () => {
    const renameFile = vi.fn(async () => {
      if (renameFile.mock.calls.length < 3) throw lockError();
    });

    const outcome = await renameResult({ from: '/clips/a.mp4', to: '/clips/a-renamed.mp4', sourcePath: '/source.mp4' }, deps({ renameFile }));

    expect(outcome.ok).toBe(true);
    expect(renameFile).toHaveBeenCalledTimes(3);
  });

  it('gives up when the file stays locked', async () => {
    const renameFile = vi.fn(async () => { throw lockError(); });

    const outcome = await renameResult({ from: '/clips/a.mp4', to: '/clips/a-renamed.mp4' }, deps({ renameFile }));

    expect(outcome).toStrictEqual({ ok: false, reason: 'locked', manifestUpdated: false });
    expect(renameFile.mock.calls.length).toBeGreaterThan(1);
  });

  it('undoes the rename when the manifest cannot be updated', async () => {
    const renameFile = vi.fn(async () => undefined);

    const outcome = await renameResult({ from: '/clips/a.mp4', to: '/clips/a-renamed.mp4', sourcePath: '/source.mp4' }, deps({
      renameFile,
      updateManifest: async () => { throw new Error('disk full'); },
    }));

    expect(outcome).toStrictEqual({ ok: false, reason: 'manifest', manifestUpdated: false });
    expect(renameFile).toHaveBeenNthCalledWith(1, '/clips/a.mp4', '/clips/a-renamed.mp4');
    expect(renameFile).toHaveBeenNthCalledWith(2, '/clips/a-renamed.mp4', '/clips/a.mp4');
  });

  it('retries the undo while the renamed file is still held', async () => {
    // The undo has to be as patient as the rename itself: a player may open the file in the moment
    // between the rename and the manifest write, and a lost undo leaves the disk and the manifest
    // disagreeing - the one state the rollback exists to prevent.
    let undoAttempts = 0;
    const renameFile = vi.fn(async (_from: string, to: string) => {
      if (to === '/clips/a.mp4') {
        undoAttempts += 1;
        if (undoAttempts < 3) throw lockError();
      }
      return undefined;
    });

    const outcome = await renameResult({ from: '/clips/a.mp4', to: '/clips/a-renamed.mp4', sourcePath: '/source.mp4' }, deps({
      renameFile,
      updateManifest: async () => { throw new Error('disk full'); },
    }));

    expect(outcome).toStrictEqual({ ok: false, reason: 'manifest', manifestUpdated: false });
    // Forward, then two failed undos, then the successful one.
    expect(renameFile.mock.calls.map(([from, to]) => [from, to])).toStrictEqual([
      ['/clips/a.mp4', '/clips/a-renamed.mp4'],
      ['/clips/a-renamed.mp4', '/clips/a.mp4'],
      ['/clips/a-renamed.mp4', '/clips/a.mp4'],
      ['/clips/a-renamed.mp4', '/clips/a.mp4'],
    ]);
  });

  it('reports a rollback that stays blocked instead of claiming the file was moved back', async () => {
    const logWarning = vi.fn();
    const renameFile = vi.fn(async (_from: string, to: string) => {
      if (to === '/clips/a.mp4') throw lockError();
      return undefined;
    });

    const outcome = await renameResult({ from: '/clips/a.mp4', to: '/clips/a-renamed.mp4', sourcePath: '/source.mp4' }, deps({
      renameFile,
      logWarning,
      updateManifest: async () => { throw new Error('disk full'); },
    }));

    expect(outcome).toStrictEqual({ ok: false, reason: 'manifest', manifestUpdated: false });
    expect(logWarning).toHaveBeenCalledOnce();
  });

  it('renames without a source path (nothing to update)', async () => {
    const renameFile = vi.fn(async () => undefined);
    const updateManifest = vi.fn(async () => ({ updated: true }));

    const outcome = await renameResult({ from: '/clips/a.mp4', to: '/clips/a-renamed.mp4' }, deps({ renameFile, updateManifest }));

    expect(outcome).toStrictEqual({ ok: true, manifestUpdated: false });
    expect(updateManifest).not.toHaveBeenCalled();
  });

  it('does nothing when the path does not change', async () => {
    const renameFile = vi.fn(async () => undefined);

    const outcome = await renameResult({ from: '/clips/a.mp4', to: '/clips/a.mp4' }, deps({ renameFile }));

    expect(outcome).toStrictEqual({ ok: true, manifestUpdated: false });
    expect(renameFile).not.toHaveBeenCalled();
  });
});

function lockDeps(overrides: Partial<PatchRenameLockDeps> = {}): PatchRenameLockDeps {
  return {
    acquireLock: async () => ({ ok: true }),
    releaseLock: async () => undefined,
    ...overrides,
  };
}

describe('resolveRenameWorkRoot', () => {
  it('uses the finished area the result is in, not the configured work root', () => {
    const root = resolveRenameWorkRoot({ from: 'C:/old/losslesscut_finished/finished_clips/a.mp4' }, () => 'C:/current');

    expect(root).toBe('C:/old');
  });

  it('uses the work area the result is in, not the configured work root', () => {
    const root = resolveRenameWorkRoot({ from: 'C:/old/.losslesscut_work/clips/a.mp4' }, () => 'C:/current');

    expect(root).toBe('C:/old');
  });

  it('keeps the source path when the result is outside every area', () => {
    // No configured root: the source's own folder above the clip (`/`), exactly as before.
    const root = resolveRenameWorkRoot({ from: '/clips/a.mp4', sourcePath: '/source.mp4' }, () => undefined);

    expect(root).toBe('/');
  });

  it('keeps the configured root when the result is outside every area and there is no source', () => {
    const root = resolveRenameWorkRoot({ from: '/clips/a.mp4' }, () => '/configured');

    expect(root).toBe('/configured');
  });
});

describe('renameResultLocked', () => {
  it('refuses the rename while another window holds the work area', async () => {
    const renameFile = vi.fn(async () => undefined);
    const updateManifest = vi.fn(async () => ({ updated: true }));
    const releaseLock = vi.fn(async () => undefined);

    const outcome = await renameResultLocked(
      { from: '/clips/a.mp4', to: '/clips/b.mp4', sourcePath: '/source.mp4' },
      deps({ renameFile, updateManifest }),
      lockDeps({ acquireLock: async () => ({ ok: false, reason: 'busy' }), releaseLock }),
    );

    expect(outcome).toStrictEqual({ ok: false, reason: 'busy', manifestUpdated: false });
    expect(renameFile).not.toHaveBeenCalled();
    expect(updateManifest).not.toHaveBeenCalled();
    // Nothing was taken, so nothing may be released (that would delete the other window's lock).
    expect(releaseLock).not.toHaveBeenCalled();
  });

  it('refuses a rename of a file another window is playing', async () => {
    const renameFile = vi.fn(async () => undefined);
    const updateManifest = vi.fn(async () => ({ updated: true }));

    const outcome = await renameResultLocked(
      { from: '/clips/a.mp4', to: '/clips/b.mp4', sourcePath: '/source.mp4' },
      deps({ renameFile, updateManifest }),
      lockDeps({ findInUse: async (paths) => [...paths] }),
    );

    expect(outcome).toStrictEqual({ ok: false, reason: 'in-use', manifestUpdated: false });
    expect(renameFile).not.toHaveBeenCalled();
    expect(updateManifest).not.toHaveBeenCalled();
  });

  it('renames when the file is not being played', async () => {
    const renameFile = vi.fn(async () => undefined);

    const outcome = await renameResultLocked(
      { from: '/clips/a.mp4', to: '/clips/b.mp4', sourcePath: '/source.mp4' },
      deps({ renameFile }),
      lockDeps({ findInUse: async () => [] }),
    );

    expect(outcome.ok).toBe(true);
    expect(renameFile).toHaveBeenCalledWith('/clips/a.mp4', '/clips/b.mp4');
  });

  it('reports other lock errors as a plain failure', async () => {
    const renameFile = vi.fn(async () => undefined);

    const outcome = await renameResultLocked(
      { from: '/clips/a.mp4', to: '/clips/b.mp4', sourcePath: '/source.mp4' },
      deps({ renameFile }),
      lockDeps({ acquireLock: async () => ({ ok: false, reason: 'error' }) }),
    );

    expect(outcome).toStrictEqual({ ok: false, reason: 'failed', manifestUpdated: false });
    expect(renameFile).not.toHaveBeenCalled();
  });

  it('takes the lock on the work area the rename updates, and releases it afterwards', async () => {
    const acquireLock = vi.fn(async () => ({ ok: true as const }));
    const releaseLock = vi.fn(async () => undefined);

    const outcome = await renameResultLocked(
      { from: '/source/.losslesscut_work/clips/a.mp4', to: '/source/.losslesscut_work/clips/b.mp4', sourcePath: '/source/v.mp4' },
      deps(),
      lockDeps({ acquireLock, releaseLock }),
    );

    expect(outcome).toStrictEqual({ ok: true, manifestUpdated: true });
    // Same root the manifest lives in (the folder above the work area), not the clip's own folder.
    expect(acquireLock).toHaveBeenCalledWith('/source');
    expect(releaseLock).toHaveBeenCalledWith('/source');
  });

  it('takes the lock on the area of a result outside the configured work root', async () => {
    const acquireLock = vi.fn(async () => ({ ok: true as const }));
    const releaseLock = vi.fn(async () => undefined);

    const outcome = await renameResultLocked(
      { from: 'C:/old/.losslesscut_work/clips/a.mp4', to: 'C:/old/.losslesscut_work/clips/b.mp4' },
      deps({ getConfiguredWorkRoot: () => 'C:/current' }),
      lockDeps({ acquireLock, releaseLock }),
    );

    expect(outcome).toStrictEqual({ ok: true, manifestUpdated: true });
    expect(acquireLock).toHaveBeenCalledWith('C:/old');
    expect(releaseLock).toHaveBeenCalledWith('C:/old');
  });

  it('releases the lock when the rename throws', async () => {
    const releaseLock = vi.fn(async () => undefined);

    await expect(renameResultLocked(
      { from: '/clips/a.mp4', to: '/clips/b.mp4', sourcePath: '/source.mp4' },
      deps({ fileExists: async () => { throw new Error('boom'); } }),
      lockDeps({ releaseLock }),
    )).rejects.toThrow('boom');

    expect(releaseLock).toHaveBeenCalledWith('/');
  });

  it('does not touch the lock when the path does not change', async () => {
    const acquireLock = vi.fn(async () => ({ ok: true as const }));

    const outcome = await renameResultLocked(
      { from: '/clips/a.mp4', to: '/clips/a.mp4' },
      deps(),
      lockDeps({ acquireLock }),
    );

    expect(outcome).toStrictEqual({ ok: true, manifestUpdated: false });
    expect(acquireLock).not.toHaveBeenCalled();
  });
});
