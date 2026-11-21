// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, test } from 'vitest';

import {
  fileClaimFileName, findPathsClaimedElsewhere, isClaimStale, isFileClaimConflict, normalizeClaimPath, parseClaimFile, serializeClaimFile,
} from './claim.js';

describe('normalizeClaimPath', () => {
  test('compares paths the way the file system does', () => {
    expect(normalizeClaimPath(String.raw`C:\Videos\A.mp4`, true)).toBe('c:/videos/a.mp4');
    expect(normalizeClaimPath('C:/Videos/A.mp4', true)).toBe(normalizeClaimPath('C:/Videos/A.mp4/', true));
  });

  test('keeps the case on a case-sensitive file system', () => {
    expect(normalizeClaimPath('C:/Videos/A.mp4', false)).toBe('C:/Videos/A.mp4');
    expect(normalizeClaimPath('C:/videos/a.mp4', false)).not.toBe(normalizeClaimPath('C:/Videos/A.mp4', false));
  });
});

describe('fileClaimFileName', () => {
  test('is a stable hash of the normalized path', () => {
    expect(fileClaimFileName({ path: String.raw`C:\Videos\A.mp4`, caseInsensitive: true, prefix: 'source' }))
      .toBe(fileClaimFileName({ path: 'C:/videos/a.mp4', caseInsensitive: true, prefix: 'source' }));
    expect(fileClaimFileName({ path: 'C:/Videos/A.mp4', caseInsensitive: true, prefix: 'source' }))
      .not.toBe(fileClaimFileName({ path: 'C:/Videos/B.mp4', caseInsensitive: true, prefix: 'source' }));
    expect(fileClaimFileName({ path: 'C:/Videos/A.mp4', caseInsensitive: true, prefix: 'source' })).toMatch(/^source-[0-9a-f]{16}\.json$/);
  });

  test('keeps the two kinds of claim apart', () => {
    // A source and a result with the same path are different files in the app's eyes.
    expect(fileClaimFileName({ path: 'C:/a.mp4', caseInsensitive: true, prefix: 'source' }))
      .not.toBe(fileClaimFileName({ path: 'C:/a.mp4', caseInsensitive: true, prefix: 'result' }));
  });
});

describe('parseClaimFile', () => {
  test('reads a claim the app wrote', () => {
    const claim = { pid: 12, startedAt: 34, path: 'c:/a.mp4' };
    expect(parseClaimFile(serializeClaimFile(claim))).toStrictEqual(claim);
  });

  test('rejects garbage', () => {
    expect(parseClaimFile('')).toBeUndefined();
    expect(parseClaimFile('{}')).toBeUndefined();
    expect(parseClaimFile('{"pid":1,"startedAt":2}')).toBeUndefined();
    expect(parseClaimFile('{"pid":1,"startedAt":2,"path":""}')).toBeUndefined();
  });
});

describe('isFileClaimConflict', () => {
  const claim = { pid: 7, startedAt: 1000, path: 'c:/videos/a.mp4' };
  const base = { claim, path: 'C:/Videos/A.mp4', caseInsensitive: true, ownPid: 100, alive: true, now: 2000, staleMs: 0 };

  test('an open video in another live window is a conflict', () => {
    expect(isFileClaimConflict(base)).toBe(true);
  });

  test('the same window may reopen its file (a reload)', () => {
    expect(isFileClaimConflict({ ...base, ownPid: 7 })).toBe(false);
  });

  test('another video is not a conflict, even under the same hash', () => {
    expect(isFileClaimConflict({ ...base, claim: { ...claim, path: 'c:/videos/b.mp4' } })).toBe(false);
  });

  test('a dead window leaves no conflict', () => {
    expect(isFileClaimConflict({ ...base, alive: false })).toBe(false);
  });

  test('an old claim is taken over even when the pid is alive (a reused pid)', () => {
    expect(isFileClaimConflict({ ...base, now: 1000 + 5000, staleMs: 4000 })).toBe(false);
  });

  test('respects the case sensitivity of the file system', () => {
    expect(isFileClaimConflict({ ...base, caseInsensitive: false })).toBe(false);
  });
});

describe('isClaimStale', () => {
  const claim = { pid: 7, startedAt: 1000, path: 'c:/a.mp4' };

  test('a dead owner is stale', () => {
    expect(isClaimStale({ claim, alive: false, now: 2000 })).toBe(true);
  });

  test('a live owner within the fallback age is not stale', () => {
    expect(isClaimStale({ claim, alive: true, now: 1000 + 23 * 60 * 60 * 1000 })).toBe(false);
  });

  test('a live owner past the fallback age is treated as a reused pid', () => {
    expect(isClaimStale({ claim, alive: true, now: 1000 + 25 * 60 * 60 * 1000 })).toBe(true);
  });
});

describe('findPathsClaimedElsewhere', () => {
  const claim = (path: string, pid: number) => ({ claim: { pid, startedAt: 1000, path }, alive: true });

  test('returns the asked paths that another live window claims', () => {
    expect(findPathsClaimedElsewhere({
      claims: [claim('c:/clips/a.mp4', 7), claim('c:/clips/b.mp4', 8)],
      paths: ['C:/clips/A.mp4', 'C:/clips/c.mp4'],
      ownPid: 100,
      caseInsensitive: true,
      now: 2000,
    })).toStrictEqual(['C:/clips/A.mp4']);
  });

  test('ignores this window’s own claims', () => {
    expect(findPathsClaimedElsewhere({
      claims: [claim('c:/clips/a.mp4', 100)],
      paths: ['c:/clips/a.mp4'],
      ownPid: 100,
      caseInsensitive: true,
      now: 2000,
    })).toStrictEqual([]);
  });

  test('ignores dead and stale claims', () => {
    expect(findPathsClaimedElsewhere({
      claims: [{ claim: { pid: 7, startedAt: 1000, path: 'c:/clips/a.mp4' }, alive: false }],
      paths: ['c:/clips/a.mp4'],
      ownPid: 100,
      caseInsensitive: true,
    })).toStrictEqual([]);

    expect(findPathsClaimedElsewhere({
      claims: [claim('c:/clips/a.mp4', 7)],
      paths: ['c:/clips/a.mp4'],
      ownPid: 100,
      caseInsensitive: true,
      now: 1000 + 25 * 60 * 60 * 1000,
    })).toStrictEqual([]);
  });

  test('is empty when nothing is asked or nothing is claimed', () => {
    expect(findPathsClaimedElsewhere({ claims: [claim('c:/a.mp4', 7)], paths: [], ownPid: 100, caseInsensitive: true })).toStrictEqual([]);
    expect(findPathsClaimedElsewhere({ claims: [], paths: ['c:/a.mp4'], ownPid: 100, caseInsensitive: true })).toStrictEqual([]);
  });
});
