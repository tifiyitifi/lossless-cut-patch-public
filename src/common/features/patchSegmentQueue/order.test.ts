// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { buildSegmentOrderNumbers } from './order.js';
import type { PatchQueueSegmentInput } from './order.js';

function seg(segId: string, start: number, end?: number, selected = true): PatchQueueSegmentInput {
  return { segId, start, end, selected };
}

describe('buildSegmentOrderNumbers', () => {
  it('ranks the segments by start time', () => {
    const numbers = buildSegmentOrderNumbers([seg('a', 0, 10), seg('b', 10, 20), seg('c', 20, 30)]);
    expect(numbers.get('a')).toStrictEqual({ startRank: 1, queueRank: 1 });
    expect(numbers.get('b')).toStrictEqual({ startRank: 2, queueRank: 2 });
    expect(numbers.get('c')).toStrictEqual({ startRank: 3, queueRank: 3 });
  });

  it('keeps the start rank when the queue is reordered', () => {
    const numbers = buildSegmentOrderNumbers([seg('c', 20, 30), seg('a', 0, 10), seg('b', 10, 20)]);
    expect(numbers.get('c')).toStrictEqual({ startRank: 3, queueRank: 1 });
    expect(numbers.get('a')).toStrictEqual({ startRank: 1, queueRank: 2 });
    expect(numbers.get('b')).toStrictEqual({ startRank: 2, queueRank: 3 });
  });

  it('breaks equal start times by the end time', () => {
    const numbers = buildSegmentOrderNumbers([seg('long', 5, 20), seg('short', 5, 10)]);
    expect(numbers.get('short')?.startRank).toBe(1);
    expect(numbers.get('long')?.startRank).toBe(2);
  });

  it('breaks equal times by the list order', () => {
    const numbers = buildSegmentOrderNumbers([seg('first', 5, 10), seg('second', 5, 10)]);
    expect(numbers.get('first')?.startRank).toBe(1);
    expect(numbers.get('second')?.startRank).toBe(2);
  });

  it('does not give a marker any number', () => {
    const numbers = buildSegmentOrderNumbers([seg('marker', 5), seg('a', 0, 10), seg('b', 20, 30)]);
    expect(numbers.has('marker')).toBe(false);
    expect(numbers.get('a')?.startRank).toBe(1);
    expect(numbers.get('b')?.startRank).toBe(2);
  });

  it('does not let a marker take a queue position', () => {
    const numbers = buildSegmentOrderNumbers([seg('a', 0, 10), seg('marker', 15), seg('b', 20, 30)]);
    expect(numbers.get('a')?.queueRank).toBe(1);
    expect(numbers.get('b')?.queueRank).toBe(2);
  });

  it('does not let an unselected segment take a queue position', () => {
    const numbers = buildSegmentOrderNumbers([
      seg('a', 0, 10),
      seg('b', 10, 20, false),
      seg('c', 20, 30),
    ]);
    expect(numbers.get('a')).toStrictEqual({ startRank: 1, queueRank: 1 });
    expect(numbers.get('b')).toStrictEqual({ startRank: 2 });
    expect(numbers.get('c')).toStrictEqual({ startRank: 3, queueRank: 2 });
  });

  it('handles overlapping segments', () => {
    const numbers = buildSegmentOrderNumbers([seg('a', 0, 20), seg('b', 10, 30)]);
    expect(numbers.get('a')).toStrictEqual({ startRank: 1, queueRank: 1 });
    expect(numbers.get('b')).toStrictEqual({ startRank: 2, queueRank: 2 });
  });

  it('handles an empty list', () => {
    expect(buildSegmentOrderNumbers([]).size).toBe(0);
  });
});
