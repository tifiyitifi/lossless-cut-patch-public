// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, test } from 'vitest';

import { isPidLockFileStale, parsePidLockFile, serializePidLockFile } from './pidLock.js';

describe('parsePidLockFile', () => {
  test('reads a lock the app wrote', () => {
    expect(parsePidLockFile('{"pid":123,"startedAt":1000}')).toStrictEqual({ pid: 123, startedAt: 1000 });
  });

  test('rejects anything unusable instead of blocking the app', () => {
    expect(parsePidLockFile('')).toBeUndefined();
    expect(parsePidLockFile('not json')).toBeUndefined();
    expect(parsePidLockFile('[]')).toBeUndefined();
    expect(parsePidLockFile('null')).toBeUndefined();
    expect(parsePidLockFile('{"pid":0,"startedAt":1}')).toBeUndefined();
    expect(parsePidLockFile('{"pid":"123","startedAt":1}')).toBeUndefined();
    expect(parsePidLockFile('{"pid":12.5,"startedAt":1}')).toBeUndefined();
    expect(parsePidLockFile('{"pid":123}')).toBeUndefined();
    expect(parsePidLockFile('{"pid":123,"startedAt":"now"}')).toBeUndefined();
  });

  test('survives a round trip', () => {
    const text = serializePidLockFile({ pid: 7, startedAt: 42 });
    expect(parsePidLockFile(text)).toStrictEqual({ pid: 7, startedAt: 42 });
  });
});

describe('isPidLockFileStale', () => {
  const lock = { pid: 1, startedAt: 1000 };

  test('a dead owner means the lock may be taken over', () => {
    expect(isPidLockFileStale({ lock, alive: false, now: 2000, staleMs: 0 })).toBe(true);
  });

  test('a live owner keeps the lock, however old', () => {
    expect(isPidLockFileStale({ lock, alive: true, now: 10_000_000, staleMs: 0 })).toBe(false);
  });

  test('a live owner past the fallback age is treated as a reused pid', () => {
    expect(isPidLockFileStale({ lock, alive: true, now: 1000 + 5000, staleMs: 4000 })).toBe(true);
    expect(isPidLockFileStale({ lock, alive: true, now: 1000 + 3000, staleMs: 4000 })).toBe(false);
  });
});
