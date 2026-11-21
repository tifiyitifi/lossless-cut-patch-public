// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { parseFirstGopPtsEqualsDts } from './packetTiming.js';

describe('parseFirstGopPtsEqualsDts', () => {
  it('reports equality for a file whose packets carry pts == dts', () => {
    expect(parseFirstGopPtsEqualsDts('0,0\n512,512\n1024,1024\n')).toBe(true);
  });

  it('reports a reordered stream (pts != dts)', () => {
    expect(parseFirstGopPtsEqualsDts('0,-1024\n1536,-512\n512,0\n')).toBe(false);
  });

  it('says nothing when no packet carries a timestamp', () => {
    // A raw elementary stream: ffprobe prints `N/A` for both fields. Comparing the strings would
    // call this "pts == dts" and flag a healthy file as damaged.
    expect(parseFirstGopPtsEqualsDts('N/A,N/A\nN/A,N/A\n')).toBeUndefined();
  });

  it('says nothing when the output is empty', () => {
    expect(parseFirstGopPtsEqualsDts('')).toBeUndefined();
    expect(parseFirstGopPtsEqualsDts('\n  \n')).toBeUndefined();
  });

  it('ignores packets whose timestamps are only partly readable', () => {
    // Matroska: the first packets have no dts; the readable ones still say the stream is reordered.
    expect(parseFirstGopPtsEqualsDts('0,N/A\n100,N/A\n33,0\n67,33\n')).toBe(false);
    // AVI: pts is never stored, so the sample carries no usable pair at all.
    expect(parseFirstGopPtsEqualsDts('N/A,0\nN/A,20\n')).toBeUndefined();
  });

  it('tolerates a trailing empty field and Windows line endings', () => {
    // `mpegts` prints a third, empty column; `csv=p=0` uses the platform newline on Windows.
    expect(parseFirstGopPtsEqualsDts('132000,132000,\r\n141000,141000,\r\n')).toBe(true);
    expect(parseFirstGopPtsEqualsDts('132000,126000,\r\n')).toBe(false);
  });
});
