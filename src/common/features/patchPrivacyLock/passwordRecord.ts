import type { PatchHistoryPasswordRecord } from './types.js';
import {
  patchHistoryLockDefaultIdleMinutes,
  patchHistoryLockMaxIdleMinutes,
  patchHistoryLockMinIdleMinutes,
  patchHistoryPasswordMaxLength,
} from './types.js';

/**
Password records and the small pure rules around them (fork-owned).

The record is written by the main process (`features/patchPrivacyLock`); the renderer only reads the
types and the validation reasons. Everything here fails closed: a malformed record is rejected
instead of being guessed at.
*/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

/** A password record read from disk, or `undefined` when the file is malformed. */
export function parseHistoryPasswordRecord(value: unknown): PatchHistoryPasswordRecord | undefined {
  if (!isRecord(value)) return undefined;
  if (value['version'] !== 1 || value['algorithm'] !== 'scrypt') return undefined;
  const { salt, hash, keyLength, createdAt, defaultPassword } = value;
  if (typeof salt !== 'string' || salt === '') return undefined;
  if (typeof hash !== 'string' || hash === '') return undefined;
  if (typeof keyLength !== 'number' || !Number.isInteger(keyLength) || keyLength < 16 || keyLength > 128) return undefined;
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return undefined;
  return {
    version: 1,
    algorithm: 'scrypt',
    salt,
    hash,
    keyLength,
    createdAt,
    ...(defaultPassword === true && { defaultPassword: true }),
  };
}

export type PatchHistoryPasswordProblem = 'empty' | 'too-long';

/**
Why a typed password cannot be used, or `undefined` when it can.

Only an empty (or whitespace-only) password and absurd length are refused. Leading and trailing
spaces are kept: the user typed them, and this lock is not a place to silently rewrite secrets.
*/
export function validateHistoryPassword(password: string): PatchHistoryPasswordProblem | undefined {
  if (typeof password !== 'string' || password.trim() === '') return 'empty';
  if (password.length > patchHistoryPasswordMaxLength) return 'too-long';
  return undefined;
}

/** Clamp a stored idle time to the range the settings offer. */
export function clampHistoryLockIdleMinutes(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return patchHistoryLockDefaultIdleMinutes;
  return Math.min(patchHistoryLockMaxIdleMinutes, Math.max(patchHistoryLockMinIdleMinutes, Math.round(value)));
}
