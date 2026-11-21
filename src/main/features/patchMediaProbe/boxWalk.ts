import type { FileHandle } from 'node:fs/promises';

/**
Minimal ISO base media (MP4/MOV) box walking for the patch media probe (fork-owned).

The batch list needs a file's duration to sort by it, and spawning an ffprobe per file costs far
more than reading the movie header: the process itself is the cost. This walks the box tree with a
handful of small reads instead.

It is deliberately separate from the box walk in `features/damagedSource`: that one reads a whole
`moov` box to inspect frame timing, while this one only needs to *reach* `mvhd`. Sharing them would
make the damage probe's behaviour depend on the sort feature.
*/

export interface BoxHeader {
  /** The four-character box type. */
  type: string;
  /** Absolute offset of the box, at its size field. */
  offset: number;
  /** 8 bytes, 16 for the 64-bit size form, plus 16 for a `uuid` box. */
  headerLength: number;
  /** Size of the whole box, header included. */
  size: number;
}

/** Read exactly `length` bytes at `position`, or `undefined` when the file ends first. */
export async function readExactly(handle: FileHandle, length: number, position: number): Promise<Buffer | undefined> {
  if (length <= 0) return Buffer.alloc(0);
  const buffer = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    // eslint-disable-next-line no-await-in-loop
    const { bytesRead } = await handle.read(buffer, filled, length - filled, position + filled);
    if (bytesRead === 0) return undefined;
    filled += bytesRead;
  }
  return buffer;
}

/**
The box header at `offset`, or `undefined` when the bytes there are not a usable box.

`end` bounds the parent (the file size at the top level, the parent box's end inside it): a box that
claims to be larger than its parent is corrupt, and every caller treats that as "unknown".
*/
export async function readBoxHeader(handle: FileHandle, offset: number, end: number): Promise<BoxHeader | undefined> {
  if (offset < 0 || offset + 8 > end) return undefined;

  // 16 bytes cover the 64-bit size form in one read; the 8-byte form simply ignores the tail.
  const header = await readExactly(handle, 16, offset);
  if (header == null) return undefined;

  let size = header.readUInt32BE(0);
  const type = header.toString('latin1', 4, 8);
  let headerLength = 8;

  if (size === 1) {
    size = Number(header.readBigUInt64BE(8));
    headerLength = 16;
  } else if (size === 0) {
    // "To the end of the enclosing container" - ffmpeg writes this for streamed files.
    size = end - offset;
  }

  // A `uuid` box puts its 16-byte user type between the header and the payload.
  if (type === 'uuid') headerLength += 16;

  if (!Number.isSafeInteger(size) || size < headerLength || offset + size > end) return undefined;

  return { type, offset, headerLength, size };
}

/** The first child box of `type` inside `[start, end)`, in file order. */
export async function findBox(handle: FileHandle, { type, start, end }: { type: string, start: number, end: number }): Promise<BoxHeader | undefined> {
  let offset = start;
  while (offset + 8 <= end) {
    // eslint-disable-next-line no-await-in-loop
    const box = await readBoxHeader(handle, offset, end);
    // An unreadable header means the rest of this container cannot be walked safely.
    if (box == null) return undefined;
    if (box.type === type) return box;
    offset += box.size;
  }
  return undefined;
}
