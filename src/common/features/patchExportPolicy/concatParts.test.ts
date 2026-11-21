// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { findConcatLayoutMismatch, isConcatStreamMapError, planConcatParts } from './concatParts.js';

const video = { index: 0, codec_type: 'video' };
const audio = { index: 1, codec_type: 'audio' };
const expected = [video, audio];

describe('findConcatLayoutMismatch', () => {
  it('accepts parts with the same layout', () => {
    expect(findConcatLayoutMismatch({
      expected,
      parts: [
        { path: 'head.mp4', streams: [video, audio] },
        { path: 'copy.mp4', streams: [video, audio] },
      ],
    })).toBeUndefined();
  });

  it('names the part that lost its video track', () => {
    // The real failure: the encoded head contained audio only, so the concat demuxer exposed a
    // single stream and `-map 0:1` (the audio of the expected layout) found nothing.
    expect(findConcatLayoutMismatch({
      expected,
      parts: [
        { path: 'head.mp4', streams: [{ index: 0, codec_type: 'audio' }] },
        { path: 'copy.mp4', streams: [video, audio] },
      ],
    })).toStrictEqual({ path: 'head.mp4', index: 0, expectedCodecType: 'video', actualCodecType: 'audio', missing: true });
  });

  it('reports a part with no streams at all', () => {
    expect(findConcatLayoutMismatch({ expected, parts: [{ path: 'empty.mp4', streams: [] }] })).toStrictEqual({
      path: 'empty.mp4', index: 0, expectedCodecType: 'video', actualCodecType: undefined, missing: true,
    });
  });

  it('reports a part that lists the same tracks in another order', () => {
    // `-map 0:0` would silently copy the audio into the video stream: refuse instead.
    expect(findConcatLayoutMismatch({
      expected,
      parts: [{ path: 'head.mp4', streams: [{ index: 0, codec_type: 'audio' }, { index: 1, codec_type: 'video' }] }],
    })).toStrictEqual({ path: 'head.mp4', index: 0, expectedCodecType: 'video', actualCodecType: 'audio', missing: false });
  });

  it('reports a part with an extra stream', () => {
    expect(findConcatLayoutMismatch({
      expected,
      parts: [{ path: 'head.mp4', streams: [video, audio, { index: 2, codec_type: 'subtitle' }] }],
    })).toStrictEqual({ path: 'head.mp4', index: 2, expectedCodecType: 'subtitle', actualCodecType: 'subtitle', missing: false });
  });
});

describe('planConcatParts', () => {
  const data = { index: 2, codec_type: 'data' };
  const copy = { path: 'copy.mp4', streams: [video, audio, data] };

  it('keeps every part that has the video track', () => {
    const head = { path: 'head.mp4', streams: [video, audio, data] };
    const tail = { path: 'tail.mp4', streams: [video, audio, data] };
    const parts = [head, copy, tail];
    expect(planConcatParts({ expected: [video, audio, data], parts, requiredPath: copy.path })).toStrictEqual({ parts, dropped: [] });
  });

  it('drops an empty head that kept only the data track', () => {
    // Measured: the segment starts at 0 and the source's first frame is two frames later, so the head
    // window holds no frame. As the first part of the concat it produced an unplayable clip whose
    // edit list pointed past the media end (see `concatParts.ts`).
    const empty = { path: 'head.mp4', streams: [data] };
    const tail = { path: 'tail.mp4', streams: [video, audio, data] };
    expect(planConcatParts({ expected: [video, audio, data], parts: [empty, copy, tail], requiredPath: copy.path })).toStrictEqual({
      parts: [copy, tail], dropped: [empty],
    });
  });

  it('drops a head that kept audio and the data track but no video', () => {
    // The same empty window on a source with an audio track: the part has audio, but no video, and the
    // concat aborted with `Could not write header` and left a 0 byte file.
    const empty = { path: 'head.mp4', streams: [audio, data] };
    const tail = { path: 'tail.mp4', streams: [video, audio, data] };
    expect(planConcatParts({ expected: [video, audio, data], parts: [empty, copy, tail], requiredPath: copy.path })).toStrictEqual({
      parts: [copy, tail], dropped: [empty],
    });
  });

  it('drops an empty part at the end as well', () => {
    const empty = { path: 'tail.mp4', streams: [data] };
    expect(planConcatParts({ expected, parts: [copy, empty], requiredPath: copy.path })).toStrictEqual({ parts: [copy], dropped: [empty] });
  });

  it('never drops the clip\'s own part, even without video', () => {
    // The copied middle is the video of the clip: dropping it would silently export a much shorter
    // clip, so it is kept and the concat reports the part it cannot map.
    const broken = { path: 'copy.mp4', streams: [audio] };
    const head = { path: 'head.mp4', streams: [video, audio] };
    expect(planConcatParts({ expected, parts: [head, broken], requiredPath: broken.path })).toStrictEqual({
      parts: [head, broken], dropped: [],
    });
  });

  it('leaves the list alone when no part has video', () => {
    const parts = [{ path: 'a.mp4', streams: [data] }, { path: 'b.mp4', streams: [data] }];
    expect(planConcatParts({ expected, parts, requiredPath: parts[0]!.path })).toStrictEqual({ parts, dropped: [] });
  });

  it('keeps parts of a clip without video', () => {
    const parts = [{ path: 'a.mp4', streams: [audio] }, { path: 'b.mp4', streams: [audio] }];
    expect(planConcatParts({ expected: [audio], parts, requiredPath: parts[0]!.path })).toStrictEqual({ parts, dropped: [] });
  });
});

describe('isConcatStreamMapError', () => {
  it('recognizes the concat layout failure', () => {
    const stderr = [
      "Stream map '' matches no streams.",
      "To ignore this, add a trailing '?' to the map.",
      "Failed to set value '0:1' for option 'map': Invalid argument",
    ].join('\n');
    expect(isConcatStreamMapError(stderr)).toBe(true);
  });

  it('ignores unrelated ffmpeg failures', () => {
    expect(isConcatStreamMapError('[out#0/mp4] Error opening output file: Invalid argument')).toBe(false);
    expect(isConcatStreamMapError('Invalid data found when processing input')).toBe(false);
    expect(isConcatStreamMapError('')).toBe(false);
  });
});
