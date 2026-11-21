// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { verifyHistoryPassword } from './passwordHash.js';
import { readPatchHistoryPasswordFile } from './passwordFile.js';
import { createPatchHistoryLockService } from './service.js';
import type { PatchHistoryLockSettings } from './service.js';

/**
The service with the real scrypt hashing and the real password file, in a temporary folder.

The unit tests fake both; this one proves the wiring: the seed on a fresh install, the actual
password check, and the reset to the default password after the file is deleted.
*/
describe('patch history lock service (real file and hash)', () => {
  it('seeds the default password, verifies it, and restores it after deletion', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'llc-history-lock-'));
    const path = join(dir, 'patch-history-lock.json');
    const settings: PatchHistoryLockSettings = { mode: 'manual', idleMinutes: 10, initialized: false, locked: true, seedPending: false, events: [] };
    const service = createPatchHistoryLockService({
      resolveFilePath: async () => path,
      getSettings: () => ({ ...settings, events: [...settings.events] }),
      setSettings: (patch) => { Object.assign(settings, patch); },
      notify: () => undefined,
      log: () => undefined,
    });

    try {
      const seeded = await service.status();
      expect(seeded).toMatchObject({ enabled: true, unlocked: false, isDefaultPassword: true, filePath: path });
      expect(settings.events.map((event) => event.type)).toStrictEqual(['created']);

      const file = await readPatchHistoryPasswordFile(path);
      expect(file.kind).toBe('ok');
      if (file.kind === 'ok') await expect(verifyHistoryPassword('123456', file.record)).resolves.toBe(true);

      await expect(service.unlock('123456')).resolves.toMatchObject({ ok: true });
      expect(settings.events.map((event) => event.type)).toStrictEqual(['unlocked', 'created']);

      await unlink(path);
      const reset = await service.status();
      expect(reset).toMatchObject({ enabled: true, unlocked: false, isDefaultPassword: true });
      expect(settings.events.map((event) => event.type)).toStrictEqual(['reset', 'unlocked', 'created']);

      const restored = await readPatchHistoryPasswordFile(path);
      expect(restored.kind).toBe('ok');
      if (restored.kind === 'ok') await expect(verifyHistoryPassword('123456', restored.record)).resolves.toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
