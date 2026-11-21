/**
Read the frame timing information out of an MP4 `moov` box (pure).

Only one question is asked here: does the video track carry composition time offsets, and if it
does, does any of them say anything? A track that needs reordering (B frames) but has no offsets,
or only zeroes, is the damage `missingCompositionOffsets` describes.

This is a straight box walk, not a full MP4 parser: it never looks at `mdat`, so it can run on the
movie header alone, wherever the file keeps it.
*/

export interface MoovVideoTiming {
  /** The video track has a `ctts` box. */
  hasCtts: boolean;
  /** ... and every offset in it is zero, which is the same as not having one. */
  cttsAllZero: boolean;
}

interface Box {
  type: string;
  size: number;
  headerLength: number;
}

const readType = (view: DataView, offset: number) => [0, 1, 2, 3]
  .map((index) => String.fromCodePoint(view.getUint8(offset + index)))
  .join('');

/** Read the box header at `offset`, or `undefined` when it does not fit inside `end`. */
function readBox(view: DataView, offset: number, end: number): Box | undefined {
  if (offset + 8 > end) return undefined;

  const declaredSize = view.getUint32(offset);
  const type = readType(view, offset + 4);

  if (declaredSize === 1) {
    // 64-bit size in the following 8 bytes (an `mdat` larger than 4 GiB is written this way).
    if (offset + 16 > end) return undefined;
    const high = view.getUint32(offset + 8);
    const low = view.getUint32(offset + 12);
    const size = (high * 2 ** 32) + low;
    if (size < 16 || offset + size > end) return undefined;
    return { type, size, headerLength: 16 };
  }

  // `0` means "up to the end of the enclosing box".
  const size = declaredSize === 0 ? end - offset : declaredSize;
  if (size < 8 || offset + size > end) return undefined;
  return { type, size, headerLength: 8 };
}

/** The first child of `type` inside `[start, end)`, with the range of its body. */
function findChild(view: DataView, start: number, end: number, type: string): { bodyStart: number; bodyEnd: number } | undefined {
  let offset = start;
  while (offset < end) {
    const child = readBox(view, offset, end);
    if (child == null) return undefined;
    if (child.type === type) return { bodyStart: offset + child.headerLength, bodyEnd: offset + child.size };
    offset += child.size;
  }
  return undefined;
}

/** Every child of `type` inside `[start, end)`, each with the range of its body. */
function findChildren(view: DataView, start: number, end: number, type: string): { bodyStart: number; bodyEnd: number }[] {
  const found: { bodyStart: number; bodyEnd: number }[] = [];
  let offset = start;
  while (offset < end) {
    const child = readBox(view, offset, end);
    if (child == null) return found;
    if (child.type === type) found.push({ bodyStart: offset + child.headerLength, bodyEnd: offset + child.size });
    offset += child.size;
  }
  return found;
}

/** Does this track hold video? `vmhd` only ever appears in a video track's media information. */
function isVideoTrack(view: DataView, trak: { bodyStart: number; bodyEnd: number }) {
  const mdia = findChild(view, trak.bodyStart, trak.bodyEnd, 'mdia');
  if (mdia == null) return undefined;
  const minf = findChild(view, mdia.bodyStart, mdia.bodyEnd, 'minf');
  if (minf == null) return undefined;
  const hasVmhd = findChild(view, minf.bodyStart, minf.bodyEnd, 'vmhd') != null;
  return hasVmhd ? minf : undefined;
}

/** Does the child range contain the given box at all? */
function hasCttsBox(view: DataView, start: number, end: number): { bodyStart: number; bodyEnd: number } | undefined {
  return findChild(view, start, end, 'ctts');
}

function readCtts(view: DataView, ctts: { bodyStart: number; bodyEnd: number }): boolean | undefined {
  const { bodyStart, bodyEnd } = ctts;
  // version (1) + flags (3) + entry_count (4)
  if (bodyStart + 8 > bodyEnd) return undefined;
  const entryCount = view.getUint32(bodyStart + 4);

  for (let index = 0; index < entryCount; index += 1) {
    const entry = bodyStart + 8 + (index * 8);
    // `sample_count` (4) + `sample_offset` (4). Version 0 stores it unsigned, version 1 signed; a
    // zero test does not care, and neither do we.
    if (entry + 8 > bodyEnd) return undefined;
    if (view.getInt32(entry + 4) !== 0) return false;
  }
  return true;
}

/**
The video track's timing, or `undefined` when it cannot be determined (no video track, a
truncated or unusual box layout). `undefined` must never be read as "the file is fine".
*/
export function readMoovVideoTiming(moov: Uint8Array): MoovVideoTiming | undefined {
  const view = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);

  const top = readBox(view, 0, moov.byteLength);
  if (top?.type !== 'moov') return undefined;

  // A fragmented movie (`mvex` present) keeps the sample timing in `moof` fragments, outside this
  // walk: its sample table has no `ctts` because the offsets were never meant to live there. Reading
  // that as "no offsets" would re-encode a healthy file, so the caller has to use the packet sample.
  if (findChild(view, top.headerLength, moov.byteLength, 'mvex') != null) return undefined;

  const videoMinf = findChildren(view, top.headerLength, moov.byteLength, 'trak')
    .map((trak) => isVideoTrack(view, trak))
    .find((minf) => minf != null);
  if (videoMinf == null) return undefined;

  const stbl = findChild(view, videoMinf.bodyStart, videoMinf.bodyEnd, 'stbl');
  // A video track without a sample table is a layout this walk does not understand. `undefined`
  // sends the caller to the packet sample; claiming "no offsets" here would flag the file as damaged
  // on the strength of a box we could not find.
  if (stbl == null) return undefined;

  const ctts = hasCttsBox(view, stbl.bodyStart, stbl.bodyEnd);
  if (ctts == null) return { hasCtts: false, cttsAllZero: false };

  const allZero = readCtts(view, ctts);
  // The entries run past the box (a truncated or unusual layout): the offsets are unknown, which is
  // not the same as "they are all zero" and not the same as "the file is fine".
  if (allZero == null) return undefined;
  return { hasCtts: true, cttsAllZero: allZero };
}
