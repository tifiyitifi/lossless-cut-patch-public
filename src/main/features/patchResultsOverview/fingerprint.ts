import { createHash } from 'node:crypto';
import { open, stat } from 'node:fs/promises';

import type { PatchSourceFingerprint } from '../../../common/features/patchResultsOverview/index.js';

/**
The fingerprint of a source video (fork-owned).

A finish job may move a source inside the work area, and the finished-job ledger then holds its
previous job under the old path. Recognizing both as the same video needs an identity that survives
a move. The scan only reads it for the sources whose file name matches the moved entry (the name
narrows the candidates before the fingerprint decides, see `scan.ts`), so a move that also renames
the source is not paired. Hashing the whole file is not an option: the sources are hundreds of
megabytes on a network share. The exact size plus a hash of the first and the last megabyte is
enough to tell two videos apart and costs a fixed 2 MiB read.

The size is part of the hash as well, so a truncated copy does not share the fingerprint of the file
it was copied from.
*/

/** How many bytes are read from each end of the file. */
export const patchSourceFingerprintChunkBytes = 1024 * 1024;

export interface PatchSourceFingerprintDeps {
  stat?: (path: string) => Promise<{ size: number }>;
  /** Reads up to `length` bytes starting at `start`; a short read is allowed at the end of a file. */
  readRange?: (path: string, start: number, length: number) => Promise<Buffer>;
}

async function readRange(path: string, start: number, length: number): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
The fingerprint of a file, or `undefined` when it cannot be read.

A missing or locked file simply has no identity: the overview then falls back to the file name instead
of failing the whole scan.
*/
export async function readPatchSourceFingerprint(
  path: string,
  deps: PatchSourceFingerprintDeps = {},
): Promise<PatchSourceFingerprint | undefined> {
  try {
    const { size } = await (deps.stat ?? stat)(path);
    const read = deps.readRange ?? readRange;
    const chunk = Math.min(Math.max(0, size), patchSourceFingerprintChunkBytes);
    const head = chunk > 0 ? await read(path, 0, chunk) : Buffer.alloc(0);
    const tail = size > chunk ? await read(path, size - chunk, chunk) : Buffer.alloc(0);
    const hash = createHash('sha256').update(String(size)).update(head).update(tail).digest('hex');
    return { size, hash };
  } catch {
    return undefined;
  }
}
