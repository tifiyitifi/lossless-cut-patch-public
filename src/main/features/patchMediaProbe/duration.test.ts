/* eslint-disable no-bitwise -- building EBML/base-media byte buffers for the parser tests */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// eslint-disable-next-line import-js/no-extraneous-dependencies
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseMatroskaDuration, parseMvhdDuration } from './duration.js';
import { readShallowDuration } from './shallow.js';

/** An `mvhd` box with the given layout. */
function buildMvhd({ version, timescale, duration, duration64 }: { version: 0 | 1, timescale: number, duration: number, duration64?: bigint }) {
  const box = version === 0 ? Buffer.alloc(8 + 4 + 4 + 4 + 4 + 4 + 2 + 2 + 4 + 4 + 4 + 4 + 4) : Buffer.alloc(8 + 4 + 8 + 8 + 4 + 8 + 2 + 2 + 4 + 4 + 4 + 4 + 4);
  box.writeUInt32BE(box.length, 0);
  box.write('mvhd', 4, 'latin1');
  box.writeUInt8(version, 8);
  if (version === 0) {
    box.writeUInt32BE(timescale, 20);
    box.writeUInt32BE(duration, 24);
  } else {
    box.writeUInt32BE(timescale, 28);
    box.writeBigUInt64BE(duration64 ?? BigInt(duration), 32);
  }
  return box;
}

function vint(value: number) {
  // Single-byte size vint; every test element content is shorter than 127 bytes.
  return Buffer.from([0x80 | value]);
}

function element(id: readonly number[], content: Buffer) {
  return Buffer.concat([Buffer.from(id), vint(content.length), content]);
}

const ebmlHeader = element([0x1A, 0x45, 0xDF, 0xA3], Buffer.from([0x42, 0x86, 0x81, 0x01]));

function matroskaFile({ duration, timecodeScale = 1_000_000, unknownSegmentSize = false }: { duration?: number, timecodeScale?: number, unknownSegmentSize?: boolean }) {
  const scale = Buffer.alloc(4);
  scale.writeUInt32BE(timecodeScale, 0);
  const parts = [element([0x2A, 0xD7, 0xB1], scale)];
  if (duration != null) {
    const value = Buffer.alloc(8);
    value.writeDoubleBE(duration, 0);
    parts.push(element([0x44, 0x89], value));
  }
  const info = element([0x15, 0x49, 0xA9, 0x66], Buffer.concat(parts));
  const segmentSize = unknownSegmentSize ? Buffer.from([0xFF]) : vint(info.length);
  return Buffer.concat([ebmlHeader, Buffer.from([0x18, 0x53, 0x80, 0x67]), segmentSize, info]);
}

describe('parseMvhdDuration', () => {
  it('reads a version 0 movie header', () => {
    expect(parseMvhdDuration(buildMvhd({ version: 0, timescale: 1000, duration: 5000 }))).toBe(5);
  });

  it('reads a version 1 movie header (64-bit duration)', () => {
    expect(parseMvhdDuration(buildMvhd({ version: 1, timescale: 90_000, duration: 0, duration64: 450_000n }))).toBe(5);
  });

  it('refuses a box that is not a movie header', () => {
    const box = buildMvhd({ version: 0, timescale: 1000, duration: 5000 });
    box.write('trak', 4, 'latin1');
    expect(parseMvhdDuration(box)).toBeUndefined();
  });

  it('refuses a zero timescale or duration instead of dividing by zero', () => {
    expect(parseMvhdDuration(buildMvhd({ version: 0, timescale: 0, duration: 5000 }))).toBeUndefined();
    expect(parseMvhdDuration(buildMvhd({ version: 0, timescale: 1000, duration: 0 }))).toBeUndefined();
  });

  it('refuses a truncated box', () => {
    expect(parseMvhdDuration(buildMvhd({ version: 0, timescale: 1000, duration: 5000 }).subarray(0, 20))).toBeUndefined();
  });
});

describe('parseMatroskaDuration', () => {
  it('reads the duration of a plain Matroska file', () => {
    expect(parseMatroskaDuration(matroskaFile({ duration: 7000 }))).toBe(7);
  });

  it('applies a non-default timecode scale', () => {
    expect(parseMatroskaDuration(matroskaFile({ duration: 7000, timecodeScale: 500_000 }))).toBe(3.5);
  });

  it('accepts a streamed segment whose size is unknown', () => {
    expect(parseMatroskaDuration(matroskaFile({ duration: 7000, unknownSegmentSize: true }))).toBe(7);
  });

  it('returns nothing when the file has no duration element (live recording)', () => {
    expect(parseMatroskaDuration(matroskaFile({}))).toBeUndefined();
  });

  it('returns nothing for a file that is not Matroska', () => {
    expect(parseMatroskaDuration(Buffer.from('not a matroska file at all'))).toBeUndefined();
  });

  it('returns nothing for a truncated prefix instead of throwing', () => {
    const full = matroskaFile({ duration: 7000 });
    expect(parseMatroskaDuration(full.subarray(0, 10))).toBeUndefined();
    expect(parseMatroskaDuration(Buffer.alloc(0))).toBeUndefined();
  });
});

describe('readShallowDuration', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'patch-shallow-duration-'));
    const mvhd = buildMvhd({ version: 0, timescale: 1000, duration: 12_500 });

    // A faststart file: `moov` before `mdat`.
    const ftyp = Buffer.alloc(16);
    ftyp.writeUInt32BE(16, 0);
    ftyp.write('ftyp', 4, 'latin1');
    const moov = Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from('moov', 'latin1'), mvhd]);
    moov.writeUInt32BE(moov.length, 0);
    const mdat = Buffer.alloc(16);
    mdat.writeUInt32BE(16, 0);
    mdat.write('mdat', 4, 'latin1');
    await writeFile(join(dir, 'a.mp4'), Buffer.concat([ftyp, moov, mdat]));

    // A streaming file: `moov` after `mdat` (ffmpeg's default for mp4).
    await writeFile(join(dir, 'b.mov'), Buffer.concat([ftyp, mdat, moov]));

    // Matroska: duration 7s.
    await writeFile(join(dir, 'c.mkv'), matroskaFile({ duration: 7000 }));

    // A container this probe does not read.
    await writeFile(join(dir, 'd.avi'), 'RIFF....AVI ');
    // A file whose header claims more than it has.
    await writeFile(join(dir, 'e.mp4'), Buffer.concat([ftyp, moov.subarray(0, 12)]));

    // Open-ended boxes (size 0 = "to the end of the container"), which is how a streamed file may be
    // written: the header must still be read, and the boxes' tail must not have to be.
    const openEndedMvhd = buildMvhd({ version: 0, timescale: 1000, duration: 9000 });
    openEndedMvhd.writeUInt32BE(0, 0);
    const free = Buffer.alloc(4096);
    free.writeUInt32BE(free.length, 0);
    free.write('free', 4, 'latin1');
    const openEndedMoov = Buffer.concat([Buffer.alloc(8), openEndedMvhd, free]);
    openEndedMoov.writeUInt32BE(0, 0);
    openEndedMoov.write('moov', 4, 'latin1');
    await writeFile(join(dir, 'f.mp4'), Buffer.concat([ftyp, openEndedMoov]));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads the movie header whether it is at the front or the end', async () => {
    await expect(readShallowDuration(join(dir, 'a.mp4'))).resolves.toBe(12.5);
    await expect(readShallowDuration(join(dir, 'b.mov'))).resolves.toBe(12.5);
  });

  it('reads a Matroska file', async () => {
    await expect(readShallowDuration(join(dir, 'c.mkv'))).resolves.toBe(7);
  });

  it('declines containers it does not parse, so the caller falls back to ffprobe', async () => {
    await expect(readShallowDuration(join(dir, 'd.avi'))).resolves.toBeUndefined();
  });

  it('declines a corrupt file instead of throwing', async () => {
    await expect(readShallowDuration(join(dir, 'e.mp4'))).resolves.toBeUndefined();
    await expect(readShallowDuration(join(dir, 'missing.mp4'))).resolves.toBeUndefined();
  });

  it('reads a movie header whose boxes are open-ended, without reading their tail', async () => {
    await expect(readShallowDuration(join(dir, 'f.mp4'))).resolves.toBe(9);
  });
});
