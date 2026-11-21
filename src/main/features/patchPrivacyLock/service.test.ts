// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { PatchHistoryPasswordRecord } from '../../../common/features/patchPrivacyLock/index.js';
import { createPatchHistoryLockService } from './service.js';
import type { PatchHistoryLockService, PatchHistoryLockSettings } from './service.js';

interface HarnessOptions {
  settings?: Partial<PatchHistoryLockSettings> | undefined;
  record?: PatchHistoryPasswordRecord | undefined;
  invalidFile?: boolean | undefined;
  failWrites?: boolean | undefined;
}

function recordFor(password: string, defaultPassword = false): PatchHistoryPasswordRecord {
  return {
    version: 1,
    algorithm: 'scrypt',
    salt: 'salt',
    hash: `hash:${password}`,
    keyLength: 64,
    createdAt: 1,
    ...(defaultPassword && { defaultPassword: true }),
  };
}

function createHarness({ settings: initialSettings, record, invalidFile = false, failWrites = false }: HarnessOptions = {}) {
  const settings: PatchHistoryLockSettings = {
    mode: 'manual',
    idleMinutes: 10,
    initialized: true,
    locked: true,
    seedPending: false,
    events: [],
    ...initialSettings,
  };
  let storedRecord = record;
  let invalid = invalidFile;
  let writesFail = failWrites;
  let notifications = 0;
  let clock = 1_000;

  const service: PatchHistoryLockService = createPatchHistoryLockService({
    resolveFilePath: async () => 'C:/work/lock.json',
    getSettings: () => ({ ...settings, events: [...settings.events] }),
    setSettings: (patch) => { Object.assign(settings, patch); },
    notify: () => { notifications += 1; },
    log: () => undefined,
    now: () => { clock += 1; return clock; },
    readFile: async () => (invalid ? { kind: 'invalid' } : (storedRecord != null ? { kind: 'ok', record: storedRecord } : { kind: 'missing' })),
    writeFile: async (_path, next) => {
      if (writesFail) throw new Error('EACCES');
      storedRecord = next;
      invalid = false;
    },
    createRecord: async (password, options) => recordFor(password, options?.defaultPassword === true),
    verify: async (password, candidate) => candidate.hash === `hash:${password}`,
  });

  return {
    service,
    settings,
    get record() { return storedRecord; },
    get notifications() { return notifications; },
    setWritesFail(value: boolean) { writesFail = value; },
    removeFile() { storedRecord = undefined; invalid = false; },
    corruptFile() { storedRecord = undefined; invalid = true; },
  };
}

describe('patch history lock service', () => {
  it('creates the default password on the first run and starts locked', async () => {
    const harness = createHarness({ settings: { initialized: false, events: [] }, record: undefined });

    const status = await harness.service.status();

    expect(status).toMatchObject({ enabled: true, unlocked: false, isDefaultPassword: true, filePath: 'C:/work/lock.json' });
    expect(harness.record?.hash).toBe('hash:123456');
    expect(harness.settings.initialized).toBe(true);
    expect(harness.settings.locked).toBe(true);
    expect(harness.settings.events.map((event) => event.type)).toStrictEqual(['created']);
  });

  it('adopts an existing record without resetting it', async () => {
    const harness = createHarness({ settings: { initialized: false, locked: false, events: [] }, record: recordFor('secret') });

    const status = await harness.service.status();

    expect(status).toMatchObject({ enabled: true, unlocked: true, isDefaultPassword: false });
    expect(status.events).toStrictEqual([]);
    expect(harness.settings.initialized).toBe(true);
  });

  it('remembers the last state in manual mode', async () => {
    const unlocked = createHarness({ settings: { mode: 'manual', locked: false }, record: recordFor('secret') });
    const locked = createHarness({ settings: { mode: 'manual', locked: true }, record: recordFor('secret') });

    expect((await unlocked.service.status()).unlocked).toBe(true);
    expect((await locked.service.status()).unlocked).toBe(false);
  });

  it('always starts locked in startup and idle mode, whatever the stored state says', async () => {
    for (const mode of ['startup', 'idle'] as const) {
      const harness = createHarness({ settings: { mode, locked: false }, record: recordFor('secret') });
      expect((await harness.service.status()).unlocked).toBe(false);
    }
  });

  it('logs each successful unlock and refuses a wrong password without a log entry', async () => {
    const harness = createHarness({ record: recordFor('secret') });

    await expect(harness.service.unlock('nope')).resolves.toStrictEqual({ ok: false, reason: 'wrong-password' });
    expect(harness.settings.events).toStrictEqual([]);

    const result = await harness.service.unlock('secret');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.status.unlocked).toBe(true);
    expect(harness.settings.locked).toBe(false);
    expect(harness.settings.events.map((event) => event.type)).toStrictEqual(['unlocked']);
  });

  it('locks without adding an event', async () => {
    const harness = createHarness({ settings: { locked: false }, record: recordFor('secret') });

    const result = await harness.service.lock();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.status.unlocked).toBe(false);
    expect(harness.settings.locked).toBe(true);
    expect(harness.settings.events).toStrictEqual([]);
  });

  it('treats a deleted password file as a reset to the default password, not as switching the lock off', async () => {
    const harness = createHarness({ settings: { locked: false }, record: recordFor('secret') });
    expect((await harness.service.status()).unlocked).toBe(true);

    harness.removeFile();
    const status = await harness.service.status();

    expect(status).toMatchObject({ enabled: true, unlocked: false, isDefaultPassword: true });
    expect(harness.record?.hash).toBe('hash:123456');
    expect(harness.settings.locked).toBe(true);
    expect(harness.settings.events.map((event) => event.type)).toStrictEqual(['reset']);
    expect(harness.notifications).toBeGreaterThan(0);
  });

  it('keeps the in-memory default when the folder is not writable and does not log the reset twice', async () => {
    const harness = createHarness({ settings: { locked: false }, record: recordFor('secret') });
    await harness.service.status();
    harness.removeFile();
    harness.setWritesFail(true);

    const first = await harness.service.status();
    const second = await harness.service.status();

    expect(first).toMatchObject({ enabled: true, unlocked: false, isDefaultPassword: true, writeFailed: true });
    expect(second.writeFailed).toBe(true);
    expect(harness.settings.events.filter((event) => event.type === 'reset')).toHaveLength(1);
    expect((await harness.service.unlock('123456')).ok).toBe(true);
  });

  it('does not report a reset when the first seed never reached disk, even after a restart', async () => {
    const first = createHarness({ settings: { initialized: false, events: [] }, failWrites: true });

    const firstStatus = await first.service.status();

    expect(firstStatus).toMatchObject({ enabled: true, unlocked: false, isDefaultPassword: true, writeFailed: true });
    expect(first.settings.events.map((event) => event.type)).toStrictEqual(['created']);
    expect(first.settings.seedPending).toBe(true);
    expect(first.record).toBeUndefined();

    // A restart sees the same persisted settings, still has no file, and still cannot write. It must
    // retry the seed silently instead of reading "no file" as a reset.
    const second = createHarness({
      settings: { ...first.settings, events: [...first.settings.events] },
      failWrites: true,
    });
    const secondStatus = await second.service.status();

    expect(secondStatus.enabled).toBe(true);
    expect(secondStatus.unlocked).toBe(false);
    expect(second.settings.events.map((event) => event.type)).toStrictEqual(['created']);
    expect(second.settings.seedPending).toBe(true);
  });

  it('clears the pending seed without a reset once the write lands', async () => {
    const first = createHarness({ settings: { initialized: false, events: [] }, failWrites: true });
    await first.service.status();

    const second = createHarness({ settings: { ...first.settings, events: [...first.settings.events] } });
    const status = await second.service.status();

    expect(status).toMatchObject({ enabled: true, unlocked: false, isDefaultPassword: true });
    expect(second.settings.events.map((event) => event.type)).toStrictEqual(['created']);
    expect(second.settings.seedPending).toBe(false);
    expect(second.record?.hash).toBe('hash:123456');
  });

  it('changes the password only with the current one and keeps the lock state', async () => {
    const harness = createHarness({ record: recordFor('123456', true) });

    await expect(harness.service.changePassword({ currentPassword: 'bad', newPassword: 'new-secret' })).resolves.toStrictEqual({ ok: false, reason: 'wrong-password' });

    const result = await harness.service.changePassword({ currentPassword: '123456', newPassword: 'new-secret' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status.unlocked).toBe(false);
      expect(result.status.isDefaultPassword).toBe(false);
    }
    expect(harness.record?.hash).toBe('hash:new-secret');
    expect(harness.settings.locked).toBe(true);
    expect(harness.settings.events.map((event) => event.type)).toStrictEqual(['changed']);
    await expect(harness.service.unlock('new-secret')).resolves.toMatchObject({ ok: true });
  });

  it('keeps warning about the default password when it is changed back to the default', async () => {
    const harness = createHarness({ record: recordFor('secret') });

    await harness.service.changePassword({ currentPassword: 'secret', newPassword: '123456' });

    const status = await harness.service.status();
    expect(status.isDefaultPassword).toBe(true);
    expect(harness.record?.defaultPassword).toBe(true);
  });

  it('returns a status with writeFailed when the password file cannot be written', async () => {
    const harness = createHarness({ record: recordFor('secret') });
    harness.setWritesFail(true);

    const result = await harness.service.changePassword({ currentPassword: 'secret', newPassword: 'new-secret' });

    expect(result).toMatchObject({ ok: false, reason: 'write-failed' });
    if (!result.ok) expect(result.status?.writeFailed).toBe(true);
    // A failed write leaves the in-memory record alone: the old password still works.
    expect(harness.record?.hash).toBe('hash:secret');
    await expect(harness.service.unlock('secret')).resolves.toMatchObject({ ok: true });
  });

  it('refuses to unlock a damaged file but recovers it after deletion', async () => {
    const harness = createHarness({ invalidFile: true });

    const status = await harness.service.status();
    expect(status.enabled).toBe(true);
    expect(status.unlocked).toBe(false);
    await expect(harness.service.unlock('123456')).resolves.toStrictEqual({ ok: false, reason: 'unreadable' });

    harness.removeFile();
    const recovered = await harness.service.status();
    expect(recovered).toMatchObject({ enabled: true, unlocked: false, isDefaultPassword: true });
    expect(harness.settings.events.map((event) => event.type)).toStrictEqual(['reset']);
  });

  it('locks after the configured idle time, but only in idle mode', async () => {
    const idle = createHarness({ settings: { mode: 'idle', idleMinutes: 10, locked: false }, record: recordFor('secret') });
    await expect(idle.service.unlock('secret')).resolves.toMatchObject({ ok: true });

    await expect(idle.service.autoLockIfIdle(599)).resolves.toBe(false);
    await expect(idle.service.autoLockIfIdle(600)).resolves.toBe(true);
    expect((await idle.service.status()).unlocked).toBe(false);

    const manual = createHarness({ settings: { mode: 'manual', idleMinutes: 10, locked: false }, record: recordFor('secret') });
    await expect(manual.service.unlock('secret')).resolves.toMatchObject({ ok: true });
    await expect(manual.service.autoLockIfIdle(100_000)).resolves.toBe(false);
    expect((await manual.service.status()).unlocked).toBe(true);
  });

  it('locks on a screen lock or suspend only in idle mode', async () => {
    const idle = createHarness({ settings: { mode: 'idle', locked: false }, record: recordFor('secret') });
    await expect(idle.service.unlock('secret')).resolves.toMatchObject({ ok: true });
    await expect(idle.service.lockForAway()).resolves.toBe(true);
    expect((await idle.service.status()).unlocked).toBe(false);

    const manual = createHarness({ settings: { mode: 'manual', locked: false }, record: recordFor('secret') });
    await expect(manual.service.lockForAway()).resolves.toBe(false);
    expect((await manual.service.status()).unlocked).toBe(true);
  });
});
