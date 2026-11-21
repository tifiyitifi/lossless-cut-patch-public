// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { clampHistoryLockIdleMinutes, parseHistoryPasswordRecord, validateHistoryPassword } from './passwordRecord.js';
import type { PatchHistoryPasswordRecord } from './types.js';

const validRecord: PatchHistoryPasswordRecord = {
  version: 1,
  algorithm: 'scrypt',
  salt: 'c2FsdA==',
  hash: 'aGFzaA==',
  keyLength: 64,
  createdAt: 1_700_000_000_000,
};

describe('parseHistoryPasswordRecord', () => {
  it('reads a well-formed record', () => {
    expect(parseHistoryPasswordRecord(validRecord)).toStrictEqual(validRecord);
    expect(parseHistoryPasswordRecord({ ...validRecord, defaultPassword: true })).toMatchObject({ defaultPassword: true });
  });

  it('rejects anything malformed instead of guessing', () => {
    expect(parseHistoryPasswordRecord(undefined)).toBeUndefined();
    expect(parseHistoryPasswordRecord([])).toBeUndefined();
    expect(parseHistoryPasswordRecord({ ...validRecord, version: 2 })).toBeUndefined();
    expect(parseHistoryPasswordRecord({ ...validRecord, algorithm: 'sha1' })).toBeUndefined();
    expect(parseHistoryPasswordRecord({ ...validRecord, salt: '' })).toBeUndefined();
    expect(parseHistoryPasswordRecord({ ...validRecord, hash: 42 })).toBeUndefined();
    expect(parseHistoryPasswordRecord({ ...validRecord, keyLength: 8 })).toBeUndefined();
    expect(parseHistoryPasswordRecord({ ...validRecord, keyLength: 64.5 })).toBeUndefined();
    expect(parseHistoryPasswordRecord({ ...validRecord, createdAt: NaN })).toBeUndefined();
  });

  it('only keeps the default flag when it is exactly true', () => {
    expect(parseHistoryPasswordRecord({ ...validRecord, defaultPassword: 'yes' })?.defaultPassword).toBeUndefined();
    expect(parseHistoryPasswordRecord({ ...validRecord, defaultPassword: true })?.defaultPassword).toBe(true);
  });
});

describe('validateHistoryPassword', () => {
  it('accepts a non-empty password as typed, including spaces inside it', () => {
    expect(validateHistoryPassword('123456')).toBeUndefined();
    expect(validateHistoryPassword(' a b ')).toBeUndefined();
  });

  it('refuses empty, whitespace-only and absurdly long passwords', () => {
    expect(validateHistoryPassword('')).toBe('empty');
    expect(validateHistoryPassword(' '.repeat(3))).toBe('empty');
    expect(validateHistoryPassword('a'.repeat(201))).toBe('too-long');
    expect(validateHistoryPassword('a'.repeat(200))).toBeUndefined();
  });
});

describe('clampHistoryLockIdleMinutes', () => {
  it('keeps the idle time in the configurable range', () => {
    expect(clampHistoryLockIdleMinutes(0)).toBe(1);
    expect(clampHistoryLockIdleMinutes(10)).toBe(10);
    expect(clampHistoryLockIdleMinutes(10.6)).toBe(11);
    expect(clampHistoryLockIdleMinutes(999)).toBe(240);
    expect(clampHistoryLockIdleMinutes('x')).toBe(10);
    expect(clampHistoryLockIdleMinutes(NaN)).toBe(10);
  });
});
