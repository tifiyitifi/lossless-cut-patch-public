// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { PatchExportFileRecord } from './manifest.js';
import { buildMergedInputs, buildMergedSignatureInput, collectMergeClips, listTrackedClips, mergedClipsMatchInputs } from './mergeResults.js';

function record(overrides: Partial<PatchExportFileRecord> = {}): PatchExportFileRecord {
  return {
    signature: 'sig',
    segments: {
      b: { start: 10, end: 20, label: 'b', path: '/clips/b.mp4', signature: 'sig-b' },
      a: { start: 0, end: 10, label: 'a', path: '/clips/a.mp4', signature: 'sig-a' },
    },
    ...overrides,
  };
}

describe('collectMergeClips', () => {
  it('has nothing to merge without a record', () => {
    expect(collectMergeClips(undefined)).toStrictEqual([]);
    expect(collectMergeClips(record({ segments: {} }))).toStrictEqual([]);
  });

  it('orders the results by their position in the source', () => {
    expect(collectMergeClips(record()).map((clip) => clip.segId)).toStrictEqual(['a', 'b']);
  });

  it('keeps the segment identity and path', () => {
    expect(collectMergeClips(record())[0]).toEqual({ segId: 'a', start: 0, end: 10, label: 'a', path: '/clips/a.mp4', signature: 'sig-a' });
  });

  it('keeps the tail rule of a result', () => {
    const withTail = record({
      segments: {
        a: { start: 0, end: 10, path: '/clips/a.mp4', tail: 'end' },
      },
    });
    expect(collectMergeClips(withTail)[0]?.tail).toBe('end');
  });

  it('is stable for results that start at the same time', () => {
    const sameStart = record({
      segments: {
        z: { start: 5, end: 10, path: '/clips/z.mp4' },
        y: { start: 5, end: 8, path: '/clips/y.mp4' },
      },
    });
    expect(collectMergeClips(sameStart).map((clip) => clip.segId)).toStrictEqual(['y', 'z']);
  });
});

describe('listTrackedClips', () => {
  it('lists every result the manifest tracks, not only the last export', () => {
    // The finish flow works on the work area: a result kept from an earlier pass
    // (`clips: keep`) must not disappear when another export records a smaller selection.
    const withOrder = record({ order: ['b'] });
    expect(listTrackedClips(withOrder).map((clip) => clip.segId)).toStrictEqual(['b', 'a']);
  });

  it('puts the recorded order first and the rest in timeline order', () => {
    const three = record({
      order: ['c'],
      segments: {
        a: { start: 0, end: 5, path: '/clips/a.mp4' },
        b: { start: 5, end: 10, path: '/clips/b.mp4' },
        c: { start: 10, end: 20, path: '/clips/c.mp4' },
      },
    });
    expect(listTrackedClips(three).map((clip) => clip.segId)).toStrictEqual(['c', 'a', 'b']);
  });

  it('has nothing to list without a record', () => {
    expect(listTrackedClips(undefined)).toStrictEqual([]);
  });

  it('keeps the identity a result is recorded with', () => {
    expect(listTrackedClips(record())[0]).toEqual({ segId: 'a', start: 0, end: 10, label: 'a', path: '/clips/a.mp4', signature: 'sig-a' });
  });
});

describe('collectMergeClips with a recorded cut-queue order', () => {
  it('follows the order the last export recorded, not the start times', () => {
    // The user dragged b before a; the merge must not undo that.
    expect(collectMergeClips(record({ order: ['b', 'a'] })).map((clip) => clip.segId)).toStrictEqual(['b', 'a']);
  });

  it('leaves out a result the order does not list (a segment taken out of the queue)', () => {
    expect(collectMergeClips(record({ order: ['b'] })).map((clip) => clip.segId)).toStrictEqual(['b']);
  });

  it('ignores an identity the record does not hold', () => {
    expect(collectMergeClips(record({ order: ['gone', 'a', 'b'] })).map((clip) => clip.segId)).toStrictEqual(['a', 'b']);
  });

  it('falls back to timeline order when the order names nothing it knows', () => {
    expect(collectMergeClips(record({ order: ['gone'] })).map((clip) => clip.segId)).toStrictEqual(['a', 'b']);
  });

  it('changes the merged fingerprint when only the order changes', () => {
    const merge = {
      outFormat: 'mp4',
      ffmpegExperimental: false,
      preserveMovData: false,
      movFastStart: false,
      preserveMetadataOnMerge: false,
    };
    const forward = buildMergedSignatureInput({ segments: collectMergeClips(record({ order: ['a', 'b'] })), merge });
    const swapped = buildMergedSignatureInput({ segments: collectMergeClips(record({ order: ['b', 'a'] })), merge });

    expect(JSON.stringify(swapped)).not.toBe(JSON.stringify(forward));
  });
});

describe('buildMergedSignatureInput', () => {
  const segments = [
    { segId: 'a', start: 0, end: 10, label: 'a', signature: 'sig-a' },
    { segId: 'b', start: 10, end: 20, signature: 'sig-b' },
  ];
  const merge = {
    outFormat: 'mp4',
    ffmpegExperimental: false,
    preserveMovData: false,
    movFastStart: false,
    preserveMetadataOnMerge: false,
  };

  it('keeps the export signature shape', () => {
    const input = buildMergedSignatureInput({ segments, merge });
    expect(Object.keys(input)).toStrictEqual(['version', 'segments', 'merge']);
    expect(Object.keys(input.segments[0]!)).toStrictEqual(['segId', 'start', 'end', 'label', 'signature']);
    expect(Object.keys(input.merge)).toStrictEqual(['outFormat', 'ffmpegExperimental', 'preserveMovData', 'movFastStart', 'preserveMetadataOnMerge']);
    expect(input.segments[0]!.signature).toBe('sig-a');
  });

  it('serializes an absent label the way the export does', () => {
    const input = buildMergedSignatureInput({ segments, merge });
    expect(JSON.stringify(input.segments[1])).toBe('{"segId":"b","start":10,"end":20,"signature":"sig-b"}');
  });

  it('changes when a clip was cut with other parameters', () => {
    // The merged file is the concatenation of the clips: a clip that was cut with other parameters
    // makes the merged file different, even when the export settings did not change.
    const changed = buildMergedSignatureInput({ segments: [{ ...segments[0]!, signature: 'other' }, segments[1]!], merge });
    expect(JSON.stringify(changed)).not.toBe(JSON.stringify(buildMergedSignatureInput({ segments, merge })));
  });

  it('changes when the last clip uses another tail rule', () => {
    const withTail = buildMergedSignatureInput({ segments: [{ ...segments[0]! }, { ...segments[1]!, tail: 'end' as const }], merge });
    expect(JSON.stringify(withTail)).not.toBe(JSON.stringify(buildMergedSignatureInput({ segments, merge })));
    expect(JSON.stringify(withTail.segments[1])).toContain('"tail":"end"');
  });

  it('does not change when the project file quantized the times', () => {
    // The readable `.llc` format stores times with nanosecond precision, so reopening a project
    // yields slightly different doubles. They are below the cut precision and must not rebuild the
    // merged file.
    const generated = [{ ...segments[0]!, start: 3600 / 7, end: 7200 / 7 }];
    const quantized = [{ ...segments[0]!, start: 514.285714286, end: 1028.571428571 }];
    expect(JSON.stringify(buildMergedSignatureInput({ segments: generated, merge }))).toBe(JSON.stringify(buildMergedSignatureInput({ segments: quantized, merge })));
  });
});

describe('buildMergedInputs', () => {
  const clips = collectMergeClips(record());

  it('keeps what identifies a result and rounds its times', () => {
    expect(buildMergedInputs(clips)).toStrictEqual([
      { segId: 'a', start: 0, end: 10, signature: 'sig-a' },
      { segId: 'b', start: 10, end: 20, signature: 'sig-b' },
    ]);
    expect(buildMergedInputs([{ segId: 'a', start: 1.0000000001, end: 2.0000000002, signature: 's' }]))
      .toStrictEqual([{ segId: 'a', start: 1, end: 2, signature: 's' }]);
  });

  it('leaves the signature out of a result that has none', () => {
    expect(buildMergedInputs([{ segId: 'a', start: 0, end: 10 }])).toStrictEqual([{ segId: 'a', start: 0, end: 10 }]);
  });

  it('keeps the tail rule of a result', () => {
    expect(buildMergedInputs([{ segId: 'a', start: 0, end: 10, signature: 's', tail: 'end' }]))
      .toStrictEqual([{ segId: 'a', start: 0, end: 10, signature: 's', tail: 'end' }]);
  });
});

describe('mergedClipsMatchInputs', () => {
  const clips = collectMergeClips(record());
  const inputs = buildMergedInputs(clips);

  it('proves a merge that was made of exactly these results', () => {
    expect(mergedClipsMatchInputs({ inputs, clips })).toBe(true);
  });

  it('has nothing to prove without a recorded merge', () => {
    expect(mergedClipsMatchInputs({ inputs: undefined, clips })).toBe(false);
  });

  it('rejects a different set of results', () => {
    expect(mergedClipsMatchInputs({ inputs, clips: clips.slice(0, 1) })).toBe(false);
    expect(mergedClipsMatchInputs({ inputs, clips: [{ ...clips[0]!, segId: 'other' }, clips[1]!] })).toBe(false);
    // A result the merge did not know about: the merged file does not contain it.
    expect(mergedClipsMatchInputs({ inputs: inputs.slice(0, 1), clips })).toBe(false);
  });

  it('accepts the same results in another order', () => {
    // The merge joined them in another order; the same material is in the file either way.
    expect(mergedClipsMatchInputs({ inputs: [...inputs].reverse(), clips })).toBe(true);
    expect(mergedClipsMatchInputs({ inputs, clips: [...clips].reverse() })).toBe(true);
  });

  it('rejects a result named twice', () => {
    expect(mergedClipsMatchInputs({ inputs: [inputs[0]!, inputs[0]!], clips: clips.slice(0, 2) })).toBe(false);
  });

  it('rejects a result that was cut again after the merge', () => {
    expect(mergedClipsMatchInputs({ inputs, clips: [{ ...clips[0]!, end: 11 }, clips[1]!] })).toBe(false);
    expect(mergedClipsMatchInputs({ inputs, clips: [{ ...clips[0]!, signature: 'other' }, clips[1]!] })).toBe(false);
    expect(mergedClipsMatchInputs({ inputs, clips: [{ ...clips[0]!, signature: undefined }, clips[1]!] })).toBe(false);
  });

  it('rejects a result whose tail rule changed after the merge', () => {
    expect(mergedClipsMatchInputs({ inputs, clips: [{ ...clips[0]!, tail: 'end' }, clips[1]!] })).toBe(false);
  });

  it('rejects a merge recorded from results without a signature', () => {
    const unsigned = [{ segId: 'a', start: 0, end: 10 }];
    expect(mergedClipsMatchInputs({ inputs: buildMergedInputs(unsigned), clips: unsigned })).toBe(false);
  });
});

describe('buildMergedSignatureInput', () => {
  const merge = {
    outFormat: 'mp4',
    ffmpegExperimental: false,
    preserveMovData: false,
    movFastStart: false,
    preserveMetadataOnMerge: false,
  };

  it('includes the label when it is written into the file', () => {
    const input = buildMergedSignatureInput({ segments: [{ segId: 'a', start: 0, end: 10, label: 'one' }], merge });
    expect(input.version).toBe(2);
    expect(input.segments[0]).toMatchObject({ label: 'one' });
  });

  it('ignores the label when only the file name uses it', () => {
    const input = buildMergedSignatureInput({ segments: [{ segId: 'a', start: 0, end: 10, label: 'one' }], merge, labelsAffectContent: false });
    expect(input.version).toBe(3);
    expect(input.segments[0]).not.toHaveProperty('label');
  });

  it('gives the same fingerprint to two labels that are not written', () => {
    const segmentsOf = (label: string) => buildMergedSignatureInput({ segments: [{ segId: 'a', start: 0, end: 10, label }], merge, labelsAffectContent: false });
    expect(segmentsOf('one')).toStrictEqual(segmentsOf('two'));
  });
});
