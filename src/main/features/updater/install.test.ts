// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  clearPendingUpdate,
  getUpdaterPaths,
  launchUpdater,
  prepareUpdaterScript,
  readPendingUpdateFile,
  recordPendingUpdate,
} from './install.js';

const withTempDir = async (run: (dir: string) => Promise<void>) => {
  const dir = await mkdtemp(join(tmpdir(), 'llc-update-install-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

describe('getUpdaterPaths', () => {
  it('keeps everything under one folder in userData', () => {
    const paths = getUpdaterPaths(String.raw`C:\Users\me\AppData\Roaming\LosslessCut-Patch`);
    expect(paths.updatesDir).toBe(String.raw`C:\Users\me\AppData\Roaming\LosslessCut-Patch\updates`);
    expect(paths.scriptPath.startsWith(paths.updatesDir)).toBe(true);
    expect(paths.logPath.startsWith(paths.updatesDir)).toBe(true);
    expect(paths.pendingPath.startsWith(paths.updatesDir)).toBe(true);
  });

  it('uses a stable script and log name, so repeated attempts do not pile up', () => {
    const first = getUpdaterPaths('a');
    const second = getUpdaterPaths('a');
    expect(first.scriptPath).toBe(second.scriptPath);
    expect(first.logPath).toContain('patch-update.log');
  });
});

describe('prepareUpdaterScript', () => {
  it('copies the script the running build ships', async () => {
    await withTempDir(async (dir) => {
      const shipped = join(dir, 'shipped.ps1');
      await writeFile(shipped, 'Write-Output ok', 'utf8');
      const { scriptPath } = getUpdaterPaths(dir);

      await prepareUpdaterScript({ shippedScriptPath: shipped, scriptPath });

      await expect(readFile(scriptPath, 'utf8')).resolves.toBe('Write-Output ok');
    });
  });
});

describe('recordPendingUpdate', () => {
  it('writes a record the next launch can read back', async () => {
    await withTempDir(async (dir) => {
      const { pendingPath } = getUpdaterPaths(dir);
      await recordPendingUpdate({
        pendingPath,
        from: '3.70.2-patch.1',
        to: '3.70.2-patch.2',
        packagePath: String.raw`C:\updates\new.zip`,
        startedAt: '2026-11-13T10:00:00.000Z',
      });

      await expect(readPendingUpdateFile(pendingPath)).resolves.toStrictEqual({
        from: '3.70.2-patch.1',
        to: '3.70.2-patch.2',
        packagePath: String.raw`C:\updates\new.zip`,
        startedAt: '2026-11-13T10:00:00.000Z',
      });
    });
  });

  it('creates the updates folder when it is missing', async () => {
    await withTempDir(async (dir) => {
      const pendingPath = join(dir, 'nested', 'updates', 'pending.json');
      await recordPendingUpdate({ pendingPath, from: 'a', to: 'b', packagePath: 'p' });
      await expect(readPendingUpdateFile(pendingPath)).resolves.toMatchObject({ to: 'b' });
    });
  });
});

describe('readPendingUpdateFile', () => {
  it('is undefined when there is no hand-off to report', async () => {
    await withTempDir(async (dir) => {
      await expect(readPendingUpdateFile(join(dir, 'pending.json'))).resolves.toBeUndefined();
    });
  });

  it('drops a file that is not JSON, so it cannot be re-read forever', async () => {
    await withTempDir(async (dir) => {
      const pendingPath = join(dir, 'pending.json');
      await writeFile(pendingPath, 'not json', 'utf8');
      await expect(readPendingUpdateFile(pendingPath)).resolves.toBeUndefined();
      await expect(readPendingUpdateFile(pendingPath)).resolves.toBeUndefined();
    });
  });

  it('drops a JSON payload that is not a record', async () => {
    await withTempDir(async (dir) => {
      const pendingPath = join(dir, 'pending.json');
      await writeFile(pendingPath, JSON.stringify({ nothing: true }), 'utf8');
      await expect(readPendingUpdateFile(pendingPath)).resolves.toBeUndefined();
    });
  });
});

describe('clearPendingUpdate', () => {
  it('removes the record once it has been reported', async () => {
    await withTempDir(async (dir) => {
      const pendingPath = join(dir, 'pending.json');
      await recordPendingUpdate({ pendingPath, from: 'a', to: 'b', packagePath: 'p' });
      await clearPendingUpdate(pendingPath);
      await expect(readPendingUpdateFile(pendingPath)).resolves.toBeUndefined();
    });
  });

  it('does nothing when there is no record', async () => {
    await withTempDir(async (dir) => {
      await expect(clearPendingUpdate(join(dir, 'pending.json'))).resolves.toBeUndefined();
    });
  });
});

describe('launchUpdater', () => {
  it('spawns the command detached and lets it outlive the app', () => {
    const calls: { executable: string; args: string[]; options: unknown }[] = [];
    let unrefCalled = false;

    const spawnImpl = ((executable: string, args: string[], options: unknown) => {
      calls.push({ executable, args, options });
      return { unref: () => { unrefCalled = true; } };
    }) as unknown as typeof import('node:child_process').spawn;

    launchUpdater({
      command: { executable: 'cmd.exe', args: ['/c', 'start', '', 'powershell.exe'] },
      spawnImpl,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.executable).toBe('cmd.exe');
    expect(calls[0]?.options).toMatchObject({ detached: true, stdio: 'ignore' });
    expect(unrefCalled).toBe(true);
  });
});
