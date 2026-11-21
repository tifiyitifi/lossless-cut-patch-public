// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';

import { canWriteDir, getPatchInstallDir, getPatchProjectStoreDirs, resolvePatchProjectStores } from './projectStores.js';

describe('getPatchInstallDir', () => {
  it('prefers the portable app folder and falls back to the exe folder', () => {
    expect(getPatchInstallDir({ portableDir: 'D:/Apps/LosslessCut', exePath: 'D:/Apps/LosslessCut/LosslessCut.exe' })).toBe('D:/Apps/LosslessCut');
    expect(getPatchInstallDir({ portableDir: undefined, exePath: join('/opt', 'LosslessCut', 'losslesscut') })).toBe(join('/opt', 'LosslessCut'));
    expect(getPatchInstallDir({ portableDir: ' '.repeat(3), exePath: join('/opt', 'app', 'losslesscut') })).toBe(join('/opt', 'app'));
  });
});

describe('getPatchProjectStoreDirs', () => {
  it('puts one llc store next to the user data and one in the installation folder', () => {
    expect(getPatchProjectStoreDirs({ userDataDir: '/home/u/.config/LosslessCut', installDir: '/opt/LosslessCut' })).toStrictEqual({
      userDataLlcDir: join('/home/u/.config/LosslessCut', 'llc'),
      installLlcDir: join('/opt/LosslessCut', 'llc'),
    });
  });
});

describe('canWriteDir', () => {
  it('never throws when the folder cannot be written', async () => {
    await expect(canWriteDir('/read-only', async () => undefined)).resolves.toBe(true);
    await expect(canWriteDir('/read-only', async () => { throw new Error('EACCES'); })).resolves.toBe(false);
  });
});

describe('resolvePatchProjectStores', () => {
  it('reports the installation folder as unwritable without touching the disk', async () => {
    const stores = await resolvePatchProjectStores({
      userDataDir: '/userdata',
      installDir: '/install',
      canWrite: async (dir) => dir !== '/install',
    });

    expect(stores.userDataLlcDir).toBe(join('/userdata', 'llc'));
    expect(stores.installLlcDir).toBe(join('/install', 'llc'));
    expect(stores.installLlcWritable).toBe(false);
  });
});
