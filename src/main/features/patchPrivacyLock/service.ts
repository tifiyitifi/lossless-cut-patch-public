import type {
  PatchHistoryLockEvent,
  PatchHistoryLockMode,
  PatchHistoryLockResult,
  PatchHistoryLockStatus,
  PatchHistoryPasswordRecord,
} from '../../../common/features/patchPrivacyLock/index.js';
import {
  appendHistoryLockEvent,
  initialHistoryUnlocked,
  patchHistoryLockDefaultPassword,
  shouldLockAfterIdle,
  validateHistoryPassword,
} from '../../../common/features/patchPrivacyLock/index.js';
import { createHistoryPasswordRecord, verifyHistoryPassword } from './passwordHash.js';
import type { ReadPatchHistoryPasswordResult } from './passwordFile.js';
import { readPatchHistoryPasswordFile, writePatchHistoryPasswordFile } from './passwordFile.js';

/**
The work-history lock (fork-owned).

The history itself is not encrypted: this service only decides whether the work-folder dialog may
list the other work roots, and it keeps a small event log that tells the owner whether someone
reset or unlocked the lock while the computer was lent out.

The rules:

- a missing password file is a **reset**, never "turn the lock off": the default password is
  restored, the history is locked again, and the reset is logged;
- the first run creates the default password and logs that too, so a later reset is distinguishable;
- `manual` remembers the last lock state across restarts; `startup` and `idle` always start locked;
- unlocking is the only way to show the full history, and it is always logged.

File reads and writes, hashing and the clock are injected, so the reset/unlock/change rules are
testable without Electron or the real user data folder. Operations are serialised: the idle watcher
and a dialog action can ask at the same time, and two resets must not race.
*/

export interface PatchHistoryLockSettings {
  mode: PatchHistoryLockMode;
  idleMinutes: number;
  initialized: boolean;
  locked: boolean;
  /**
  A default record (the first seed or a reset) sits in memory but its write has not landed yet.

  Persisting it lets a restart tell "the file was never written" from "the file was deleted", so a
  read-only folder does not log a reset on every launch.
  */
  seedPending: boolean;
  events: PatchHistoryLockEvent[];
}

export interface PatchHistoryLockServiceDeps {
  resolveFilePath: () => Promise<string>;
  getSettings: () => PatchHistoryLockSettings;
  setSettings: (patch: Partial<PatchHistoryLockSettings>) => void;
  notify?: () => void;
  log?: (message: string, ...args: unknown[]) => void;
  now?: () => number;
  readFile?: (path: string) => Promise<ReadPatchHistoryPasswordResult>;
  writeFile?: (path: string, record: PatchHistoryPasswordRecord) => Promise<void>;
  createRecord?: (password: string, options?: { defaultPassword?: boolean }) => Promise<PatchHistoryPasswordRecord>;
  verify?: (password: string, record: PatchHistoryPasswordRecord) => Promise<boolean>;
}

export interface PatchHistoryLockService {
  status: () => Promise<PatchHistoryLockStatus>;
  unlock: (password: string) => Promise<PatchHistoryLockResult>;
  lock: () => Promise<PatchHistoryLockResult>;
  setPassword: (password: string) => Promise<PatchHistoryLockResult>;
  changePassword: (params: { currentPassword: string, newPassword: string }) => Promise<PatchHistoryLockResult>;
  autoLockIfIdle: (idleSeconds: number) => Promise<boolean>;
  lockForAway: () => Promise<boolean>;
}

export function createPatchHistoryLockService(deps: PatchHistoryLockServiceDeps): PatchHistoryLockService {
  const now = deps.now ?? Date.now;
  const readFile = deps.readFile ?? readPatchHistoryPasswordFile;
  const writeFile = deps.writeFile ?? writePatchHistoryPasswordFile;
  const createRecord = deps.createRecord ?? createHistoryPasswordRecord;
  const verify = deps.verify ?? verifyHistoryPassword;
  const log = deps.log ?? (() => undefined);

  let unlocked: boolean | undefined;
  let record: PatchHistoryPasswordRecord | undefined;
  let invalidFile = false;
  let filePath = '';
  let writeFailed = false;
  let queue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.then(() => undefined, () => undefined);
    return run;
  }

  function buildStatus(): PatchHistoryLockStatus {
    const enabled = record != null || invalidFile;
    return {
      enabled,
      unlocked: enabled ? unlocked === true : true,
      filePath,
      isDefaultPassword: record?.defaultPassword === true,
      events: deps.getSettings().events,
      ...(writeFailed && { writeFailed: true }),
    };
  }

  async function writeRecord(path: string, next: PatchHistoryPasswordRecord): Promise<boolean> {
    try {
      await writeFile(path, next);
      writeFailed = false;
      return true;
    } catch (err) {
      writeFailed = true;
      log('Failed to write the work-history password file', err);
      return false;
    }
  }

  async function ensureState(): Promise<void> {
    const settings = deps.getSettings();
    filePath = await deps.resolveFilePath();
    const read = await readFile(filePath);
    invalidFile = read.kind === 'invalid';
    writeFailed = false;

    if (!settings.initialized) {
      if (read.kind === 'missing') {
        const created = await createRecord(patchHistoryLockDefaultPassword, { defaultPassword: true });
        record = created;
        unlocked = false;
        // The seed is not a reset: only a later missing file is. Remember whether the write landed
        // (it may not, on a read-only folder) so a restart does not report the seed as a reset.
        const wrote = await writeRecord(filePath, created);
        deps.setSettings({
          initialized: true,
          locked: true,
          seedPending: !wrote,
          events: appendHistoryLockEvent(settings.events, { at: now(), type: 'created' }),
        });
        return;
      }
      if (read.kind === 'ok') {
        record = read.record;
        deps.setSettings({ initialized: true });
        if (settings.seedPending) deps.setSettings({ seedPending: false });
        if (unlocked === undefined) unlocked = initialHistoryUnlocked({ enabled: true, mode: settings.mode, storedLocked: settings.locked });
        return;
      }
      // A damaged file is not overwritten: the history stays locked and the user has to delete the
      // file to reset it. Silently replacing it would hide the reset from the log.
      record = undefined;
      deps.setSettings({ initialized: true });
      if (settings.seedPending) deps.setSettings({ seedPending: false });
      if (unlocked === undefined) unlocked = false;
      return;
    }

    if (read.kind === 'missing') {
      if (settings.seedPending) {
        // The default record never reached the disk (a read-only folder at the first seed or at a
        // reset). Restore it in memory and retry the write, but report nothing: no file was deleted.
        const created = record ?? await createRecord(patchHistoryLockDefaultPassword, { defaultPassword: true });
        record = created;
        if (unlocked === undefined) unlocked = initialHistoryUnlocked({ enabled: true, mode: settings.mode, storedLocked: settings.locked });
        if (await writeRecord(filePath, created)) deps.setSettings({ seedPending: false });
        return;
      }
      const created = await createRecord(patchHistoryLockDefaultPassword, { defaultPassword: true });
      record = created;
      unlocked = false;
      const wrote = await writeRecord(filePath, created);
      deps.setSettings({
        locked: true,
        seedPending: !wrote,
        events: appendHistoryLockEvent(settings.events, { at: now(), type: 'reset' }),
      });
      deps.notify?.();
      return;
    }

    if (read.kind === 'ok') {
      record = read.record;
      invalidFile = false;
      if (settings.seedPending) deps.setSettings({ seedPending: false });
      if (unlocked === undefined) unlocked = initialHistoryUnlocked({ enabled: true, mode: settings.mode, storedLocked: settings.locked });
      return;
    }

    // A file exists but cannot be parsed: keep the current lock state, but unlocking has to fail
    // until the user deletes the file and lets the app restore the default password.
    record = undefined;
    if (settings.seedPending) deps.setSettings({ seedPending: false });
    if (unlocked === undefined) unlocked = false;
  }

  function status(): Promise<PatchHistoryLockStatus> {
    return enqueue(async () => {
      await ensureState();
      return buildStatus();
    });
  }

  function unlock(password: string): Promise<PatchHistoryLockResult> {
    return enqueue(async () => {
      await ensureState();
      const problem = validateHistoryPassword(password);
      if (problem != null) return { ok: false, reason: problem };
      if (record == null) return { ok: false, reason: invalidFile ? 'unreadable' : 'unavailable' };
      if (!(await verify(password, record))) return { ok: false, reason: 'wrong-password' };
      unlocked = true;
      const settings = deps.getSettings();
      deps.setSettings({
        locked: false,
        events: appendHistoryLockEvent(settings.events, { at: now(), type: 'unlocked' }),
      });
      deps.notify?.();
      return { ok: true, status: buildStatus() };
    });
  }

  function lock(): Promise<PatchHistoryLockResult> {
    return enqueue(async () => {
      await ensureState();
      unlocked = false;
      deps.setSettings({ locked: true });
      deps.notify?.();
      return { ok: true, status: buildStatus() };
    });
  }

  /**
  Set the default password on a record that does not exist yet.

  Currently unreachable through the UI: `ensureState` always seeds a record (or marks the file
  invalid) before this runs, so even a fresh install already has the default password and the
  settings dialog always calls `changePassword`. It stays as the API for a future explicit
  "lock disabled" state; wire the UI to it only once such a state exists.
  */
  function setPassword(password: string): Promise<PatchHistoryLockResult> {
    return enqueue(async () => {
      await ensureState();
      const problem = validateHistoryPassword(password);
      if (problem != null) return { ok: false, reason: problem };
      if (record != null) return { ok: false, reason: 'exists' };
      if (invalidFile) return { ok: false, reason: 'unreadable' };
      // Keep the default-password flag when the new password is the built-in default, so the
      // settings keep warning about it (the same rule the seed and reset paths follow).
      const created = await createRecord(password, { defaultPassword: password === patchHistoryLockDefaultPassword });
      if (!(await writeRecord(filePath, created))) return { ok: false, reason: 'write-failed', status: buildStatus() };
      record = created;
      unlocked = true;
      const settings = deps.getSettings();
      deps.setSettings({
        initialized: true,
        locked: false,
        events: appendHistoryLockEvent(settings.events, { at: now(), type: 'changed' }),
      });
      deps.notify?.();
      return { ok: true, status: buildStatus() };
    });
  }

  function changePassword({ currentPassword, newPassword }: { currentPassword: string, newPassword: string }): Promise<PatchHistoryLockResult> {
    return enqueue(async () => {
      await ensureState();
      const problem = validateHistoryPassword(newPassword);
      if (problem != null) return { ok: false, reason: problem };
      if (record == null) return { ok: false, reason: invalidFile ? 'unreadable' : 'unavailable' };
      if (!(await verify(currentPassword, record))) return { ok: false, reason: 'wrong-password' };
      // Keep the default-password flag when the new password is the built-in default, so the
      // settings keep warning about it (the same rule the seed and reset paths follow).
      const created = await createRecord(newPassword, { defaultPassword: newPassword === patchHistoryLockDefaultPassword });
      if (!(await writeRecord(filePath, created))) return { ok: false, reason: 'write-failed', status: buildStatus() };
      record = created;
      // Changing the password never changes the lock state: a locked history stays locked.
      const settings = deps.getSettings();
      deps.setSettings({ events: appendHistoryLockEvent(settings.events, { at: now(), type: 'changed' }) });
      deps.notify?.();
      return { ok: true, status: buildStatus() };
    });
  }

  function autoLockIfIdle(idleSeconds: number): Promise<boolean> {
    return enqueue(async () => {
      await ensureState();
      const settings = deps.getSettings();
      if (unlocked !== true) return false;
      if (!shouldLockAfterIdle({ mode: settings.mode, idleMinutes: settings.idleMinutes, idleSeconds })) return false;
      unlocked = false;
      deps.setSettings({ locked: true });
      deps.notify?.();
      return true;
    });
  }

  function lockForAway(): Promise<boolean> {
    return enqueue(async () => {
      await ensureState();
      if (deps.getSettings().mode !== 'idle' || unlocked !== true) return false;
      unlocked = false;
      deps.setSettings({ locked: true });
      deps.notify?.();
      return true;
    });
  }

  return { status, unlock, lock, setPassword, changePassword, autoLockIfIdle, lockForAway };
}
