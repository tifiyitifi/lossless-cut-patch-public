// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import {
  buildUpdaterCommand,
  estimateRequiredFreeBytes,
  isCmdSafePath,
  patchUpdaterTitle,
  planPortableUpdate,
  sanitizeAssetFileName,
} from './install.js';

const plan = (overrides: Partial<Parameters<typeof planPortableUpdate>[0]> = {}) => planPortableUpdate({
  isPackaged: true,
  windowsStore: false,
  checksumAvailable: true,
  installDir: String.raw`C:\Apps\LosslessCut-Patch`,
  packagePath: String.raw`C:\Users\me\AppData\Roaming\LosslessCut-Patch\updates\LosslessCut-Patch-win-x64.zip`,
  packageSize: 400_000_000,
  freeBytes: 10_000_000_000,
  canWriteInstallDir: true,
  scriptPath: String.raw`C:\Apps\LosslessCut-Patch\patch_update.ps1`,
  updatesDir: String.raw`C:\Users\me\AppData\Roaming\LosslessCut-Patch\updates`,
  logPath: String.raw`C:\Users\me\AppData\Roaming\LosslessCut-Patch\updates\patch-update.log`,
  ...overrides,
});

describe('isCmdSafePath', () => {
  it('accepts normal paths, including spaces and non-ASCII folders', () => {
    expect(isCmdSafePath(String.raw`C:\Program Files\LosslessCut Patch\patch_update.ps1`)).toBe(true);
    expect(isCmdSafePath(String.raw`C:\work\视频素材\app`)).toBe(true);
  });

  it.each(['%', '!', '^', '&', '|', '<', '>', '(', ')', '"'])('rejects a path containing %s', (char) => {
    expect(isCmdSafePath(String.raw`C:\Apps\a${char}b`)).toBe(false);
  });

  it('rejects an empty path', () => {
    expect(isCmdSafePath('')).toBe(false);
  });
});

describe('sanitizeAssetFileName', () => {
  it('keeps a plain package name', () => {
    expect(sanitizeAssetFileName('LosslessCut-Patch-win-x64.zip')).toBe('LosslessCut-Patch-win-x64.zip');
  });

  it('rejects a name that carries a path', () => {
    expect(sanitizeAssetFileName('../evil.zip')).toBeUndefined();
    expect(sanitizeAssetFileName(String.raw`C:\evil.zip`)).toBeUndefined();
    expect(sanitizeAssetFileName('a/b.zip')).toBeUndefined();
  });

  it('rejects the dot entries and empty names', () => {
    expect(sanitizeAssetFileName('.')).toBeUndefined();
    expect(sanitizeAssetFileName('..')).toBeUndefined();
    expect(sanitizeAssetFileName(' '.repeat(3))).toBeUndefined();
  });
});

describe('estimateRequiredFreeBytes', () => {
  it('covers the package, the unpacked build and a margin', () => {
    expect(estimateRequiredFreeBytes(400_000_000)).toBeGreaterThan(400_000_000 * 3);
  });
});

describe('planPortableUpdate', () => {
  it('plans the swap when every precondition holds', () => {
    expect(plan()).toMatchObject({
      kind: 'portable',
      installDir: String.raw`C:\Apps\LosslessCut-Patch`,
      scriptPath: String.raw`C:\Apps\LosslessCut-Patch\patch_update.ps1`,
    });
  });

  it('refuses a development build', () => {
    expect(plan({ isPackaged: false })).toStrictEqual({ kind: 'blocked', blocker: 'notPackaged' });
  });

  it('refuses a Store build, which the Store updates', () => {
    expect(plan({ windowsStore: true })).toStrictEqual({ kind: 'blocked', blocker: 'storeBuild' });
  });

  it('refuses a release without a checksum index', () => {
    expect(plan({ checksumAvailable: false })).toStrictEqual({ kind: 'blocked', blocker: 'noChecksum' });
  });

  it('refuses a read-only installation folder', () => {
    expect(plan({ canWriteInstallDir: false })).toStrictEqual({ kind: 'blocked', blocker: 'installDirNotWritable' });
  });

  it('refuses a package that does not fit', () => {
    expect(plan({ freeBytes: 1000 })).toStrictEqual({ kind: 'blocked', blocker: 'noFreeSpace' });
  });

  it('refuses when the shipped updater script is missing', () => {
    expect(plan({ scriptPath: undefined })).toStrictEqual({ kind: 'blocked', blocker: 'unsafePath' });
  });

  it.each([
    ['installDir', { installDir: String.raw`C:\Apps\A & B` }],
    ['packagePath', { packagePath: String.raw`C:\updates\a%b.zip` }],
    ['updatesDir', { updatesDir: String.raw`C:\updates(!)` }],
    ['logPath', { logPath: String.raw`C:\log"s.txt` }],
  ] as const)('refuses a %s that cmd.exe would re-parse', (_name, overrides) => {
    expect(plan(overrides)).toStrictEqual({ kind: 'blocked', blocker: 'unsafePath' });
  });
});

describe('buildUpdaterCommand', () => {
  it('hands the package to PowerShell through cmd.exe, which owns a console', () => {
    const command = buildUpdaterCommand({
      scriptPath: String.raw`C:\Apps\LosslessCut-Patch\patch_update.ps1`,
      packagePath: String.raw`C:\updates\new.zip`,
      installDir: String.raw`C:\Apps\LosslessCut-Patch`,
      logPath: String.raw`C:\updates\patch-update.log`,
    });

    expect(command?.executable).toBe('cmd.exe');
    expect(command?.args.slice(0, 4)).toStrictEqual(['/c', 'start', patchUpdaterTitle, 'powershell.exe']);
    expect(command?.args).toContain('-File');
    expect(command?.args).toContain('-PackagePath');
    expect(command?.args).toContain(String.raw`C:\updates\new.zip`);
    expect(command?.args).toContain('-InstallDir');
    expect(command?.args).toContain(String.raw`C:\Apps\LosslessCut-Patch`);
    expect(command?.args).toContain('-NonInteractive');
  });

  it('is undefined when a path cannot survive the hand-off', () => {
    expect(buildUpdaterCommand({
      scriptPath: String.raw`C:\A & B\patch_update.ps1`,
      packagePath: String.raw`C:\updates\new.zip`,
      installDir: String.raw`C:\Apps\LosslessCut-Patch`,
      logPath: String.raw`C:\updates\patch-update.log`,
    })).toBeUndefined();
  });

  it('is undefined when the installation folder cannot survive the hand-off', () => {
    expect(buildUpdaterCommand({
      scriptPath: String.raw`C:\Apps\patch_update.ps1`,
      packagePath: String.raw`C:\updates\new.zip`,
      installDir: String.raw`C:\Apps\A & B`,
      logPath: String.raw`C:\updates\patch-update.log`,
    })).toBeUndefined();
  });
});
