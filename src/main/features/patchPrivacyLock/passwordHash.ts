import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

import type { PatchHistoryPasswordRecord } from '../../../common/features/patchPrivacyLock/index.js';

/**
The password hashing of the work-history lock (fork-owned).

The password is never stored, and never logged. A random salt and scrypt (Node's defaults:
N=16384, r=8, p=1) produce the stored hash; verification re-derives it and compares in constant
time. This is deliberately a correct password hash rather than reversible encryption: there is no
key the app could store next to it that would make encryption mean anything.
*/

/** Bytes of the derived key. Stored in the record so an older record stays verifiable. */
export const patchHistoryPasswordKeyLength = 64;

const saltLength = 16;

function scryptAsync(password: string, salt: string, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, (error, derivedKey) => {
      if (error != null) reject(error);
      else resolve(derivedKey);
    });
  });
}

export async function createHistoryPasswordRecord(password: string, { defaultPassword = false, createdAt = Date.now() }: { defaultPassword?: boolean, createdAt?: number } = {}): Promise<PatchHistoryPasswordRecord> {
  const salt = randomBytes(saltLength).toString('base64');
  const derivedKey = await scryptAsync(password, salt, patchHistoryPasswordKeyLength);
  return {
    version: 1,
    algorithm: 'scrypt',
    salt,
    hash: derivedKey.toString('base64'),
    keyLength: patchHistoryPasswordKeyLength,
    createdAt,
    ...(defaultPassword && { defaultPassword: true }),
  };
}

/** Does the password match the record? A malformed record simply does not match. */
export async function verifyHistoryPassword(password: string, record: PatchHistoryPasswordRecord): Promise<boolean> {
  try {
    const expected = Buffer.from(record.hash, 'base64');
    const actual = await scryptAsync(password, record.salt, record.keyLength);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
