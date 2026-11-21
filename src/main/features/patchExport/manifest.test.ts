// eslint-disable-next-line import-js/no-extraneous-dependencies
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it, vi } from 'vitest';

import { getPatchExportManifestPath, readPatchExportManifest, updatePatchExportManifest } from './manifest.js';

// The logger pulls in Electron (and writes a log file); a no-op is enough for this test.
vi.mock('../../logger.js', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function withManifest(content: string, run: (root: string, manifestPath: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'patch-manifest-'));
  try {
    const manifestPath = getPatchExportManifestPath(root);
    expect(manifestPath).toBeDefined();
    await mkdir(dirname(manifestPath!), { recursive: true });
    await writeFile(manifestPath!, content);
    await run(root, manifestPath!);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('getPatchExportManifestPath', () => {
  it('sits in the configured work folder (default .losslesscut_work)', () => {
    expect(getPatchExportManifestPath('C:/videos')).toBe(join('C:/videos', '.losslesscut_work', 'export-manifest.json'));
    expect(getPatchExportManifestPath('C:/videos', { workDir: 'work', finishedDir: 'done' })).toBe(join('C:/videos', 'work', 'export-manifest.json'));
    expect(getPatchExportManifestPath(undefined)).toBeUndefined();
  });
});

describe('readPatchExportManifest', () => {
  it('backs up a manifest that is not valid JSON', async () => {
    await withManifest('not json', async (root, manifestPath) => {
      await expect(readPatchExportManifest(root)).resolves.toStrictEqual({ version: 1, files: {} });
      await expect(readFile(`${manifestPath}.bad`, 'utf8')).resolves.toBe('not json');
    });
  });

  it('backs up a manifest whose records the schema drops', async () => {
    const content = JSON.stringify({ version: 99, files: { '/src/a.mp4': { signature: 'sig', segments: {} } } });
    await withManifest(content, async (root, manifestPath) => {
      await expect(readPatchExportManifest(root)).resolves.toStrictEqual({ version: 1, files: {} });
      await expect(readFile(`${manifestPath}.bad`, 'utf8')).resolves.toBe(content);
    });
  });

  it('backs up a manifest that drops one record next to a valid one', async () => {
    const content = JSON.stringify({
      version: 1,
      files: {
        '/src/a.mp4': { signature: 'sig', segments: { a: { start: 0, end: 10, path: '/clips/a.mp4', signature: 'sig' } } },
        '/src/b.mp4': { signature: 42, segments: {} },
      },
    });
    await withManifest(content, async (root, manifestPath) => {
      const manifest = await readPatchExportManifest(root);
      expect(Object.keys(manifest.files)).toStrictEqual(['/src/a.mp4']);
      await expect(readFile(`${manifestPath}.bad`, 'utf8')).resolves.toBe(content);
    });
  });

  it('backs up a manifest that loses a segment of a valid record', async () => {
    const content = JSON.stringify({
      version: 1,
      files: {
        '/src/a.mp4': {
          signature: 'sig',
          segments: {
            a: { start: 0, end: 10, path: '/clips/a.mp4', signature: 'sig' },
            b: { start: 'nope', end: 20, path: '/clips/b.mp4', signature: 'sig' },
          },
        },
      },
    });
    await withManifest(content, async (root, manifestPath) => {
      const manifest = await readPatchExportManifest(root);
      expect(Object.keys(manifest.files['/src/a.mp4']?.segments ?? {})).toStrictEqual(['a']);
      await expect(readFile(`${manifestPath}.bad`, 'utf8')).resolves.toBe(content);
    });
  });

  it('backs up a manifest whose file map is not an object', async () => {
    const content = JSON.stringify({ version: 1, files: [] });
    await withManifest(content, async (root, manifestPath) => {
      await expect(readPatchExportManifest(root)).resolves.toStrictEqual({ version: 1, files: {} });
      await expect(readFile(`${manifestPath}.bad`, 'utf8')).resolves.toBe(content);
    });
  });

  it('backs up a manifest that drops the merged record', async () => {
    const content = JSON.stringify({
      version: 1,
      files: {
        '/src/a.mp4': {
          signature: 'sig',
          segments: { a: { start: 0, end: 10, path: '/clips/a.mp4', signature: 'sig' } },
          merged: { signature: 'msig', path: 42 },
        },
      },
    });
    await withManifest(content, async (root, manifestPath) => {
      const manifest = await readPatchExportManifest(root);
      expect(manifest.files['/src/a.mp4']?.merged).toBeUndefined();
      expect(Object.keys(manifest.files['/src/a.mp4']?.segments ?? {})).toStrictEqual(['a']);
      await expect(readFile(`${manifestPath}.bad`, 'utf8')).resolves.toBe(content);
    });
  });

  it('backs up a manifest that drops an invalid chapter', async () => {
    const content = JSON.stringify({
      version: 1,
      files: {
        '/src/a.mp4': {
          signature: 'sig',
          segments: {},
          merged: {
            signature: 'msig',
            path: '/clips/merged.mp4',
            chapters: [
              { segId: 'a', start: 0, end: 10, name: 'a', segColorIndex: 0 },
              { segId: 'b', start: 10, end: 5, name: 'b', segColorIndex: 1 },
            ],
          },
        },
      },
    });
    await withManifest(content, async (root, manifestPath) => {
      const manifest = await readPatchExportManifest(root);
      expect(manifest.files['/src/a.mp4']?.merged?.chapters).toHaveLength(1);
      await expect(readFile(`${manifestPath}.bad`, 'utf8')).resolves.toBe(content);
    });
  });

  it('backs up a manifest whose chapters are not an array', async () => {
    const content = JSON.stringify({
      version: 1,
      files: {
        '/src/a.mp4': {
          signature: 'sig',
          segments: {},
          merged: { signature: 'msig', path: '/clips/merged.mp4', chapters: 'nope' },
        },
      },
    });
    await withManifest(content, async (root, manifestPath) => {
      await expect(readPatchExportManifest(root)).resolves.toStrictEqual({
        version: 1,
        files: { '/src/a.mp4': { signature: 'sig', segments: {}, merged: { signature: 'msig', path: '/clips/merged.mp4' } } },
      });
      await expect(readFile(`${manifestPath}.bad`, 'utf8')).resolves.toBe(content);
    });
  });

  it('does not back up a valid merged record with chapters', async () => {
    const manifest = {
      version: 1,
      files: {
        '/src/a.mp4': {
          signature: 'sig',
          segments: { a: { start: 0, end: 10, path: '/clips/a.mp4', signature: 'sig' } },
          merged: {
            signature: 'msig',
            path: '/clips/merged.mp4',
            chapters: [{ segId: 'a', start: 0, end: 10, name: 'a', segColorIndex: 0 }],
          },
        },
      },
    };
    await withManifest(JSON.stringify(manifest), async (root, manifestPath) => {
      await expect(readPatchExportManifest(root)).resolves.toEqual(manifest);
      await expect(exists(`${manifestPath}.bad`)).resolves.toBe(false);
    });
  });
  it('accepts a manifest saved with a byte-order mark', async () => {
    const manifest = {
      version: 1,
      files: { '/src/a.mp4': { signature: 'sig', segments: { a: { start: 0, end: 10, path: '/clips/a.mp4', signature: 'sig' } } } },
    };
    await withManifest(`\u{FEFF}${JSON.stringify(manifest)}`, async (root, manifestPath) => {
      await expect(readPatchExportManifest(root)).resolves.toEqual(manifest);
      await expect(exists(`${manifestPath}.bad`)).resolves.toBe(false);
    });
  });

  it('keeps the first backup instead of overwriting it with the next bad read', async () => {
    await withManifest('not json', async (root, manifestPath) => {
      await readPatchExportManifest(root);
      await writeFile(manifestPath, 'still not json');
      await readPatchExportManifest(root);

      await expect(readFile(`${manifestPath}.bad`, 'utf8')).resolves.toBe('not json');
      await expect(readFile(`${manifestPath}.bad.2`, 'utf8')).resolves.toBe('still not json');
    });
  });

  it('does not back up a valid empty manifest', async () => {
    await withManifest(JSON.stringify({ version: 1, files: {} }), async (root, manifestPath) => {
      await expect(readPatchExportManifest(root)).resolves.toStrictEqual({ version: 1, files: {} });
      await expect(exists(`${manifestPath}.bad`)).resolves.toBe(false);
    });
  });

  it('reads a valid manifest without backing it up', async () => {
    const manifest = {
      version: 1,
      files: {
        '/src/a.mp4': {
          signature: 'sig',
          segments: { a: { start: 0, end: 10, path: '/clips/a.mp4', signature: 'sig' } },
        },
      },
    };
    await withManifest(JSON.stringify(manifest), async (root, manifestPath) => {
      await expect(readPatchExportManifest(root)).resolves.toEqual(manifest);
      await expect(exists(`${manifestPath}.bad`)).resolves.toBe(false);
    });
  });
});

describe('updatePatchExportManifest', () => {
  it('updates the stored record instead of adding another spelling of the same source', async () => {
    const storedKey = String.raw`C:\Videos\a.mp4`;
    const clipPath = 'C:/Videos/.losslesscut_work/clips/a.mp4';
    const content = JSON.stringify({
      version: 1,
      files: {
        [storedKey]: {
          signature: 'old',
          segments: { s1: { start: 0, end: 10, path: clipPath, signature: 'old' } },
        },
      },
    });

    await withManifest(content, async (root) => {
      // The same file, opened with `/` separators: the record has to be updated in place.
      const next = await updatePatchExportManifest(root, 'C:/Videos/a.mp4', {
        signature: 'new',
        segments: { s1: { start: 0, end: 10, path: clipPath, signature: 'new' } },
        replacedSegIds: ['s1'],
        removedSegIds: [],
      });

      expect(Object.keys(next.files)).toStrictEqual([storedKey]);
      expect(next.files[storedKey]?.segments['s1']?.signature).toBe('new');
      await expect(readPatchExportManifest(root)).resolves.toEqual(next);
    });
  });
});
