import { open } from 'node:fs/promises';
import { extname } from 'node:path';

import { findBox, readExactly } from './boxWalk.js';
import { parseMatroskaDuration, parseMvhdDuration } from './duration.js';

/**
Read a media file's duration from its container header (patch, fork-owned).

Nothing is started: no ffprobe, no ffmpeg. That is the whole point - a batch list of a few hundred
files can be sorted by duration in well under a second this way, while one ffprobe process per file
would take tens of seconds on Windows.

Anything not understood returns `undefined`, and the caller falls back to ffprobe. Container
formats:
- ISO base media (`moov/mvhd`): mp4, m4v, mov, 3gp, m4a
- Matroska (`Segment/Info/Duration`): mkv, webm, mka
*/

const isoBaseMediaExtensions = new Set(['mp4', 'm4v', 'mov', 'qt', '3gp', '3g2', 'm4a']);
const matroskaExtensions = new Set(['mkv', 'webm', 'mka']);

/**
How much of a Matroska file is read to reach `Info`.

The element sits right after the (short) EBML header and the `SeekHead` in ordinary files, so one
megabyte is generous. A file whose `Info` sits further is left to ffprobe rather than read whole.
*/
const matroskaPrefixBytes = 1024 * 1024;

/**
Enough of an `mvhd` box for either layout: 8 header + 4 version/flags + 8 creation + 8 modification
+ 4 timescale + 8 duration. The box is normally ~108 bytes, but a writer may declare it open-ended
(size 0 = "to the end of the container"), and reading a whole multi-gigabyte file for a header would
be worse than the ffprobe it is here to avoid.
*/
const mvhdPrefixBytes = 40;

async function readIsoBaseMediaDuration(filePath: string) {
  const handle = await open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    // The movie header sits wherever the writer put it: at the front for faststart files, at the
    // end for files written while streaming. Walking the top-level boxes finds both.
    const moov = await findBox(handle, { type: 'moov', start: 0, end: size });
    if (moov == null) return undefined;

    const mvhd = await findBox(handle, { type: 'mvhd', start: moov.offset + moov.headerLength, end: moov.offset + moov.size });
    if (mvhd == null) return undefined;

    const box = await readExactly(handle, Math.min(mvhd.size, mvhdPrefixBytes), mvhd.offset);
    return box == null ? undefined : parseMvhdDuration(box);
  } finally {
    await handle.close();
  }
}

async function readMatroskaFileDuration(filePath: string) {
  const handle = await open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    const prefix = await readExactly(handle, Math.min(size, matroskaPrefixBytes), 0);
    return prefix == null ? undefined : parseMatroskaDuration(prefix);
  } finally {
    await handle.close();
  }
}

/** The container duration in seconds, or `undefined` when this file cannot answer it cheaply. */
export async function readShallowDuration(filePath: string): Promise<number | undefined> {
  const extension = extname(filePath).slice(1).toLowerCase();

  try {
    if (isoBaseMediaExtensions.has(extension)) return await readIsoBaseMediaDuration(filePath);
    if (matroskaExtensions.has(extension)) return await readMatroskaFileDuration(filePath);
  } catch {
    // A file we cannot read is "unknown", never an error: the sort must not fail over one file.
    // Nothing is logged here on purpose - this module is also used by the unit tests, which do not
    // load the main process logger; the caller reports a whole-batch failure.
  }

  return undefined;
}
