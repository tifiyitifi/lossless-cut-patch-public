// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { partitionCopiedStreams } from './partition.js';

const video = { index: 0, codec_type: 'video' };
const audio = { index: 1, codec_type: 'audio' };
const subtitle = { index: 2, codec_type: 'subtitle' };
const data = { index: 3, codec_type: 'data' };

describe('partitionCopiedStreams', () => {
  it('keeps video and audio in the first pass', () => {
    expect(partitionCopiedStreams({ copyFileStreams: [{ path: 'a.mkv', streamIds: [0, 1] }], streamsByPath: { 'a.mkv': [video, audio, subtitle] } })).toStrictEqual({
      av: [{ path: 'a.mkv', streamIds: [0, 1] }],
      other: [],
    });
  });

  it('moves subtitles and data tracks to the second pass', () => {
    expect(partitionCopiedStreams({ copyFileStreams: [{ path: 'a.mkv', streamIds: [0, 1, 2, 3] }], streamsByPath: { 'a.mkv': [video, audio, subtitle, data] } })).toStrictEqual({
      av: [{ path: 'a.mkv', streamIds: [0, 1] }],
      other: [{ path: 'a.mkv', streamIds: [2, 3] }],
    });
  });

  it('has an empty first pass when only subtitles are copied', () => {
    expect(partitionCopiedStreams({ copyFileStreams: [{ path: 'a.mkv', streamIds: [2] }], streamsByPath: { 'a.mkv': [video, audio, subtitle] } })).toStrictEqual({
      av: [],
      other: [{ path: 'a.mkv', streamIds: [2] }],
    });
  });

  it('keeps a stream of unknown type in the first pass', () => {
    expect(partitionCopiedStreams({ copyFileStreams: [{ path: 'a.mkv', streamIds: [9] }], streamsByPath: { 'a.mkv': [video] } })).toStrictEqual({
      av: [{ path: 'a.mkv', streamIds: [9] }],
      other: [],
    });
  });

  it('drops files whose every stream went to the other pass', () => {
    expect(partitionCopiedStreams({
      copyFileStreams: [{ path: 'a.mkv', streamIds: [0] }, { path: 'b.mkv', streamIds: [2] }],
      streamsByPath: { 'a.mkv': [video], 'b.mkv': [subtitle] },
    })).toStrictEqual({
      av: [{ path: 'a.mkv', streamIds: [0] }],
      other: [{ path: 'b.mkv', streamIds: [2] }],
    });
  });

  it('is empty for an empty copy list', () => {
    expect(partitionCopiedStreams({ copyFileStreams: [], streamsByPath: {} })).toStrictEqual({ av: [], other: [] });
  });
});
