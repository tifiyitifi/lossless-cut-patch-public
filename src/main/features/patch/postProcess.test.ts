// eslint-disable-next-line import-js/no-extraneous-dependencies
import { join } from 'node:path';

// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it, vi } from 'vitest';

import type { PatchPostProcessDeps } from './postProcess.js';
import { postProcessSource, resolveFreeTargetPath } from './postProcess.js';

function makeDeps(overrides: Partial<PatchPostProcessDeps> = {}): PatchPostProcessDeps {
  return {
    exists: async () => false,
    move: async () => undefined,
    trash: async () => undefined,
    ...overrides,
  };
}

describe('resolveFreeTargetPath', () => {
  it('uses the plain name when it is free', async () => {
    await expect(resolveFreeTargetPath('/out', 'a.mp4', async () => false)).resolves.toBe(join('/out', 'a.mp4'));
  });

  it('adds a numeric suffix when the name is taken', async () => {
    const taken = new Set([join('/out', 'a.mp4'), join('/out', 'a (1).mp4')]);
    await expect(resolveFreeTargetPath('/out', 'a.mp4', async (path) => taken.has(path))).resolves.toBe(join('/out', 'a (2).mp4'));
  });
});

describe('postProcessSource', () => {
  it('does nothing for keep / skip', async () => {
    const move = vi.fn(async () => undefined);
    const trash = vi.fn(async () => undefined);
    const deps = makeDeps({ move, trash });

    await expect(postProcessSource({ sourcePath: '/in/a.mp4', action: 'keep' }, deps)).resolves.toStrictEqual({ ok: true });
    await expect(postProcessSource({ sourcePath: '/in/a.mp4', action: 'skip' }, deps)).resolves.toStrictEqual({ ok: true });
    expect(move).not.toHaveBeenCalled();
    expect(trash).not.toHaveBeenCalled();
  });

  it('moves the source into the destination directory', async () => {
    const move = vi.fn(async () => undefined);
    const result = await postProcessSource({ sourcePath: '/in/a.mp4', action: 'move', destDir: '/out' }, makeDeps({ move }));

    expect(result).toStrictEqual({ ok: true, movedTo: join('/out', 'a.mp4') });
    expect(move).toHaveBeenCalledWith('/in/a.mp4', join('/out', 'a.mp4'));
  });

  it('refuses to move without a destination', async () => {
    await expect(postProcessSource({ sourcePath: '/in/a.mp4', action: 'move' }, makeDeps())).rejects.toThrow();
  });

  it('sends the source to the recycle bin for trash', async () => {
    const trash = vi.fn(async () => undefined);
    await expect(postProcessSource({ sourcePath: '/in/a.mp4', action: 'trash' }, makeDeps({ trash }))).resolves.toStrictEqual({ ok: true });
    expect(trash).toHaveBeenCalledWith('/in/a.mp4');
  });
});
