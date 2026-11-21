// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { createHistoryPasswordRecord, verifyHistoryPassword } from './passwordHash.js';

describe('password hashing', () => {
  it('accepts the password it was created for and refuses everything else', async () => {
    const record = await createHistoryPasswordRecord('secret');
    await expect(verifyHistoryPassword('secret', record)).resolves.toBe(true);
    await expect(verifyHistoryPassword('Secret', record)).resolves.toBe(false);
    await expect(verifyHistoryPassword('', record)).resolves.toBe(false);
    await expect(verifyHistoryPassword('secret ', record)).resolves.toBe(false);
  });

  it('uses a fresh salt for every record, so two records of one password differ', async () => {
    const first = await createHistoryPasswordRecord('secret');
    const second = await createHistoryPasswordRecord('secret');
    expect(first.salt).not.toBe(second.salt);
    expect(first.hash).not.toBe(second.hash);
    await expect(verifyHistoryPassword('secret', first)).resolves.toBe(true);
    await expect(verifyHistoryPassword('secret', second)).resolves.toBe(true);
  });

  it('marks the built-in default password', async () => {
    const regular = await createHistoryPasswordRecord('123456');
    const seeded = await createHistoryPasswordRecord('123456', { defaultPassword: true });
    expect(regular.defaultPassword).toBeUndefined();
    expect(seeded.defaultPassword).toBe(true);
  });

  it('does not throw on a damaged record', async () => {
    const record = await createHistoryPasswordRecord('secret');
    await expect(verifyHistoryPassword('secret', { ...record, hash: 'not base64!' })).resolves.toBe(false);
    await expect(verifyHistoryPassword('secret', { ...record, salt: '' })).resolves.toBe(false);
  });
});
