import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// eslint-disable-next-line import-js/no-extraneous-dependencies
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listVideoFiles } from './videoFiles.js';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'patch-video-files-'));
  await writeFile(join(dir, 'b.mp4'), 'x');
  await writeFile(join(dir, 'a.mkv'), 'x');
  await writeFile(join(dir, 'notes.txt'), 'x');
  await writeFile(join(dir, 'clip2.mp4'), 'x');
  await mkdir(join(dir, 'sub'));
  await writeFile(join(dir, 'sub', 'c.mp4'), 'x');
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('listVideoFiles', () => {
  it('lists only media files in natural order and ignores non-media', async () => {
    const files = await listVideoFiles({ dir });
    expect(files.map((f) => f.name)).toStrictEqual(['a.mkv', 'b.mp4', 'clip2.mp4']);
    expect(files.every((f) => f.size > 0)).toBe(true);
  });

  it('recurses when requested', async () => {
    const files = await listVideoFiles({ dir, recursive: true });
    expect(files.map((f) => f.name)).toContain('c.mp4');
  });

  it('does not recurse by default', async () => {
    const files = await listVideoFiles({ dir });
    expect(files.map((f) => f.name)).not.toContain('c.mp4');
  });
});
