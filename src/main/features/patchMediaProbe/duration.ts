/* eslint-disable no-bitwise -- reading container headers is byte manipulation; masks and shifts are the point */
/**
Container duration readers for the batch sort (patch, fork-owned).

These parse a duration out of the file header without starting a process. They answer only "how long
is it, roughly", which is all a sort needs, and they return `undefined` for anything they do not
fully understand - the caller then falls back to ffprobe. Being wrong is cheap here (a wrong row
position), being slow is not (one process per file).
*/

function toSeconds(duration: number, timescale: number) {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(timescale) || timescale <= 0) return undefined;
  return duration / timescale;
}

/**
The duration stored in an ISO base media `mvhd` box, in seconds.

`box` is the whole box including its 8-byte header. The version field decides the layout: version 0
stores 32-bit creation/modification times and a 32-bit duration, version 1 stores 64-bit values.
*/
export function parseMvhdDuration(box: Buffer): number | undefined {
  if (box.length < 28) return undefined;
  if (box.toString('latin1', 4, 8) !== 'mvhd') return undefined;

  const version = box.readUInt8(8);

  if (version === 0) {
    // 8 header + 4 version/flags + 4 creation + 4 modification = timescale at 20, duration at 24.
    const timescale = box.readUInt32BE(20);
    const duration = box.readUInt32BE(24);
    return toSeconds(duration, timescale);
  }

  if (version === 1) {
    // 8 header + 4 version/flags + 8 creation + 8 modification = timescale at 28, duration at 32.
    if (box.length < 40) return undefined;
    const timescale = box.readUInt32BE(28);
    const duration = Number(box.readBigUInt64BE(32));
    return toSeconds(duration, timescale);
  }

  return undefined;
}

/** Element ids of the few Matroska elements this needs. */
const ebmlHeaderId = 0x1A45DFA3;
const segmentId = 0x18538067;
const infoId = 0x1549A966;
const timecodeScaleId = 0x2AD7B1;
const durationId = 0x4489;

/** Matroska's default TimecodeScale: one tick is one millisecond, stored in nanoseconds. */
const defaultTimecodeScale = 1_000_000;

interface Element {
  id: number;
  /** Start of the element's content (after the id and size). */
  contentStart: number;
  /** End of the content, clamped to the buffer (or the parent, when the size is unknown). */
  contentEnd: number;
  /** A "live/streaming" element whose size is not written; it cannot be skipped. */
  unknownSize: boolean;
}

/**
Read one EBML variable-length integer.

Ids keep their length marker (that is how the values are defined), sizes drop it. A size whose value
bits are all ones means "unknown", which is legal for a streamed Segment.
*/
function readVint(buffer: Buffer, offset: number, keepMarker: boolean): { value: number, length: number } | undefined {
  if (offset >= buffer.length) return undefined;
  const first = buffer[offset]!;
  if (first === 0) return undefined; // no length marker at all

  let length = 1;
  for (let mask = 0x80; (first & mask) === 0; mask >>= 1) {
    length += 1;
    if (length > 8) return undefined;
  }
  if (offset + length > buffer.length) return undefined;

  let value = keepMarker ? first : first & (0xFF >> length);
  for (let index = 1; index < length; index += 1) value = value * 256 + buffer[offset + index]!;
  return { value, length };
}

function isUnknownSize(value: number, length: number) {
  return value === (2 ** (7 * length)) - 1;
}

function readElement(buffer: Buffer, offset: number, end: number): Element | undefined {
  const id = readVint(buffer, offset, true);
  if (id == null) return undefined;
  const size = readVint(buffer, offset + id.length, false);
  if (size == null) return undefined;

  const contentStart = offset + id.length + size.length;
  if (contentStart > end) return undefined;

  const unknownSize = isUnknownSize(size.value, size.length);
  const declaredEnd = contentStart + size.value;
  if (!unknownSize && !Number.isSafeInteger(declaredEnd)) return undefined;

  return {
    id: id.value,
    contentStart,
    contentEnd: unknownSize ? end : Math.min(end, declaredEnd),
    unknownSize,
  };
}

function readUnsignedBigEndian(buffer: Buffer, start: number, length: number) {
  if (length <= 0 || length > 8 || start + length > buffer.length) return undefined;
  let value = 0;
  for (let index = 0; index < length; index += 1) value = value * 256 + buffer[start + index]!;
  return value;
}

function readFloatBigEndian(buffer: Buffer, start: number, length: number) {
  if (start + length > buffer.length) return undefined;
  if (length === 4) return buffer.readFloatBE(start);
  if (length === 8) return buffer.readDoubleBE(start);
  return undefined;
}

function readDurationFromInfo(buffer: Buffer, start: number, end: number): number | undefined {
  let offset = start;
  let timecodeScale = defaultTimecodeScale;
  let duration: number | undefined;

  while (offset + 2 <= end) {
    const element = readElement(buffer, offset, end);
    if (element == null) return undefined;

    const length = element.contentEnd - element.contentStart;
    if (element.id === timecodeScaleId) {
      const scale = readUnsignedBigEndian(buffer, element.contentStart, length);
      if (scale != null && scale > 0) timecodeScale = scale;
    } else if (element.id === durationId) {
      const value = readFloatBigEndian(buffer, element.contentStart, length);
      if (value != null) duration = value;
    }

    if (element.unknownSize) return undefined;
    if (element.contentEnd <= offset) return undefined;
    offset = element.contentEnd;
  }

  if (duration == null || !Number.isFinite(duration) || duration <= 0) return undefined;
  if (!Number.isFinite(timecodeScale) || timecodeScale <= 0) return undefined;
  // The stored duration is in TimecodeScale ticks; the scale is nanoseconds per tick.
  return (duration * timecodeScale) / 1e9;
}

function findInfoDuration(buffer: Buffer, start: number, end: number): number | undefined {
  let offset = start;

  while (offset + 2 <= end) {
    const element = readElement(buffer, offset, end);
    if (element == null) return undefined;

    if (element.id === infoId) return readDurationFromInfo(buffer, element.contentStart, element.contentEnd);

    // A streamed element without a size cannot be skipped, and its content is not `Info`.
    if (element.unknownSize) return undefined;
    if (element.contentEnd <= offset) return undefined; // no forward progress: corrupt
    offset = element.contentEnd;
  }

  return undefined;
}

/**
The duration of a Matroska/WebM file, read from a prefix of it.

`prefix` must start at byte 0 (the EBML magic decides whether this is a Matroska file at all). The
`Segment > Info > Duration` element is usually within the first few kilobytes, but files with a
large `SeekHead` or attachments push it further; the caller passes a generous prefix and falls back
to ffprobe when the walk does not find it.
*/
export function parseMatroskaDuration(prefix: Buffer): number | undefined {
  let offset = 0;

  while (offset + 2 <= prefix.length) {
    const element = readElement(prefix, offset, prefix.length);
    if (element == null) return undefined;

    if (element.id === ebmlHeaderId) {
      if (element.unknownSize) return undefined;
      offset = element.contentEnd;
      continue;
    }

    if (element.id !== segmentId) return undefined;
    return findInfoDuration(prefix, element.contentStart, element.contentEnd);
  }

  return undefined;
}
