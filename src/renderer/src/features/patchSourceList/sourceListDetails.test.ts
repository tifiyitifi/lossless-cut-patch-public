// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { buildSourceListDetail, isDetailField } from './sourceListDetails';

describe('buildSourceListDetail', () => {
  it('shows duration, size and time in that order', () => {
    const parts = buildSourceListDetail({ duration: 3725, size: 1.25 * 1024 * 1024, mtime: new Date(2026, 10, 5, 9, 7).getTime() });
    expect(parts).toStrictEqual([
      { field: 'duration', text: '01:02:05' },
      { field: 'size', text: '1.3 MB' },
      { field: 'mtime', text: '2026-11-05 09:07' },
    ]);
  });

  it('drops the values the row does not have instead of printing a placeholder', () => {
    expect(buildSourceListDetail({ size: 2048 })).toStrictEqual([{ field: 'size', text: '2.0 KB' }]);
    expect(buildSourceListDetail({})).toStrictEqual([]);
    expect(buildSourceListDetail(undefined)).toStrictEqual([]);
  });

  it('treats a zero duration as unknown, exactly like the sort does', () => {
    expect(buildSourceListDetail({ duration: 0, size: 100 })).toStrictEqual([{ field: 'size', text: '100 B' }]);
  });

  it('shows a zero size, because that is what a failed export leaves behind', () => {
    expect(buildSourceListDetail({ size: 0 })).toStrictEqual([{ field: 'size', text: '0 B' }]);
  });

  it('keeps the milliseconds of a result shorter than a second', () => {
    expect(buildSourceListDetail({ duration: 0.4 })).toStrictEqual([{ field: 'duration', text: '00:00:00.400' }]);
  });

  it('keeps the order when the sort key puts the time first', () => {
    const parts = buildSourceListDetail({ duration: 5, size: 100, mtime: new Date(2026, 0, 2, 3, 4).getTime() });
    expect(parts.map((part) => part.field)).toStrictEqual(['duration', 'size', 'mtime']);
  });
});

describe('isDetailField', () => {
  it('accepts only the keys the detail line shows', () => {
    expect(isDetailField('duration')).toBe(true);
    expect(isDetailField('size')).toBe(true);
    expect(isDetailField('mtime')).toBe(true);
    expect(isDetailField('name')).toBe(false);
    expect(isDetailField('ext')).toBe(false);
    expect(isDetailField(undefined)).toBe(false);
  });
});
