// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { getPatchVolumeKey } from './volumeKey.js';

describe('getPatchVolumeKey', () => {
  it('maps every spelling of one Windows volume to the same key', () => {
    const key = (dir: string) => getPatchVolumeKey(dir, { caseInsensitive: true });
    expect(key('C:/work/clips')).toBe('c:');
    expect(key('c:/work/merged')).toBe('c:');
    expect(key(String.raw`C:\work`)).toBe('c:');
    expect(key('D:/other')).toBe('d:');
  });

  it('keeps the case on a case-sensitive file system', () => {
    expect(getPatchVolumeKey('/work/clips', { caseInsensitive: false })).toBe('/');
    expect(getPatchVolumeKey('/other', { caseInsensitive: false })).toBe('/');
    expect(getPatchVolumeKey('relative/dir', { caseInsensitive: false })).toBe('relative/dir');
  });

  it('treats a UNC share as one volume, but only where it is a share', () => {
    expect(getPatchVolumeKey('//server/share/clips', { caseInsensitive: true })).toBe('//server/share');
    expect(getPatchVolumeKey(String.raw`\\SERVER\Share\merged`, { caseInsensitive: true })).toBe('//server/share');
    expect(getPatchVolumeKey('//server/other', { caseInsensitive: true })).toBe('//server/other');
    // POSIX: `//x/y` is just an absolute path (and often the same volume as `/`).
    expect(getPatchVolumeKey('//server/share/clips', { caseInsensitive: false })).toBe('/');
  });

  it('keeps a relative directory as its own key', () => {
    expect(getPatchVolumeKey('relative/dir', { caseInsensitive: true })).toBe('relative/dir');
  });
});
