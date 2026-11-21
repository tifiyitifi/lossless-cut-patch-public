// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getPatchHistoryLockPaths, readPatchHistoryPasswordFile, resolvePatchHistoryLockPath, writePatchHistoryPasswordFile } from './passwordFile.js';

const installDir = String.raw`C:\work\app`;
const userDataDir = String.raw`C:\work\data`;

function resolve(options: { packaged?: boolean; existing?: string[]; installWritable?: boolean }) {
  const existing = new Set(options.existing);
  return resolvePatchHistoryLockPath({
    userDataDir,
    installDir,
    isPackaged: options.packaged ?? true,
    exists: async (path) => existing.has(path),
    canWrite: async (dir) => (options.installWritable ?? true) && dir === installDir,
  });
}

describe('getPatchHistoryLockPaths', () => {
  it('puts one candidate next to the program and one in the app data folder', () => {
    expect(getPatchHistoryLockPaths({ userDataDir, installDir })).toStrictEqual({
      installPath: join(installDir, 'patch-history-lock.json'),
      userDataPath: join(userDataDir, 'patch-history-lock.json'),
    });
  });
});

describe('resolvePatchHistoryLockPath', () => {
  it('prefers the installation folder when it already has the file', async () => {
    await expect(resolve({ existing: [join(installDir, 'patch-history-lock.json'), join(userDataDir, 'patch-history-lock.json')] }))
      .resolves.toBe(join(installDir, 'patch-history-lock.json'));
  });

  it('uses an existing app-data file instead of creating a second one', async () => {
    await expect(resolve({ existing: [join(userDataDir, 'patch-history-lock.json')] }))
      .resolves.toBe(join(userDataDir, 'patch-history-lock.json'));
  });

  it('creates in the installation folder when it is writable', async () => {
    await expect(resolve({ installWritable: true })).resolves.toBe(join(installDir, 'patch-history-lock.json'));
  });

  it('falls back to the app data folder when the installation folder is read-only', async () => {
    await expect(resolve({ installWritable: false })).resolves.toBe(join(userDataDir, 'patch-history-lock.json'));
  });

  it('never writes next to the Electron binary in development', async () => {
    await expect(resolve({ packaged: false, existing: [join(installDir, 'patch-history-lock.json')] }))
      .resolves.toBe(join(userDataDir, 'patch-history-lock.json'));
  });
});

describe('password file read and write', () => {
  it('round-trips a record, creates the folder, and reports a missing file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'llc-history-lock-'));
    const path = join(dir, 'nested', 'patch-history-lock.json');
    const record = { version: 1 as const, algorithm: 'scrypt' as const, salt: 'salt', hash: 'hash', keyLength: 64, createdAt: 1 };

    try {
      await expect(readPatchHistoryPasswordFile(path)).resolves.toStrictEqual({ kind: 'missing' });

      await writePatchHistoryPasswordFile(path, record);

      await expect(readPatchHistoryPasswordFile(path)).resolves.toStrictEqual({ kind: 'ok', record });
      expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ version: 1, algorithm: 'scrypt' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reports a malformed file as invalid instead of guessing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'llc-history-lock-'));
    const path = join(dir, 'patch-history-lock.json');
    try {
      await writeFile(path, '{not json', 'utf8');
      await expect(readPatchHistoryPasswordFile(path)).resolves.toStrictEqual({ kind: 'invalid' });

      await writeFile(path, JSON.stringify({ version: 2, algorithm: 'scrypt' }), 'utf8');
      await expect(readPatchHistoryPasswordFile(path)).resolves.toStrictEqual({ kind: 'invalid' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
