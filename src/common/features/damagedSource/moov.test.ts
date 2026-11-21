// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { readMoovVideoTiming } from './moov.js';

/** Write a four-character box type at `offset`. */
function setType(view: DataView, offset: number, type: string) {
  for (let index = 0; index < 4; index += 1) view.setUint8(offset + index, type.codePointAt(index) ?? 0);
}

/** Build a box from its type and body parts (children are just body parts). */
function box(type: string, ...body: Uint8Array[]): Uint8Array {
  const bodyLength = body.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(8 + bodyLength);
  const view = new DataView(result.buffer);
  view.setUint32(0, result.length);
  setType(view, 4, type);
  let offset = 8;
  for (const part of body) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/** A `ctts` body with one entry of one sample per given offset. */
function cttsEntries(offsets: number[]): Uint8Array {
  const body = new Uint8Array(8 + (offsets.length * 8));
  const view = new DataView(body.buffer);
  view.setUint8(0, 0); // version
  view.setUint32(4, offsets.length); // entry_count
  offsets.forEach((offset, index) => {
    view.setUint32(8 + (index * 8), 1); // sample_count
    view.setInt32(12 + (index * 8), offset);
  });
  return body;
}

const stbl = (ctts?: Uint8Array) => box('stbl', box('stsd'), box('stts'), ...(ctts != null ? [box('ctts', ctts)] : []), box('stsz'));

const videoTrak = (ctts?: Uint8Array) => box(
  'trak',
  box('tkhd'),
  box('mdia', box('mdhd'), box('hdlr'), box('minf', box('vmhd'), box('dinf'), stbl(ctts))),
);

const audioTrak = () => box(
  'trak',
  box('tkhd'),
  box('mdia', box('mdhd'), box('hdlr'), box('minf', box('smhd'), box('dinf'), box('stbl', box('stsd'), box('stts')))),
);

const moov = (...children: Uint8Array[]) => box('moov', box('mvhd'), ...children);

describe('readMoovVideoTiming', () => {
  it('reports composition offsets when the video track has a non-zero one', () => {
    expect(readMoovVideoTiming(moov(videoTrak(cttsEntries([40040, 0, 40040]))))).toStrictEqual({ hasCtts: true, cttsAllZero: false });
  });

  it('reports a missing ctts box', () => {
    expect(readMoovVideoTiming(moov(videoTrak()))).toStrictEqual({ hasCtts: false, cttsAllZero: false });
  });

  it('treats a ctts box that only holds zeroes as saying nothing', () => {
    expect(readMoovVideoTiming(moov(videoTrak(cttsEntries([0, 0, 0]))))).toStrictEqual({ hasCtts: true, cttsAllZero: true });
  });

  it('returns nothing when the video track has no sample table', () => {
    // A `minf` without `stbl` is a layout this walk does not understand. That is not a verdict about
    // the file: the caller has to fall back to the packet sample.
    const trak = box('trak', box('tkhd'), box('mdia', box('mdhd'), box('hdlr'), box('minf', box('vmhd'), box('dinf'))));
    expect(readMoovVideoTiming(moov(trak))).toBeUndefined();
  });

  it('returns nothing when the composition offsets cannot be read', () => {
    // The box says it holds two entries but ends after the header: unknown, not "no offsets".
    const truncated = new Uint8Array(8);
    new DataView(truncated.buffer).setUint32(4, 2);
    expect(readMoovVideoTiming(moov(videoTrak(truncated)))).toBeUndefined();
  });

  it('treats an empty ctts box as all zeroes', () => {
    expect(readMoovVideoTiming(moov(videoTrak(cttsEntries([]))))).toStrictEqual({ hasCtts: true, cttsAllZero: true });
  });

  it('finds the video track when an audio track comes first', () => {
    expect(readMoovVideoTiming(moov(audioTrak(), videoTrak()))).toStrictEqual({ hasCtts: false, cttsAllZero: false });
  });

  it('returns nothing for an audio-only movie', () => {
    expect(readMoovVideoTiming(moov(audioTrak()))).toBeUndefined();
  });

  it('returns nothing for a fragmented movie', () => {
    // A fragmented file stores its sample timing in `moof` fragments, not in this `moov`: the movie
    // header carries `mvex` and a sample table without `ctts`. That is a layout this walk cannot
    // read, not a file without composition offsets, and claiming otherwise re-encodes healthy files.
    expect(readMoovVideoTiming(moov(box('mvex'), videoTrak()))).toBeUndefined();
  });

  it('returns nothing when the buffer is not a moov box', () => {
    expect(readMoovVideoTiming(box('mdat', new Uint8Array(16)))).toBeUndefined();
  });

  it('returns nothing for a truncated buffer', () => {
    const full = moov(videoTrak(cttsEntries([40040])));
    expect(readMoovVideoTiming(full.slice(0, 12))).toBeUndefined();
  });

  it('returns nothing for garbage', () => {
    expect(readMoovVideoTiming(new Uint8Array(0))).toBeUndefined();
    expect(readMoovVideoTiming(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeUndefined();
  });

  it('reads a 64-bit sized box', () => {
    const trakFull = box('moov', videoTrak());
    const withLargeSize = new Uint8Array(trakFull.length + 8);
    const view = new DataView(withLargeSize.buffer);
    view.setUint32(0, 1); // size == 1 means 64-bit
    setType(view, 4, 'moov');
    view.setUint32(8, 0);
    view.setUint32(12, trakFull.length);
    withLargeSize.set(trakFull.slice(8), 16);
    expect(readMoovVideoTiming(withLargeSize)).toStrictEqual({ hasCtts: false, cttsAllZero: false });
  });
});
