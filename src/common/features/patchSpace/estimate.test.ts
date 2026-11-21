// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import {
  estimateConcatBytes, estimateCutBytes, estimateSegmentBytes, evaluatePatchSpace, patchSpaceFileOverheadBytes, patchSpaceMinFreeBytes,
  patchSpaceSafetyFactor, requiredWriteBytes,
} from './estimate.js';

const MiB = 1024 * 1024;

describe('estimateCutBytes', () => {
  it('scales the source size by the selected duration', () => {
    const sourceBytes = 1000 * MiB;
    expect(estimateCutBytes({
      sourceBytes,
      sourceDuration: 100,
      segments: [{ start: 0, end: 50 }],
      mode: 'copy',
    })).toBe(500 * MiB + patchSpaceFileOverheadBytes);

    expect(estimateCutBytes({
      sourceBytes,
      sourceDuration: 100,
      segments: [{ start: 10, end: 20 }, { start: 30, end: 50 }],
      mode: 'copy',
    })).toBe(300 * MiB + 2 * patchSpaceFileOverheadBytes);
  });

  it('does not clamp overlapping segments (the same data is copied twice)', () => {
    const sourceBytes = 1000 * MiB;
    expect(estimateCutBytes({
      sourceBytes,
      sourceDuration: 100,
      segments: [{ start: 0, end: 100 }, { start: 0, end: 100 }],
      mode: 'copy',
    })).toBe(2000 * MiB + 2 * patchSpaceFileOverheadBytes);
  });

  it('leaves more room for smart cut and lossy encoding', () => {
    const base = { sourceBytes: 1000 * MiB, sourceDuration: 100, segments: [{ start: 0, end: 100 }] };
    expect(estimateCutBytes({ ...base, mode: 'copy' })).toBe(1000 * MiB + patchSpaceFileOverheadBytes);
    expect(estimateCutBytes({ ...base, mode: 'smartcut' })).toBe(2200 * MiB + patchSpaceFileOverheadBytes);
    expect(estimateCutBytes({ ...base, mode: 'lossy' })).toBe(1500 * MiB + patchSpaceFileOverheadBytes);
  });

  it('returns undefined when the source size or duration is unknown', () => {
    const base = { sourceBytes: 1000 * MiB, sourceDuration: 100, segments: [{ start: 0, end: 10 }], mode: 'copy' as const };
    expect(estimateCutBytes({ ...base, sourceBytes: 0 })).toBeUndefined();
    expect(estimateCutBytes({ ...base, sourceBytes: NaN })).toBeUndefined();
    expect(estimateCutBytes({ ...base, sourceDuration: undefined })).toBeUndefined();
    expect(estimateCutBytes({ ...base, sourceDuration: 0 })).toBeUndefined();
  });

  it('returns zero when no segment copies anything', () => {
    expect(estimateCutBytes({
      sourceBytes: 1000 * MiB,
      sourceDuration: 100,
      segments: [],
      mode: 'copy',
    })).toBe(0);
    expect(estimateCutBytes({
      sourceBytes: 1000 * MiB,
      sourceDuration: 100,
      segments: [{ start: 20, end: 10 }],
      mode: 'copy',
    })).toBe(0);
  });
});

describe('estimateSegmentBytes', () => {
  it('measures the data alone, so a concatenation adds its overhead once', () => {
    const sourceBytes = 1000 * MiB;
    const data = estimateSegmentBytes({
      sourceBytes,
      sourceDuration: 100,
      segments: [{ start: 10, end: 20 }, { start: 30, end: 50 }],
      mode: 'copy',
    });
    expect(data).toBe(300 * MiB);
    // The cut files add their own overhead, the merged file adds one (not one per input).
    expect(estimateCutBytes({
      sourceBytes,
      sourceDuration: 100,
      segments: [{ start: 10, end: 20 }, { start: 30, end: 50 }],
      mode: 'copy',
    })).toBe((data as number) + 2 * patchSpaceFileOverheadBytes);
    expect(estimateConcatBytes({ inputBytes: data as number })).toBe((data as number) + patchSpaceFileOverheadBytes);
  });

  it('returns undefined when the source size or duration is unknown, and zero for nothing', () => {
    const base = { sourceBytes: 1000 * MiB, sourceDuration: 100, segments: [{ start: 0, end: 10 }], mode: 'copy' as const };
    expect(estimateSegmentBytes({ ...base, sourceDuration: undefined })).toBeUndefined();
    expect(estimateSegmentBytes({ ...base, segments: [] })).toBe(0);
  });
});

describe('estimateConcatBytes', () => {
  it('adds the container overhead to the sum of the inputs', () => {
    expect(estimateConcatBytes({ inputBytes: 100 * MiB })).toBe(100 * MiB + patchSpaceFileOverheadBytes);
    expect(estimateConcatBytes({ inputBytes: 0 })).toBe(patchSpaceFileOverheadBytes);
    expect(estimateConcatBytes({ inputBytes: NaN })).toBe(patchSpaceFileOverheadBytes);
  });
});

describe('requiredWriteBytes', () => {
  it('subtracts the space an in-place overwrite frees', () => {
    expect(requiredWriteBytes({ estimatedBytes: 100 * MiB, reclaimBytes: 40 * MiB })).toBe(60 * MiB);
    expect(requiredWriteBytes({ estimatedBytes: 100 * MiB })).toBe(100 * MiB);
    expect(requiredWriteBytes({ estimatedBytes: 40 * MiB, reclaimBytes: 60 * MiB })).toBe(0);
    expect(requiredWriteBytes({ estimatedBytes: 100 * MiB, reclaimBytes: NaN })).toBe(100 * MiB);
  });
});

describe('evaluatePatchSpace', () => {
  it('adds the safety margin and the free-space floor', () => {
    const required = 100 * MiB;
    const target = Math.ceil(required * patchSpaceSafetyFactor + patchSpaceMinFreeBytes);
    expect(evaluatePatchSpace({ requiredBytes: required, freeBytes: target })).toStrictEqual({
      sufficient: true,
      requiredBytes: target,
      freeBytes: target,
      shortfallBytes: 0,
    });
    expect(evaluatePatchSpace({ requiredBytes: required, freeBytes: target - 1 })).toStrictEqual({
      sufficient: false,
      requiredBytes: target,
      freeBytes: target - 1,
      shortfallBytes: 1,
    });
  });

  it('never warns when there is nothing to write', () => {
    expect(evaluatePatchSpace({ requiredBytes: 0, freeBytes: 0 }).sufficient).toBe(true);
    expect(evaluatePatchSpace({ requiredBytes: NaN, freeBytes: 0 }).sufficient).toBe(true);
  });

  it('treats an unusable free-space value as zero', () => {
    expect(evaluatePatchSpace({ requiredBytes: 1, freeBytes: NaN }).sufficient).toBe(false);
    expect(evaluatePatchSpace({ requiredBytes: 1, freeBytes: -1 }).sufficient).toBe(false);
  });
});
